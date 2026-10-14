package com.samaps.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import com.samaps.app.web.SAWebHost
import com.samaps.app.web.WebMode
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Native GPS for every attached WebView (no Play Services): LocationManager GPS_PROVIDER at
 * ~1 s / 0 m, with NETWORK_PROVIDER as a fallback while GPS has no recent fix. Each fix is pushed
 * as `SA.onNativeLocation({lat,lng,accuracy,heading,speed,time})`.
 *
 * Updates run while at least one attached WebView wants them (car WebView always; phone WebView
 * while its activity is visible or while it is navigating).
 */
@SuppressLint("StaticFieldLeak") // holds the Application context only
object LocationHub {
    private const val TAG = "SAMaps/Location"
    private const val INTERVAL_MS = 1_000L
    private const val GPS_FRESH_MS = 5_000L

    private lateinit var app: Context
    private lateinit var lm: LocationManager
    private val main = Handler(Looper.getMainLooper())
    private val hosts = CopyOnWriteArrayList<WeakReference<SAWebHost>>()

    @Volatile
    var last: Location? = null
        private set

    private var running = false
    private var lastGpsFixElapsed = 0L

    // Implement every callback explicitly: on API < 30 the framework calls the (then abstract)
    // onStatusChanged/onProviderEnabled/onProviderDisabled, so a lambda would crash there.
    private val gpsListener = Listener(fromGps = true)
    private val networkListener = Listener(fromGps = false)

    private class Listener(private val fromGps: Boolean) : LocationListener {
        override fun onLocationChanged(location: Location) = onFix(location, fromGps)
        override fun onProviderEnabled(provider: String) {}
        override fun onProviderDisabled(provider: String) {}

        @Deprecated("Deprecated in Java")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    }

    fun init(context: Context) {
        app = context.applicationContext
        lm = app.getSystemService(LocationManager::class.java)
    }

    fun attach(host: SAWebHost) {
        if (hosts.none { it.get() === host }) hosts += WeakReference(host)
        updateRunning()
    }

    fun detach(host: SAWebHost) {
        hosts.removeAll { it.get() == null || it.get() === host }
        updateRunning()
    }

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(app, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(app, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    /** Call after the user granted/revoked location permission. */
    fun onPermissionsChanged() {
        main.post {
            stopUpdates()
            updateRunningNow()
        }
    }

    /** Re-evaluates whether updates are needed (visibility / navigation changed). */
    fun updateRunning() {
        if (Looper.myLooper() == Looper.getMainLooper()) updateRunningNow() else main.post { updateRunningNow() }
    }

    fun lastLocationJson(): String? = last?.let { toJson(it) }

    private fun wanted(): Boolean = hosts.any { ref ->
        val h = ref.get()
        h != null && !h.destroyed && (h.mode == WebMode.CAR || h.visible || h.navigating)
    }

    private fun updateRunningNow() {
        hosts.removeAll { it.get()?.destroyed != false }
        val want = wanted()
        if (want && !running) startUpdates() else if (!want && running) stopUpdates()
    }

    @SuppressLint("MissingPermission")
    private fun startUpdates() {
        if (!hasPermission()) {
            Log.i(TAG, "No location permission yet")
            return
        }
        val providers = try {
            lm.allProviders
        } catch (t: Throwable) {
            emptyList<String>()
        }
        var any = false
        if (LocationManager.GPS_PROVIDER in providers) {
            try {
                lm.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER, INTERVAL_MS, 0f, gpsListener, Looper.getMainLooper()
                )
                any = true
            } catch (t: Throwable) {
                Log.w(TAG, "GPS updates failed", t)
            }
        }
        if (LocationManager.NETWORK_PROVIDER in providers) {
            try {
                lm.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER, INTERVAL_MS, 0f, networkListener, Looper.getMainLooper()
                )
                any = true
            } catch (t: Throwable) {
                Log.w(TAG, "Network location updates failed", t)
            }
        }
        running = any
        Log.i(TAG, "Location updates ${if (any) "started" else "unavailable"}")
        seedLastKnown(providers)
    }

    private fun stopUpdates() {
        try {
            lm.removeUpdates(gpsListener)
            lm.removeUpdates(networkListener)
        } catch (t: Throwable) {
            Log.w(TAG, "removeUpdates failed", t)
        }
        if (running) Log.i(TAG, "Location updates stopped")
        running = false
    }

    @SuppressLint("MissingPermission")
    private fun seedLastKnown(providers: List<String>) {
        if (last != null) return
        val best = providers.mapNotNull { p ->
            try {
                lm.getLastKnownLocation(p)
            } catch (t: Throwable) {
                null
            }
        }.maxByOrNull { it.time } ?: return
        last = best
        push(best)
    }

    private fun onFix(location: Location, fromGps: Boolean) {
        val now = SystemClock.elapsedRealtime()
        if (fromGps) {
            lastGpsFixElapsed = now
        } else if (now - lastGpsFixElapsed < GPS_FRESH_MS) {
            return // GPS is healthy; ignore coarse network fixes
        }
        last = location
        push(location)
    }

    private fun push(location: Location) {
        val json = toJson(location)
        for (ref in hosts) ref.get()?.takeIf { !it.destroyed }?.callJs("onNativeLocation", json)
    }

    private fun toJson(l: Location): String = JSONObject()
        .put("lat", l.latitude)
        .put("lng", l.longitude)
        .put("accuracy", if (l.hasAccuracy()) l.accuracy.toDouble() else 100.0)
        .put("heading", if (l.hasBearing()) l.bearing.toDouble() else JSONObject.NULL)
        .put("speed", if (l.hasSpeed()) l.speed.toDouble() else JSONObject.NULL)
        .put("time", l.time)
        .toString()
}
