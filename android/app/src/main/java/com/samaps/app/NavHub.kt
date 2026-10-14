package com.samaps.app

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.samaps.app.web.SAWebHost
import com.samaps.app.web.WebMode
import org.json.JSONObject
import org.json.JSONTokener
import java.lang.ref.WeakReference
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Glue between the phone WebView, the car WebView and the Android Auto screens.
 * Holds weak refs to both WebViews, the latest car NavState and whether a car session is active.
 * Listener callbacks are always invoked on the main thread.
 */
@SuppressLint("StaticFieldLeak") // holds the Application context only
object NavHub {
    private const val TAG = "SAMaps/NavHub"
    private const val MAX_PENDING_CAR_CALLS = 8

    private lateinit var app: Context
    private val main = Handler(Looper.getMainLooper())

    @Volatile
    private var phoneRef: WeakReference<SAWebHost>? = null

    @Volatile
    private var carRef: WeakReference<SAWebHost>? = null

    val phoneHost: SAWebHost? get() = phoneRef?.get()?.takeIf { !it.destroyed }
    val carHost: SAWebHost? get() = carRef?.get()?.takeIf { !it.destroyed }

    /** True while an Android Auto session exists (the car owns navigation + voice). */
    @Volatile
    var carActive: Boolean = false
        private set

    /** Latest NavState pushed by the car WebView. */
    @Volatile
    var lastCarNavState: JSONObject? = null
        private set

    @Volatile
    var lastPhoneNavState: JSONObject? = null
        private set

    /** Car NavState listeners (NavScreen). */
    val carNavStateListeners = CopyOnWriteArrayList<(JSONObject) -> Unit>()

    /** Car session active/inactive listeners (MainActivity). */
    val carActiveListeners = CopyOnWriteArrayList<(Boolean) -> Unit>()

    /** Calls aimed at the car WebView before it finished loading (e.g. navigate intent). */
    private val pendingCarCalls = ArrayList<Pair<String, String>>()

    private var lastNotifText: String? = null

    fun init(context: Context) {
        app = context.applicationContext
    }

    // ---- hosts -------------------------------------------------------------------------------

    fun registerHost(host: SAWebHost) {
        when (host.mode) {
            WebMode.PHONE -> phoneRef = WeakReference(host)
            WebMode.CAR -> carRef = WeakReference(host)
        }
    }

    fun unregisterHost(host: SAWebHost) {
        if (phoneRef?.get() === host) phoneRef = null
        if (carRef?.get() === host) {
            carRef = null
            lastCarNavState = null
        }
        // A destroyed WebView no longer navigates.
        main.post { updateNavigationService() }
    }

    /** Called (main thread) after a host's `onWebReady` default pushes. */
    fun onHostReady(host: SAWebHost) {
        if (host.mode == WebMode.CAR) {
            val calls = ArrayList(pendingCarCalls)
            pendingCarCalls.clear()
            for ((fn, args) in calls) host.callJs(fn, args)
        }
    }

    // ---- car session -------------------------------------------------------------------------

    /** Main thread. */
    fun setCarActive(active: Boolean) {
        if (carActive == active) return
        carActive = active
        Log.i(TAG, "Car session ${if (active) "started" else "ended"}")
        if (active) {
            // The car takes over the voice: silence anything the phone was saying.
            VoiceHub.stopAll()
        } else {
            pendingCarCalls.clear()
            lastCarNavState = null
        }
        phoneHost?.pushDisplayMode()
        for (l in carActiveListeners) l(active)
        updateNavigationService()
    }

    /** Calls `SA.<fn>(args)` on the car WebView, queueing it until the WebView is ready. */
    fun callCar(fn: String, argsJson: String) {
        main.post {
            val car = carHost
            if (car != null && car.isReady) {
                car.callJs(fn, argsJson)
            } else if (carActive) {
                if (pendingCarCalls.size >= MAX_PENDING_CAR_CALLS) pendingCarCalls.removeAt(0)
                pendingCarCalls += fn to argsJson
            }
        }
    }

    fun carNavigateTo(place: JSONObject) = callCar("navigateTo", place.toString())

    fun carCommand(cmd: String, arg: Any? = null) {
        val args = if (arg == null) JSONObject.quote(cmd) else JSONObject.quote(cmd) + "," + jsonValue(arg)
        callCar("onCarCommand", args)
    }

    /** SANative.sendToCar(json) from the phone. Returns "ok" or "no-car". */
    fun sendToCar(json: String?): String {
        if (!carActive) return "no-car"
        val place = try {
            JSONTokener(json ?: "").nextValue() as? JSONObject
        } catch (t: Throwable) {
            null
        }
        if (place == null) {
            Log.w(TAG, "sendToCar: not a JSON object: $json")
            return "no-car"
        }
        carNavigateTo(place)
        return "ok"
    }

    /**
     * Asks the car WebView (or, if it is not up, the phone WebView - both share localStorage)
     * for `SA.getPlaces()`. [callback] runs on the main thread with the decoded object or null.
     */
    fun requestPlaces(callback: (JSONObject?) -> Unit) {
        val host = carHost?.takeIf { it.isReady } ?: phoneHost?.takeIf { it.isReady }
        if (host == null) {
            main.post { callback(null) }
            return
        }
        host.evalJs("(window.SA && SA.getPlaces) ? SA.getPlaces() : null") { raw ->
            callback(decodeJsonStringResult(raw))
        }
    }

    // ---- NavState ------------------------------------------------------------------------------

    /** SANative.onNavState(json) (binder thread). */
    fun onNavState(host: SAWebHost, json: String?) {
        val state = try {
            JSONObject(json ?: return)
        } catch (t: Throwable) {
            Log.w(TAG, "Bad NavState: $json")
            return
        }
        main.post {
            if (host.destroyed) return@post
            val wasNavigating = host.navigating
            host.navigating = state.optBoolean("navigating", false)
            when (host.mode) {
                WebMode.CAR -> {
                    lastCarNavState = state
                    for (l in carNavStateListeners) l(state)
                }
                WebMode.PHONE -> lastPhoneNavState = state
            }
            if (wasNavigating != host.navigating) LocationHub.updateRunning()
            updateNavigationService()
        }
    }

    /** Starts/stops/updates the location foreground service. Main thread. */
    private fun updateNavigationService() {
        val car = carHost
        val phone = phoneHost
        val carNav = car?.navigating == true
        val phoneNav = phone?.navigating == true
        if (!carNav && !phoneNav) {
            lastNotifText = null
            NavigationService.stop(app)
            return
        }
        val state = if (carNav) lastCarNavState else lastPhoneNavState
        val text = notificationText(state)
        NavigationService.start(app, text)
        if (text != lastNotifText) {
            lastNotifText = text
            NavigationService.update(app, text)
        }
    }

    private fun notificationText(state: JSONObject?): String? {
        if (state == null) return null
        if (state.optBoolean("rerouting")) return "Recalculating route…"
        val instruction = state.optJSONObject("next")?.optStr("instruction")
        val dest = state.optJSONObject("destination")?.optStr("name")
        return when {
            instruction != null && dest != null -> "$instruction · to $dest"
            instruction != null -> instruction
            dest != null -> "To $dest"
            else -> null
        }
    }

    // ---- helpers ---------------------------------------------------------------------------------

    private fun jsonValue(v: Any): String = when (v) {
        is String -> JSONObject.quote(v)
        is Number, is Boolean -> v.toString()
        is JSONObject -> v.toString()
        else -> JSONObject.quote(v.toString())
    }

    /**
     * `evaluateJavascript` returns the JSON encoding of the JS result. When the JS function
     * itself returns a JSON *string*, we get a JSON-encoded string that must be decoded twice.
     */
    fun decodeJsonStringResult(raw: String?): JSONObject? {
        if (raw.isNullOrBlank() || raw == "null" || raw == "undefined") return null
        return try {
            when (val first = JSONTokener(raw).nextValue()) {
                is JSONObject -> first
                is String -> if (first.isBlank()) null else JSONTokener(first).nextValue() as? JSONObject
                else -> null
            }
        } catch (t: Throwable) {
            Log.w(TAG, "Could not decode JS result: $raw", t)
            null
        }
    }
}
