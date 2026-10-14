package com.samaps.app.media

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.util.Base64
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import androidx.core.graphics.createBitmap
import androidx.core.graphics.scale
import com.samaps.app.NavHub
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * "Now playing" for whatever media app is active on the phone (Spotify, YouTube Music, ...).
 * Needs notification-listener access ([MediaListenerService]); without it everything degrades to
 * `null` / "denied" and nothing else in the app (car included) depends on it.
 *
 * Pushes `SA.onMedia(state|null)` to the phone and car WebViews: immediately when the track or
 * play/pause changes, otherwise throttled to <= 2/s. All state lives on the main thread except
 * [stateJson], which the JS bridge reads from binder threads.
 */
@SuppressLint("StaticFieldLeak") // holds the Application context only
object MediaHub {
    private const val TAG = "SAMaps/Media"
    private const val MIN_PUSH_INTERVAL_MS = 500L
    private const val ART_SIZE_PX = 256 // shown at ~84 css px on high-dpi car/phone screens

    private lateinit var app: Context
    private lateinit var component: ComponentName
    private val main = Handler(Looper.getMainLooper())
    private var sessionManager: MediaSessionManager? = null
    private var sessionsListenerRegistered = false
    private var controller: MediaController? = null

    /** Current state as JSON (object or "null"), readable from any thread. */
    @Volatile
    var stateJson: String = "null"
        private set

    private var lastKey: String? = null
    private var lastPushAt = 0L
    private var pushPending = false
    private val deferredPush = Runnable {
        pushPending = false
        pushNow()
    }

    private var artSource: Bitmap? = null
    private var artData: String? = null

    private val sessionsListener = MediaSessionManager.OnActiveSessionsChangedListener { controllers ->
        main.post { onSessions(controllers.orEmpty()) }
    }

    private val controllerCallback = object : MediaController.Callback() {
        override fun onPlaybackStateChanged(state: PlaybackState?) {
            // Another session may have become the one to show (e.g. this one paused).
            if (!isPlaying(state)) reselect() else publish()
        }

        override fun onMetadataChanged(metadata: MediaMetadata?) = publish()

        override fun onSessionDestroyed() {
            detachController()
            reselect()
        }
    }

    fun init(context: Context) {
        app = context.applicationContext
        component = ComponentName(app, MediaListenerService::class.java)
        sessionManager = app.getSystemService(MediaSessionManager::class.java)
        refresh()
    }

    fun hasAccess(): Boolean = try {
        NotificationManagerCompat.getEnabledListenerPackages(app).contains(app.packageName)
    } catch (t: Throwable) {
        false
    }

    /** Re-checks access and the active sessions (app resume, car session start, listener bind). */
    fun refresh() {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            main.post { refresh() }
            return
        }
        val msm = sessionManager
        if (msm == null || !hasAccess()) {
            teardown()
            return
        }
        if (!sessionsListenerRegistered) {
            try {
                msm.addOnActiveSessionsChangedListener(sessionsListener, component, main)
                sessionsListenerRegistered = true
            } catch (e: SecurityException) {
                // Access was just revoked or the listener isn't bound yet.
                teardown()
                return
            } catch (t: Throwable) {
                Log.w(TAG, "addOnActiveSessionsChangedListener failed", t)
            }
        }
        reselect()
    }

    /** SANative.mediaCommand(cmd): play | pause | toggle | next | prev. */
    fun command(cmd: String?) {
        main.post {
            val c = controller ?: return@post
            val tc = c.transportControls
            try {
                when (cmd?.trim()?.lowercase()) {
                    "play" -> tc.play()
                    "pause" -> tc.pause()
                    "toggle" -> if (isPlaying(c.playbackState)) tc.pause() else tc.play()
                    "next" -> tc.skipToNext()
                    "prev", "previous" -> tc.skipToPrevious()
                    else -> Log.w(TAG, "Unknown media command: $cmd")
                }
            } catch (t: Throwable) {
                Log.w(TAG, "Media command '$cmd' failed", t)
            }
        }
    }

    /** Opens the notification-access settings (phone only; callers must not use it from the car). */
    fun openAccessSettings(context: Context) {
        try {
            context.startActivity(
                Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (e: ActivityNotFoundException) {
            Log.w(TAG, "No notification-listener settings screen", e)
        } catch (t: Throwable) {
            Log.w(TAG, "Could not open notification-listener settings", t)
        }
    }

    // ---- sessions (main thread) ------------------------------------------------------------------

    private fun reselect() {
        val msm = sessionManager ?: return
        val sessions = try {
            msm.getActiveSessions(component)
        } catch (e: SecurityException) {
            teardown()
            return
        } catch (t: Throwable) {
            Log.w(TAG, "getActiveSessions failed", t)
            emptyList()
        }
        onSessions(sessions)
    }

    private fun onSessions(sessions: List<MediaController>) {
        val candidates = sessions.filter { it.packageName != app.packageName }
        // Prefer a playing session; otherwise the first one (the system orders by recency/priority).
        val best = candidates.firstOrNull { isPlaying(it.playbackState) } ?: candidates.firstOrNull()
        val current = controller
        if (best == null) {
            detachController()
        } else if (current == null || current.sessionToken != best.sessionToken) {
            detachController()
            controller = best
            try {
                best.registerCallback(controllerCallback, main)
            } catch (t: Throwable) {
                Log.w(TAG, "registerCallback failed", t)
            }
        }
        publish()
    }

    private fun detachController() {
        controller?.let {
            try {
                it.unregisterCallback(controllerCallback)
            } catch (_: Throwable) {
            }
        }
        controller = null
    }

    private fun teardown() {
        detachController()
        if (sessionsListenerRegistered) {
            try {
                sessionManager?.removeOnActiveSessionsChangedListener(sessionsListener)
            } catch (_: Throwable) {
            }
            sessionsListenerRegistered = false
        }
        artSource = null
        artData = null
        publish()
    }

    // ---- state -----------------------------------------------------------------------------------

    private fun isPlaying(state: PlaybackState?): Boolean = when (state?.state) {
        PlaybackState.STATE_PLAYING,
        PlaybackState.STATE_BUFFERING,
        PlaybackState.STATE_FAST_FORWARDING,
        PlaybackState.STATE_REWINDING,
        PlaybackState.STATE_SKIPPING_TO_NEXT,
        PlaybackState.STATE_SKIPPING_TO_PREVIOUS,
        PlaybackState.STATE_SKIPPING_TO_QUEUE_ITEM -> true
        else -> false
    }

    private fun publish() {
        val c = controller
        val json: String
        val key: String
        if (c == null) {
            json = "null"
            key = "null"
        } else {
            val md = c.metadata
            val pkg = c.packageName
            val title = md?.getString(MediaMetadata.METADATA_KEY_TITLE)
                ?: md?.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE)
                ?: md?.description?.title?.toString()
            val artist = md?.getString(MediaMetadata.METADATA_KEY_ARTIST)
                ?: md?.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST)
                ?: md?.getString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE)
                ?: md?.description?.subtitle?.toString()
            val playing = isPlaying(c.playbackState)
            json = JSONObject()
                .put("package", pkg)
                .put("app", appLabel(pkg))
                .put("title", title?.takeIf { it.isNotBlank() } ?: JSONObject.NULL)
                .put("artist", artist?.takeIf { it.isNotBlank() } ?: JSONObject.NULL)
                .put("playing", playing)
                .put("art", art(md) ?: JSONObject.NULL)
                .toString()
            key = "$pkg|$title|$artist|$playing"
        }
        if (json == stateJson) return
        stateJson = json
        if (key != lastKey) {
            // Track / play-pause / app changed: push right away.
            lastKey = key
            main.removeCallbacks(deferredPush)
            pushPending = false
            pushNow()
        } else {
            val elapsed = SystemClock.elapsedRealtime() - lastPushAt
            if (elapsed >= MIN_PUSH_INTERVAL_MS) {
                main.removeCallbacks(deferredPush)
                pushPending = false
                pushNow()
            } else if (!pushPending) {
                pushPending = true
                main.postDelayed(deferredPush, MIN_PUSH_INTERVAL_MS - elapsed)
            }
        }
    }

    private fun pushNow() {
        lastPushAt = SystemClock.elapsedRealtime()
        val json = stateJson
        NavHub.phoneHost?.callJs("onMedia", json)
        NavHub.carHost?.callJs("onMedia", json)
    }

    private val labelCache = HashMap<String, String>()

    private fun appLabel(pkg: String): String = labelCache.getOrPut(pkg) {
        try {
            val pm = app.packageManager
            pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
        } catch (e: PackageManager.NameNotFoundException) {
            pkg // not visible to us (package visibility) - fall back to the package name
        } catch (t: Throwable) {
            pkg
        }
    }

    /** Small JPEG data URL of the album art (max side [ART_SIZE_PX]), cached per bitmap. */
    private fun art(md: MediaMetadata?): String? {
        val src = md?.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
            ?: md?.getBitmap(MediaMetadata.METADATA_KEY_ART)
            ?: md?.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)
            ?: md?.description?.iconBitmap
        if (src == null) {
            artSource = null
            artData = null
            return null
        }
        if (src === artSource) return artData
        artSource = src
        artData = try {
            encodeArt(src)
        } catch (t: Throwable) {
            Log.w(TAG, "Album art encode failed", t)
            null
        }
        return artData
    }

    private fun encodeArt(original: Bitmap): String? {
        if (original.isRecycled || original.width <= 0 || original.height <= 0) return null
        // Hardware bitmaps can't be drawn on a software canvas; copy them first.
        val src = if (original.config == Bitmap.Config.HARDWARE) {
            original.copy(Bitmap.Config.ARGB_8888, false) ?: return null
        } else {
            original
        }
        val ratio = ART_SIZE_PX.toFloat() / max(src.width, src.height)
        val w = max(1, (src.width * ratio).roundToInt())
        val h = max(1, (src.height * ratio).roundToInt())
        val scaled = if (ratio < 1f) src.scale(w, h) else src
        // JPEG has no alpha: flatten onto black (the HUD background).
        val flat = createBitmap(scaled.width, scaled.height)
        Canvas(flat).apply {
            drawColor(Color.BLACK)
            drawBitmap(scaled, 0f, 0f, null)
        }
        if (scaled !== src) scaled.recycle()
        if (src !== original) src.recycle()
        val out = ByteArrayOutputStream()
        flat.compress(Bitmap.CompressFormat.JPEG, 82, out)
        flat.recycle()
        return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }
}
