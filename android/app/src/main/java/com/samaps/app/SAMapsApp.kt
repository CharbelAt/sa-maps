package com.samaps.app

import android.app.Application
import android.content.pm.ApplicationInfo
import android.webkit.WebView
import com.samaps.app.media.MediaHub
import com.samaps.app.web.SAWebHost

class SAMapsApp : Application() {
    override fun onCreate() {
        super.onCreate()
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            // chrome://inspect for debug builds
            WebView.setWebContentsDebuggingEnabled(true)
        }
        NavigationService.createChannel(this)
        NavHub.init(this)
        LocationHub.init(this)
        VoiceHub.init(this)
        MediaHub.init(this)
        SAWebHost.installServiceWorkerClient(this)
    }
}
