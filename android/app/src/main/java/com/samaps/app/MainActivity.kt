package com.samaps.app

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.samaps.app.media.MediaHub
import com.samaps.app.web.SAWebHost
import com.samaps.app.web.WebMode
import java.util.Locale

/**
 * Phone UI: one full-screen, edge-to-edge WebView running the web app in `?mode=phone`.
 * Car session start/stop is pushed to it by [NavHub] via `SA.setDisplayMode`.
 */
class MainActivity : ComponentActivity(), SAWebHost.Callbacks {

    private var host: SAWebHost? = null
    private var started = false

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            LocationHub.onPermissionsChanged()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        createHost()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val h = host
                when {
                    h != null && h.webView.canGoBack() -> h.webView.goBack()
                    // Don't kill the phone navigation by backing out; just leave it running.
                    h != null && h.navigating -> moveTaskToBack(true)
                    else -> finish()
                }
            }
        })

        requestPermissionsIfNeeded()
    }

    private fun createHost() {
        // WebView itself can fail to start (missing/disabled/updating "Android System WebView").
        val h = try {
            SAWebHost(this, WebMode.PHONE, this)
        } catch (t: Throwable) {
            CrashReporter.nonFatal(this, "creating the map WebView", t)
            showStartError(t)
            return
        }
        host = h
        setContentView(
            h.webView,
            ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )
        ViewCompat.setOnApplyWindowInsetsListener(h.webView) { v, insets ->
            applyInsets(h, insets)
            // Keep WebView's own handling (it maps insets to CSS env(safe-area-inset-*)).
            ViewCompat.onApplyWindowInsets(v, insets)
        }
        h.visible = started
        h.load()
        if (started) h.webView.onResume()
    }

    private fun showStartError(t: Throwable) {
        val pad = (24 * resources.displayMetrics.density).toInt()
        setContentView(android.widget.TextView(this).apply {
            text = "SA Maps couldn't start its map view.\n\n" +
                "Make sure \"Android System WebView\" and \"Chrome\" are installed, enabled and up to date " +
                "in the Play Store, then reopen the app.\n\n(${t.javaClass.simpleName}: ${t.message})"
            setTextColor(android.graphics.Color.WHITE)
            setBackgroundColor(android.graphics.Color.BLACK)
            textSize = 16f
            setPadding(pad, pad * 3, pad, pad)
        })
    }

    /**
     * Edge-to-edge: besides env(safe-area-inset-*), expose system bar / cutout insets as CSS
     * variables --sa-inset-top/right/bottom/left (CSS px) in case the WebView reports zero.
     */
    private fun applyInsets(h: SAWebHost, insets: WindowInsetsCompat) {
        val i = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        val d = resources.displayMetrics.density.takeIf { it > 0f } ?: 1f
        fun px(v: Int) = String.format(Locale.US, "%.1fpx", v / d)
        val script = "(function(s){" +
            "s.setProperty('--sa-inset-top','${px(i.top)}');" +
            "s.setProperty('--sa-inset-right','${px(i.right)}');" +
            "s.setProperty('--sa-inset-bottom','${px(i.bottom)}');" +
            "s.setProperty('--sa-inset-left','${px(i.left)}');" +
            "})(document.documentElement.style)"
        h.insetsCssScript = script
        h.evalJs(script, null)
    }

    private fun requestPermissionsIfNeeded() {
        val needed = ArrayList<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            needed += Manifest.permission.ACCESS_FINE_LOCATION
            needed += Manifest.permission.ACCESS_COARSE_LOCATION
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            needed += Manifest.permission.POST_NOTIFICATIONS
        }
        if (needed.isNotEmpty()) permissionLauncher.launch(needed.toTypedArray())
    }

    override fun onStart() {
        super.onStart()
        started = true
        host?.let {
            it.visible = true
            it.webView.onResume()
        }
        LocationHub.updateRunning()
    }

    override fun onResume() {
        super.onResume()
        // The user may have just granted/revoked notification access in Settings.
        MediaHub.refresh()
    }

    override fun onStop() {
        started = false
        host?.let {
            it.visible = false
            // While navigating keep the page fully alive (announcements, rerouting).
            if (!it.navigating) it.webView.onPause()
        }
        LocationHub.updateRunning()
        super.onStop()
    }

    override fun onDestroy() {
        host?.destroy()
        host = null
        super.onDestroy()
    }

    // ---- SAWebHost.Callbacks ---------------------------------------------------------------

    override fun onKeepScreenOn(host: SAWebHost, on: Boolean) {
        if (on) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    override fun onRendererGone(host: SAWebHost) {
        if (this.host !== host || isFinishing || isDestroyed) return
        this.host = null
        createHost()
    }
}
