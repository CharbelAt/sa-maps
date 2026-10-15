package com.samaps.app

import android.app.Application
import android.content.pm.ApplicationInfo
import android.webkit.WebView
import com.samaps.app.media.MediaHub
import com.samaps.app.web.SAWebHost
import java.io.File

class SAMapsApp : Application() {
    override fun onCreate() {
        super.onCreate()
        CrashReporter.install(this)
        // The crash screen runs in its own process and must not repeat the start-up below.
        if (isCrashProcess()) return

        // Each piece is optional: if one fails on some device, report it and keep going.
        safely("webview debugging") {
            if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
                WebView.setWebContentsDebuggingEnabled(true) // chrome://inspect for debug builds
            }
        }
        safely("notification channel") { NavigationService.createChannel(this) }
        safely("NavHub") { NavHub.init(this) }
        safely("LocationHub") { LocationHub.init(this) }
        safely("VoiceHub") { VoiceHub.init(this) }
        safely("MediaHub") { MediaHub.init(this) }
        safely("service worker client") { SAWebHost.installServiceWorkerClient(this) }
    }

    private inline fun safely(what: String, block: () -> Unit) {
        try {
            block()
        } catch (t: Throwable) {
            CrashReporter.nonFatal(this, what, t)
        }
    }

    private fun isCrashProcess(): Boolean {
        val name = if (android.os.Build.VERSION.SDK_INT >= 28) {
            getProcessName()
        } else {
            runCatching { File("/proc/self/cmdline").readText().trim('\u0000', ' ') }.getOrDefault("")
        }
        return name.endsWith(":crash")
    }
}
