package com.samaps.app.web

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.GeolocationPermissions
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import androidx.webkit.ServiceWorkerClientCompat
import androidx.webkit.ServiceWorkerControllerCompat
import androidx.webkit.WebResourceErrorCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewFeature
import com.samaps.app.LocationHub
import com.samaps.app.NavHub
import com.samaps.app.VoiceHub
import com.samaps.app.media.MediaHub
import org.json.JSONObject

/** Which flavour of the web app a WebView hosts. */
enum class WebMode(val key: String) { PHONE("phone"), CAR("car") }

/**
 * One SA Maps WebView (phone or car) with everything the web app needs from native:
 * asset serving via WebViewAssetLoader, the `SANative` bridge, and helpers to call `window.SA`.
 *
 * Must be created and used on the main thread (except [callJs], which hops there itself).
 */
@SuppressLint("SetJavaScriptEnabled")
class SAWebHost(
    context: Context,
    val mode: WebMode,
    private val callbacks: Callbacks? = null,
) {
    interface Callbacks {
        /** Web app called `SANative.onWebReady()`; default state has already been pushed. */
        fun onWebReady(host: SAWebHost) {}

        /** `SANative.setKeepScreenOn(bool)` (phone only). Called on the main thread. */
        fun onKeepScreenOn(host: SAWebHost, on: Boolean) {}

        /** The renderer died; the host has been destroyed and should be recreated. */
        fun onRendererGone(host: SAWebHost) {}
    }

    private val appContext: Context = context.applicationContext
    private val main = Handler(Looper.getMainLooper())

    val webView: WebView = WebView(context)

    /** True once the page called `SANative.onWebReady()`. */
    @Volatile
    var isReady: Boolean = false
        private set

    /** Phone: activity started (visible). Car: always true while the session lives. */
    @Volatile
    var visible: Boolean = true

    /** Last NavState from this WebView said navigating=true. */
    @Volatile
    var navigating: Boolean = false
        internal set

    /** Car only: last `SA.setCarInsets` payload, re-pushed on onWebReady. */
    @Volatile
    var carInsetsJson: String? = null

    /** Phone only: JS snippet that applies the system-bar insets as CSS variables. */
    @Volatile
    var insetsCssScript: String? = null

    @Volatile
    var destroyed: Boolean = false
        private set

    private val assetLoader = buildAssetLoader(appContext)

    init {
        webView.setBackgroundColor(Color.BLACK)
        webView.isVerticalScrollBarEnabled = false
        webView.isHorizontalScrollBarEnabled = false
        webView.overScrollMode = WebView.OVER_SCROLL_NEVER
        webView.isFocusable = true
        webView.isFocusableInTouchMode = true
        // Keep the renderer at "important" priority even when not visible (locked phone / car).
        webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            @Suppress("DEPRECATION")
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            allowFileAccess = false
            allowContentAccess = false
            setGeolocationEnabled(true)
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100
            userAgentString = "$userAgentString SAMaps/1.0 (${mode.key})"
        }

        webView.webViewClient = Client()
        webView.webChromeClient = Chrome()
        webView.addJavascriptInterface(SANativeBridge(this), "SANative")

        NavHub.registerHost(this)
        LocationHub.attach(this)
    }

    /** Loads the bundled web app (or a fallback page when web/index.html was not packaged). */
    fun load() {
        if (hasBundledIndex()) {
            webView.loadUrl("$START_URL?mode=${mode.key}")
        } else {
            Log.w(TAG, "assets/web/index.html missing - showing placeholder")
            webView.loadDataWithBaseURL(
                "$ASSET_ORIGIN/assets/web/",
                PLACEHOLDER_HTML,
                "text/html",
                "utf-8",
                null
            )
        }
    }

    /** `window.SA && SA.fn(args)` on the main thread. [argsJson] is a JS argument list (JSON values). */
    fun callJs(fn: String, argsJson: String = "") {
        evalJs("window.SA && SA.$fn && SA.$fn($argsJson)", null)
    }

    /** Evaluates [script] on the main thread; [callback] receives the JSON-encoded result. */
    fun evalJs(script: String, callback: ((String?) -> Unit)?) {
        val run = Runnable {
            if (destroyed) {
                callback?.invoke(null)
                return@Runnable
            }
            try {
                webView.evaluateJavascript(script) { result -> callback?.invoke(result) }
            } catch (t: Throwable) {
                Log.w(TAG, "evaluateJavascript failed", t)
                callback?.invoke(null)
            }
        }
        if (Looper.myLooper() == Looper.getMainLooper()) run.run() else main.post(run)
    }

    /** Pushes `SA.setDisplayMode` for this WebView. */
    fun pushDisplayMode() {
        val json = JSONObject()
            .put("mode", mode.key)
            .put("carActive", NavHub.carActive)
        callJs("setDisplayMode", json.toString())
    }

    // ---- bridge entry points (binder thread) --------------------------------------------------

    internal fun handleWebReady() {
        main.post {
            if (destroyed) return@post
            isReady = true
            pushDisplayMode()
            if (mode == WebMode.CAR) carInsetsJson?.let { callJs("setCarInsets", it) }
            insetsCssScript?.let { evalJs(it, null) }
            LocationHub.lastLocationJson()?.let { callJs("onNativeLocation", it) }
            callJs("onMedia", MediaHub.stateJson)
            NavHub.onHostReady(this)
            callbacks?.onWebReady(this)
        }
    }

    internal fun handleKeepScreenOn(on: Boolean) {
        main.post { if (!destroyed) callbacks?.onKeepScreenOn(this, on) }
    }

    /** Phone only: notification-access settings (needed for MediaHub). */
    internal fun openMediaAccessSettings() {
        main.post { if (!destroyed) MediaHub.openAccessSettings(webView.context) }
    }

    fun destroy() {
        if (destroyed) return
        destroyed = true
        isReady = false
        LocationHub.detach(this)
        NavHub.unregisterHost(this)
        VoiceHub.forgetHost(this)
        try {
            (webView.parent as? android.view.ViewGroup)?.removeView(webView)
            webView.stopLoading()
            webView.removeJavascriptInterface("SANative")
            webView.destroy()
        } catch (t: Throwable) {
            Log.w(TAG, "WebView destroy failed", t)
        }
    }

    private fun hasBundledIndex(): Boolean = try {
        appContext.assets.open("web/index.html").close()
        true
    } catch (_: Exception) {
        false
    }

    private fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(appContext, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(appContext, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    // onRenderProcessGone IS implemented below; lint doesn't see it through WebViewClientCompat.
    @SuppressLint("MissingOnRenderProcessGone")
    private inner class Client : WebViewClientCompat() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
            assetLoader.shouldInterceptRequest(request.url)

        @Deprecated("Deprecated in Java")
        override fun shouldInterceptRequest(view: WebView, url: String): WebResourceResponse? =
            assetLoader.shouldInterceptRequest(url.toUri())

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            if (url.host == ASSET_HOST) return false
            if (!request.isForMainFrame) return false
            // Never navigate the app WebView away from the bundled app.
            if (mode == WebMode.PHONE) {
                try {
                    val intent = Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    appContext.startActivity(intent)
                } catch (_: ActivityNotFoundException) {
                    Log.w(TAG, "No activity for $url")
                } catch (t: Throwable) {
                    Log.w(TAG, "Could not open $url", t)
                }
            }
            return true
        }

        override fun onReceivedError(
            view: WebView,
            request: WebResourceRequest,
            error: WebResourceErrorCompat,
        ) {
            if (request.isForMainFrame && request.url.host == ASSET_HOST) {
                Log.w(TAG, "Main frame failed to load: ${request.url}")
                view.loadDataWithBaseURL(
                    "$ASSET_ORIGIN/assets/web/",
                    PLACEHOLDER_HTML,
                    "text/html",
                    "utf-8",
                    null
                )
            }
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            Log.e(TAG, "WebView renderer gone (crash=${detail.didCrash()}) for ${mode.key}")
            destroy()
            callbacks?.onRendererGone(this@SAWebHost)
            return true
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
            Log.d(
                "SAMaps/js-${mode.key}",
                "${consoleMessage.message()} (${consoleMessage.sourceId()}:${consoleMessage.lineNumber()})"
            )
            return true
        }

        override fun onGeolocationPermissionsShowPrompt(
            origin: String,
            callback: GeolocationPermissions.Callback,
        ) {
            callback.invoke(origin, hasLocationPermission(), false)
        }
    }

    companion object {
        private const val TAG = "SAMaps/Web"
        const val ASSET_HOST = WebViewAssetLoader.DEFAULT_DOMAIN
        const val ASSET_ORIGIN = "https://$ASSET_HOST"
        const val START_URL = "$ASSET_ORIGIN/assets/web/index.html"

        private const val PLACEHOLDER_HTML = """<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#000;color:#fff;font-family:sans-serif}
.b{display:flex;height:100%;align-items:center;justify-content:center;text-align:center;padding:24px;box-sizing:border-box}
h1{color:#f2ce1b;font-size:28px;margin:0 0 12px}</style></head>
<body><div class="b"><div><h1>SA Maps</h1><p>The web app is not bundled in this build (assets/web/index.html missing).</p></div></div></body></html>"""

        private fun buildAssetLoader(context: Context): WebViewAssetLoader =
            WebViewAssetLoader.Builder()
                .setDomain(ASSET_HOST)
                .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
                .build()

        /**
         * Requests made by the web app's service worker do not go through WebViewClient; route
         * them through the asset loader too so `sw.js` can fetch/cache the bundled files.
         */
        fun installServiceWorkerClient(context: Context) {
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE) ||
                !WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_SHOULD_INTERCEPT_REQUEST)
            ) return
            try {
                val loader = buildAssetLoader(context.applicationContext)
                ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(
                    object : ServiceWorkerClientCompat() {
                        override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? =
                            loader.shouldInterceptRequest(request.url)
                    }
                )
            } catch (t: Throwable) {
                Log.w(TAG, "Service worker client not installed", t)
            }
        }
    }
}
