package com.samaps.app.car

import android.annotation.SuppressLint
import android.content.pm.ApplicationInfo
import androidx.car.app.CarAppService
import androidx.car.app.Session
import androidx.car.app.validation.HostValidator

/** Android Auto entry point (NAVIGATION category). */
class SAMapsCarAppService : CarAppService() {

    // hosts_allowlist_sample is the library's published allowlist of Android Auto/AAOS hosts.
    @SuppressLint("PrivateResource")
    override fun createHostValidator(): HostValidator =
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
        } else {
            HostValidator.Builder(applicationContext)
                .addAllowedHosts(androidx.car.app.R.array.hosts_allowlist_sample)
                .build()
        }

    override fun onCreateSession(): Session = SAMapsSession()
}
