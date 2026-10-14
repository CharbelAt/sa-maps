package com.samaps.app.web

import android.util.Log
import android.webkit.JavascriptInterface
import com.samaps.app.NavHub
import com.samaps.app.VoiceHub
import com.samaps.app.media.MediaHub

/**
 * `window.SANative` - the JS -> native half of the bridge (see ARCHITECTURE.md).
 * Every method is invoked on a WebView binder thread; anything touching views, TTS or
 * other WebViews hops to the main thread inside the called hub.
 */
class SANativeBridge(private val host: SAWebHost) {

    /** speaker "cj" | "smoke". Progress comes back via SA.onTtsEvent(id, start|done|error). */
    @JavascriptInterface
    fun speak(text: String?, speaker: String?, id: String?) {
        VoiceHub.speak(host, text.orEmpty(), speaker ?: "cj", id.orEmpty())
    }

    /**
     * Plays a neural-TTS audio clip (absolute https URL returning audio/wav). Shares the single
     * sequential voice queue with [speak]; falls back to device TTS of [text] when the clip fails
     * or has not started within 4 s.
     */
    @JavascriptInterface
    fun playClip(url: String?, text: String?, speaker: String?, id: String?) {
        VoiceHub.playClip(host, url.orEmpty(), text.orEmpty(), speaker ?: "cj", id.orEmpty())
    }

    /** Flushes the voice queue (TTS + clips). */
    @JavascriptInterface
    fun stopSpeaking() {
        VoiceHub.stop(host)
    }

    /** JSON string `[{name, locale, quality, network}]` of English voices. */
    @JavascriptInterface
    fun getVoices(): String = VoiceHub.voicesJson()

    /** `{"cj":{"voice":name|null,"pitch":0.95,"rate":1.05},"smoke":{...}}` */
    @JavascriptInterface
    fun setVoicePrefs(json: String?) {
        VoiceHub.setPrefs(json)
    }

    /** NavState JSON (throttled by the web to <= 2/s). */
    @JavascriptInterface
    fun onNavState(json: String?) {
        NavHub.onNavState(host, json)
    }

    @JavascriptInterface
    fun onWebReady() {
        host.handleWebReady()
    }

    @JavascriptInterface
    fun getMode(): String = host.mode.key

    @JavascriptInterface
    fun isCarActive(): Boolean = NavHub.carActive

    /** Forwards a place to the car WebView's SA.navigateTo. Returns "ok" or "no-car". */
    @JavascriptInterface
    fun sendToCar(json: String?): String = NavHub.sendToCar(json)

    /** Phone only; ignored for the car WebView. */
    @JavascriptInterface
    fun setKeepScreenOn(on: Boolean) {
        if (host.mode == WebMode.PHONE) host.handleKeepScreenOn(on)
    }

    @JavascriptInterface
    fun log(msg: String?) {
        Log.i("SAMaps/web-${host.mode.key}", msg.orEmpty())
    }

    // ---- phone media (Spotify, YouTube Music, ...) ---------------------------------------------

    /** JSON of the current now-playing state (same shape as SA.onMedia) or "null". */
    @JavascriptInterface
    fun mediaState(): String = MediaHub.stateJson

    /** play | pause | toggle | next | prev for the active media session. */
    @JavascriptInterface
    fun mediaCommand(cmd: String?) {
        MediaHub.command(cmd)
    }

    /** "granted" | "denied" (notification-listener access). */
    @JavascriptInterface
    fun mediaAccess(): String = if (MediaHub.hasAccess()) "granted" else "denied"

    /** Phone only: opens the notification-access settings. No-op from the car WebView. */
    @JavascriptInterface
    fun openMediaAccess() {
        if (host.mode == WebMode.PHONE) host.openMediaAccessSettings()
    }
}
