package com.samaps.app.media

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Exists only so that, once the user grants notification access,
 * MediaSessionManager.getActiveSessions(ComponentName) lets us see other apps' media sessions
 * (Spotify, YouTube Music, ...). Notifications themselves are ignored.
 */
class MediaListenerService : NotificationListenerService() {

    override fun onListenerConnected() {
        super.onListenerConnected()
        MediaHub.refresh()
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        MediaHub.refresh()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        // Not used.
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        // Not used.
    }
}
