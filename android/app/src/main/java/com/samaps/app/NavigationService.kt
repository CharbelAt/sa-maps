package com.samaps.app

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Location foreground service, alive while a NavState with navigating=true is active (phone or
 * car). It keeps the process allowed to receive GPS fixes with the phone locked; the actual
 * location work happens in [LocationHub].
 *
 * start/stop are only called from the main thread (via [NavHub]).
 */
class NavigationService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = buildNotification(this, currentText)
        try {
            val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            } else {
                0
            }
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
            running = true
        } catch (t: Throwable) {
            // E.g. location permission missing on Android 14+, or background start restrictions.
            Log.w(TAG, "startForeground failed", t)
            starting = false
            lastFailureAt = SystemClock.elapsedRealtime()
            stopSelf()
            return START_NOT_STICKY
        }
        starting = false
        if (!wanted) stopSelf() // navigation ended before we got here
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        running = false
        starting = false
        super.onDestroy()
    }

    companion object {
        private const val TAG = "SAMaps/NavService"
        const val CHANNEL_ID = "sa_navigation"
        private const val NOTIFICATION_ID = 4201
        private const val RETRY_BACKOFF_MS = 30_000L

        private var lastFailureAt = -RETRY_BACKOFF_MS
        private var wanted = false
        private var running = false
        private var starting = false
        private var currentText: String? = null

        fun createChannel(context: Context) {
            val nm = context.getSystemService(NotificationManager::class.java) ?: return
            val channel = NotificationChannel(
                CHANNEL_ID,
                context.getString(R.string.notif_channel_nav),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = context.getString(R.string.notif_channel_nav_desc)
                setShowBadge(false)
            }
            nm.createNotificationChannel(channel)
        }

        fun start(context: Context, text: String?) {
            wanted = true
            currentText = text
            if (running || starting) return
            // Don't hammer a start that keeps failing (NavState arrives ~2/s).
            if (SystemClock.elapsedRealtime() - lastFailureAt < RETRY_BACKOFF_MS) return
            starting = true
            try {
                ContextCompat.startForegroundService(context, Intent(context, NavigationService::class.java))
            } catch (t: Throwable) {
                // ForegroundServiceStartNotAllowedException etc. GPS still works while visible.
                Log.w(TAG, "Could not start navigation service", t)
                starting = false
                lastFailureAt = SystemClock.elapsedRealtime()
            }
        }

        fun stop(context: Context) {
            wanted = false
            // If it is still starting, onStartCommand stops it right after startForeground().
            if (running) {
                running = false
                context.stopService(Intent(context, NavigationService::class.java))
            }
        }

        fun update(context: Context, text: String?) {
            currentText = text
            if (!running) return
            if (Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
            ) return
            try {
                context.getSystemService(NotificationManager::class.java)
                    ?.notify(NOTIFICATION_ID, buildNotification(context, text))
            } catch (t: Throwable) {
                Log.w(TAG, "notify failed", t)
            }
        }

        private fun buildNotification(context: Context, text: String?): Notification {
            val open = PendingIntent.getActivity(
                context,
                0,
                Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
            return NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(context.getString(R.string.notif_navigating_title))
                .setContentText(text ?: context.getString(R.string.notif_navigating_text))
                .setContentIntent(open)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .build()
        }
    }
}
