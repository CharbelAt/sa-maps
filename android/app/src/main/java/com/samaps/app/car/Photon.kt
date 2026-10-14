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
data class Place(val lat: Double, val lng: Double, val name: String, val address: String?) {
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
    private const val BASE = "https://photon.komoot.io/api/"

    @Throws(IOException::class)
    fun search(query: String, near: Location?, limit: Int = 8): List<Place> {
        val sb = StringBuilder(BASE)
            .append("?q=").append(URLEncoder.encode(query, "UTF-8"))
            .append("&limit=").append(limit)
        if (near != null) sb.append("&lat=").append(near.latitude).append("&lon=").append(near.longitude)
        val conn = URL(sb.toString()).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 8_000
            conn.readTimeout = 8_000
            conn.setRequestProperty("User-Agent", "SAMaps/1.0")
            conn.setRequestProperty("Accept", "application/json")
            val code = conn.responseCode
            if (code !in 200..299) throw IOException("Photon HTTP $code")
            val body = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            return parse(body)
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
            out += Place(lat, lng, name, addressParts.joinToString(", ").takeIf { it.isNotBlank() })
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
