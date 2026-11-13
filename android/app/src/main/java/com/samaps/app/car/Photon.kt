package com.samaps.app.car

import android.location.Location
import android.net.Uri
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLDecoder
import java.net.URLEncoder

/** A place as understood by `SA.navigateTo({lat, lng, name, address?})`. */
data class Place(
    val lat: Double,
    val lng: Double,
    val name: String,
    val address: String?,
    /** ISO country code from the geocoder, when known. */
    val country: String? = null,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("lat", lat)
        .put("lng", lng)
        .put("name", name)
        .apply { if (!address.isNullOrBlank()) put("address", address) }

    companion object {
        fun fromJson(o: JSONObject?): Place? {
            if (o == null) return null
            val lat = o.optDouble("lat", Double.NaN)
            val lng = o.optDouble("lng", o.optDouble("lon", Double.NaN))
            if (lat.isNaN() || lng.isNaN()) return null
            val address = o.optString("address").takeIf { it.isNotBlank() && it != "null" }
            val name = o.optString("name").takeIf { it.isNotBlank() && it != "null" }
                ?: address ?: String.format(java.util.Locale.US, "%.5f, %.5f", lat, lng)
            return Place(lat, lng, name, address)
        }
    }
}

/** Minimal Photon (komoot) geocoder client. Blocking: call from a background thread. */
object Photon {
    private const val BASE = "https://photon.komoot.io"
    private const val COUNTRY_CACHE_M = 50_000f

    /** Country of the last looked-up position (reused until you move ~50 km). */
    @Volatile
    private var countryCache: Pair<Location, String>? = null

    /**
     * Same rules as the phone's search box: results stay in your country when it has any,
     * closest first.
     */
    @Throws(IOException::class)
    fun search(query: String, near: Location?, limit: Int = 8): List<Place> {
        val sb = StringBuilder(BASE).append("/api/?q=").append(URLEncoder.encode(query, "UTF-8"))
        if (near == null) return parse(get(sb.append("&limit=").append(limit).toString()))
        sb.append("&limit=20")
            .append("&lat=").append(near.latitude).append("&lon=").append(near.longitude)
            .append("&zoom=12&location_bias_scale=0.1") // distance matters more than fame
        val hits = parse(get(sb.toString()))
        val country = countryAt(near)
        val local = if (country != null) hits.filter { it.country == country } else emptyList()
        return local.ifEmpty { hits }.sortedBy { distanceM(near, it) }.take(limit)
    }

    /** The closest places carrying any of [tags] (OSM `key:value`), nearest first. */
    @Throws(IOException::class)
    fun nearby(tags: List<String>, near: Location, limit: Int = 10): List<Place> {
        val sb = StringBuilder(BASE).append("/reverse?lat=").append(near.latitude)
            .append("&lon=").append(near.longitude)
            .append("&radius=15&lang=en&limit=").append(limit)
        for (t in tags) sb.append("&osm_tag=").append(URLEncoder.encode(t, "UTF-8"))
        return parse(get(sb.toString())).sortedBy { distanceM(near, it) }
    }

    fun distanceM(from: Location, to: Place): Float {
        val out = FloatArray(1)
        Location.distanceBetween(from.latitude, from.longitude, to.lat, to.lng, out)
        return out[0]
    }

    private fun countryAt(near: Location): String? {
        countryCache?.let { (at, code) -> if (at.distanceTo(near) < COUNTRY_CACHE_M) return code }
        return try {
            val url = "$BASE/reverse?lat=${near.latitude}&lon=${near.longitude}&limit=1"
            parse(get(url)).firstOrNull()?.country?.also { countryCache = near to it }
        } catch (e: IOException) {
            null // search still works, just without the country preference
        }
    }

    @Throws(IOException::class)
    private fun get(url: String): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 8_000
            conn.readTimeout = 8_000
            conn.setRequestProperty("User-Agent", "SAMaps/1.0")
            conn.setRequestProperty("Accept", "application/json")
            val code = conn.responseCode
            if (code !in 200..299) throw IOException("Photon HTTP $code")
            return conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    private fun parse(body: String): List<Place> {
        val features = JSONObject(body).optJSONArray("features") ?: return emptyList()
        val out = ArrayList<Place>()
        for (i in 0 until features.length()) {
            val f = features.optJSONObject(i) ?: continue
            val coords = f.optJSONObject("geometry")?.optJSONArray("coordinates") ?: continue
            val lng = coords.optDouble(0, Double.NaN)
            val lat = coords.optDouble(1, Double.NaN)
            if (lat.isNaN() || lng.isNaN()) continue
            val p = f.optJSONObject("properties") ?: JSONObject()
            val street = listOf(p.str("street"), p.str("housenumber")).filterNotNull().joinToString(" ")
                .takeIf { it.isNotBlank() }
            val locality = p.str("city") ?: p.str("town") ?: p.str("village") ?: p.str("district")
            val name = p.str("name") ?: street ?: locality ?: p.str("state") ?: continue
            val addressParts = listOfNotNull(
                street?.takeIf { it != name },
                listOfNotNull(p.str("postcode"), locality?.takeIf { it != name }).joinToString(" ")
                    .takeIf { it.isNotBlank() },
                p.str("country"),
            )
            out += Place(
                lat, lng, name, addressParts.joinToString(", ").takeIf { it.isNotBlank() }, p.str("countrycode")
            )
        }
        return out
    }

    private fun JSONObject.str(key: String): String? =
        if (isNull(key)) null else optString(key).trim().takeIf { it.isNotEmpty() }

    /**
     * Parses a `geo:` URI from a navigation intent: either coordinates or a `q=` search.
     * Returns a [Place] for coordinates, or null plus the query string to geocode.
     */
    fun parseGeoUri(uri: Uri): Pair<Place?, String?> {
        val ssp = uri.schemeSpecificPart ?: return null to null
        val coordPart = ssp.substringBefore('?')
        val query = ssp.substringAfter('?', "").split('&')
            .firstOrNull { it.startsWith("q=") }
            ?.removePrefix("q=")
            ?.let { runCatching { URLDecoder.decode(it, "UTF-8") }.getOrDefault(it) }
            ?.trim()
        coordsOf(query)?.let { return it to null }
        coordsOf(coordPart)?.let { if (it.lat != 0.0 || it.lng != 0.0) return it to null }
        return null to query?.takeIf { it.isNotBlank() }
    }

    private val COORDS = Regex("""^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:\((.*)\))?\s*$""")

    private fun coordsOf(s: String?): Place? {
        if (s.isNullOrBlank()) return null
        val m = COORDS.find(s) ?: return null
        val lat = m.groupValues[1].toDoubleOrNull() ?: return null
        val lng = m.groupValues[2].toDoubleOrNull() ?: return null
        if (lat !in -90.0..90.0 || lng !in -180.0..180.0) return null
        val label = m.groupValues.getOrNull(3)?.takeIf { it.isNotBlank() }
        return Place(lat, lng, label ?: String.format(java.util.Locale.US, "%.5f, %.5f", lat, lng), null)
    }
}
