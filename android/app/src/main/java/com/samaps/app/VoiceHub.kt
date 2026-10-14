package com.samaps.app

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.annotation.SuppressLint
import android.util.Log
import androidx.core.net.toUri
import com.samaps.app.web.SAWebHost
import com.samaps.app.web.WebMode
import org.json.JSONArray
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.util.Locale
import java.util.concurrent.atomic.AtomicLong

/**
 * The crew's voice. One sequential queue shared by device-TTS lines ([speak]) and neural-TTS
 * audio clips ([playClip]); one TextToSpeech instance; navigation-guidance audio attributes and
 * transient "may duck" audio focus held while the queue is non-empty.
 *
 * Owner rule: while an Android Auto session is active only the car WebView may talk; calls from
 * the phone WebView are ignored silently.
 *
 * All queue state is confined to the main thread.
 */
@SuppressLint("StaticFieldLeak") // holds the Application context only
object VoiceHub {
    private const val TAG = "SAMaps/Voice"
    private const val CLIP_START_TIMEOUT_MS = 4_000L
    private const val TTS_INIT_TIMEOUT_MS = 8_000L
    private const val TTS_START_TIMEOUT_MS = 6_000L
    private const val FOCUS_RELEASE_DELAY_MS = 350L

    /** Substrings of engine voice names that are (usually) male English voices, best first. */
    private val MALE_HINTS = listOf(
        "-x-iom", "-x-iol", "-x-tpd", "-x-ioq", "-x-rjs", "-x-gbd", "-x-aud", "male"
    )

    data class Pref(val voice: String?, val pitch: Float, val rate: Float)

    private val DEFAULT_PREFS = mapOf(
        "cj" to Pref(null, 0.95f, 1.05f),
        "smoke" to Pref(null, 0.72f, 0.92f),
    )

    private class Item(
        val host: WeakReference<SAWebHost>,
        val webId: String,
        val speaker: String,
        val text: String,
        val clipUrl: String?,
    ) {
        var usingTts = clipUrl == null
        var startEmitted = false
        var ttsStarted = false
        var uttId: String? = null
        var player: MediaPlayer? = null
    }

    private lateinit var app: Context
    private lateinit var audio: AudioManager
    private val main = Handler(Looper.getMainLooper())

    private var tts: TextToSpeech? = null

    /** 0 = initialising, 1 = ready, -1 = failed. */
    @Volatile
    private var ttsState = 0

    @Volatile
    private var voicesCache: List<Voice> = emptyList()

    @Volatile
    private var prefs: Map<String, Pref> = DEFAULT_PREFS

    private var autoCj: Voice? = null
    private var autoSmoke: Voice? = null
    private var appliedVoiceKey: String? = null

    private val queue = ArrayDeque<Item>()
    private var current: Item? = null
    private val seq = AtomicLong()
    private var watchdog: Runnable? = null

    private val attrs: AudioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()

    private var focusRequest: AudioFocusRequest? = null
    private var hasFocus = false
    private val releaseFocusRunnable = Runnable {
        if (current == null && queue.isEmpty()) abandonFocus()
    }

    fun init(context: Context) {
        app = context.applicationContext
        audio = app.getSystemService(AudioManager::class.java)
        focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(attrs)
            .setOnAudioFocusChangeListener({ change ->
                if (change == AudioManager.AUDIOFOCUS_LOSS) hasFocus = false
            }, main)
            .build()
        tts = TextToSpeech(app) { status -> main.post { onTtsInit(status) } }
    }

    // ---- public API (any thread) ----------------------------------------------------------------

    fun speak(host: SAWebHost, text: String, speaker: String, webId: String) {
        if (!mayTalk(host)) return
        val item = Item(WeakReference(host), webId, normSpeaker(speaker), text, null)
        main.post { enqueue(item) }
    }

    fun playClip(host: SAWebHost, url: String, text: String, speaker: String, webId: String) {
        if (!mayTalk(host)) return
        val item = Item(WeakReference(host), webId, normSpeaker(speaker), text, url.trim())
        main.post { enqueue(item) }
    }

    /** SANative.stopSpeaking() - flushes everything (ignored for the phone while the car owns voice). */
    fun stop(host: SAWebHost) {
        if (!mayTalk(host)) return
        main.post { flushAll(notify = true) }
    }

    /** Flush everything, e.g. when the car session takes over the voice. */
    fun stopAll() {
        main.post { flushAll(notify = true) }
    }

    /** Drops anything queued by a WebView that is being destroyed. */
    fun forgetHost(host: SAWebHost) {
        main.post {
            queue.removeAll { val h = it.host.get(); h == null || h === host }
            val cur = current
            if (cur != null && cur.host.get().let { it == null || it === host }) {
                cancelWatchdog()
                releasePlayer(cur)
                if (cur.usingTts) tts?.stop()
                current = null
                pump()
            }
        }
    }

    fun voicesJson(): String {
        val arr = JSONArray()
        try {
            val voices = voicesCache.ifEmpty { loadVoices() }
            voices.filter { isEnglish(it) && isInstalled(it) }
                .sortedBy { it.name }
                .forEach { v ->
                    arr.put(
                        JSONObject()
                            .put("name", v.name)
                            .put("locale", v.locale.toLanguageTag())
                            .put("quality", v.quality)
                            .put("network", v.isNetworkConnectionRequired)
                    )
                }
        } catch (t: Throwable) {
            Log.w(TAG, "getVoices failed", t)
        }
        return arr.toString()
    }

    fun setPrefs(json: String?) {
        if (json.isNullOrBlank()) return
        try {
            val o = JSONObject(json)
            val next = HashMap(prefs)
            for (sp in DEFAULT_PREFS.keys) {
                val p = o.optJSONObject(sp) ?: continue
                val def = DEFAULT_PREFS.getValue(sp)
                val voice = if (p.isNull("voice")) null else p.optString("voice").takeIf { it.isNotBlank() }
                val pitch = p.optDouble("pitch", def.pitch.toDouble()).toFloat()
                val rate = p.optDouble("rate", def.rate.toDouble()).toFloat()
                next[sp] = Pref(
                    voice,
                    if (pitch.isFinite()) pitch.coerceIn(0.1f, 2.5f) else def.pitch,
                    if (rate.isFinite()) rate.coerceIn(0.1f, 3.0f) else def.rate,
                )
            }
            prefs = next
            main.post { appliedVoiceKey = null }
        } catch (t: Throwable) {
            Log.w(TAG, "Bad voice prefs: $json", t)
        }
    }

    // ---- queue (main thread) ---------------------------------------------------------------------

    private fun mayTalk(host: SAWebHost): Boolean =
        !host.destroyed && !(host.mode == WebMode.PHONE && NavHub.carActive)

    private fun normSpeaker(s: String): String = if (s.equals("smoke", ignoreCase = true)) "smoke" else "cj"

    private fun enqueue(item: Item) {
        if (!mayTalkNow(item)) return
        queue.addLast(item)
        main.removeCallbacks(releaseFocusRunnable)
        pump()
    }

    private fun mayTalkNow(item: Item): Boolean {
        val h = item.host.get() ?: return false
        return mayTalk(h)
    }

    private fun pump() {
        if (current != null) return
        while (true) {
            val next = queue.removeFirstOrNull()
            if (next == null) {
                main.removeCallbacks(releaseFocusRunnable)
                main.postDelayed(releaseFocusRunnable, FOCUS_RELEASE_DELAY_MS)
                return
            }
            if (!mayTalkNow(next)) continue
            current = next
            requestFocus()
            if (next.clipUrl != null && isHttpUrl(next.clipUrl)) {
                startClip(next)
            } else {
                next.usingTts = true
                speakTts(next)
            }
            return
        }
    }

    private fun finishCurrent(event: String) {
        val item = current ?: return
        cancelWatchdog()
        releasePlayer(item)
        current = null
        item.host.get()?.let { emit(it, item.webId, event) }
        pump()
    }

    private fun flushAll(notify: Boolean) {
        cancelWatchdog()
        val flushed = ArrayList<Item>()
        current?.let { flushed += it; releasePlayer(it) }
        current = null
        flushed.addAll(queue)
        queue.clear()
        try {
            tts?.stop()
        } catch (t: Throwable) {
            Log.w(TAG, "tts.stop failed", t)
        }
        if (notify) {
            for (it in flushed) it.host.get()?.let { h -> emit(h, it.webId, "done") }
        }
        main.removeCallbacks(releaseFocusRunnable)
        abandonFocus()
    }

    // ---- clips -----------------------------------------------------------------------------------

    private fun isHttpUrl(url: String): Boolean =
        url.startsWith("https://", ignoreCase = true) || url.startsWith("http://", ignoreCase = true)

    private fun startClip(item: Item) {
        val mp = MediaPlayer()
        item.player = mp
        try {
            mp.setAudioAttributes(attrs)
            mp.setOnPreparedListener { p ->
                if (current !== item || item.player !== p) return@setOnPreparedListener
                try {
                    p.start()
                    cancelWatchdog()
                    emitStart(item)
                } catch (t: Throwable) {
                    clipFailed(item, "start failed: ${t.message}")
                }
            }
            mp.setOnCompletionListener { p ->
                if (current === item && item.player === p) finishCurrent("done")
            }
            mp.setOnErrorListener { p, what, extra ->
                if (current === item && item.player === p) clipFailed(item, "MediaPlayer error $what/$extra")
                true
            }
            mp.setDataSource(app, item.clipUrl.orEmpty().toUri(), mapOf("User-Agent" to "SAMaps/1.0"))
            mp.prepareAsync()
            armWatchdog(CLIP_START_TIMEOUT_MS) {
                if (current === item && !item.usingTts && !item.startEmitted) clipFailed(item, "timeout")
            }
        } catch (t: Throwable) {
            clipFailed(item, "setup failed: ${t.message}")
        }
    }

    private fun clipFailed(item: Item, reason: String) {
        if (current !== item) return
        Log.w(TAG, "Clip failed ($reason): ${item.clipUrl}")
        cancelWatchdog()
        releasePlayer(item)
        if (item.startEmitted) {
            // It was already audible; don't repeat the line with TTS.
            finishCurrent("done")
            return
        }
        item.usingTts = true
        speakTts(item)
    }

    private fun releasePlayer(item: Item) {
        val p = item.player ?: return
        item.player = null
        try {
            p.setOnPreparedListener(null)
            p.setOnCompletionListener(null)
            p.setOnErrorListener(null)
            p.reset()
            p.release()
        } catch (t: Throwable) {
            Log.w(TAG, "MediaPlayer release failed", t)
        }
    }

    // ---- TTS -------------------------------------------------------------------------------------

    private fun speakTts(item: Item) {
        if (item.text.isBlank()) {
            finishCurrent(if (item.startEmitted) "done" else "error")
            return
        }
        when (ttsState) {
            -1 -> {
                finishCurrent("error")
                return
            }
            0 -> {
                // onTtsInit() will start it; give up if the engine never comes up.
                armWatchdog(TTS_INIT_TIMEOUT_MS) { if (current === item) finishCurrent("error") }
                return
            }
        }
        val t = tts ?: run { finishCurrent("error"); return }
        try {
            applySpeaker(t, item.speaker)
            val uttId = "sa-${seq.incrementAndGet()}"
            item.uttId = uttId
            val r = t.speak(item.text, TextToSpeech.QUEUE_ADD, Bundle(), uttId)
            if (r != TextToSpeech.SUCCESS) {
                finishCurrent("error")
                return
            }
            armWatchdog(TTS_START_TIMEOUT_MS) {
                if (current === item && !item.ttsStarted) {
                    try { t.stop() } catch (_: Throwable) {}
                    finishCurrent("error")
                }
            }
        } catch (e: Throwable) {
            Log.w(TAG, "TTS speak failed", e)
            finishCurrent("error")
        }
    }

    private fun onTtsInit(status: Int) {
        val t = tts ?: return
        if (status != TextToSpeech.SUCCESS) {
            Log.w(TAG, "TextToSpeech init failed: $status")
            ttsState = -1
            if (current?.usingTts == true) finishCurrent("error")
            return
        }
        try {
            t.setAudioAttributes(attrs)
            t.setOnUtteranceProgressListener(progressListener)
            if (t.isLanguageAvailable(Locale.US) >= TextToSpeech.LANG_AVAILABLE) t.setLanguage(Locale.US)
            voicesCache = loadVoices()
            pickAutoVoices()
        } catch (e: Throwable) {
            Log.w(TAG, "TTS setup failed", e)
        }
        ttsState = 1
        val cur = current
        if (cur != null && cur.usingTts && cur.uttId == null) {
            cancelWatchdog()
            speakTts(cur)
        }
    }

    private val progressListener = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) {
            main.post {
                val item = current ?: return@post
                if (item.uttId != utteranceId) return@post
                item.ttsStarted = true
                emitStart(item)
                // Safety net in case the engine never reports completion.
                val maxMs = 20_000L + item.text.length * 150L
                armWatchdog(maxMs) {
                    if (current === item) {
                        try { tts?.stop() } catch (_: Throwable) {}
                        finishCurrent("done")
                    }
                }
            }
        }

        override fun onDone(utteranceId: String?) {
            main.post { if (current?.uttId == utteranceId) finishCurrent("done") }
        }

        @Deprecated("Deprecated in Java")
        override fun onError(utteranceId: String?) {
            main.post { if (current?.uttId == utteranceId) finishCurrent("error") }
        }

        override fun onError(utteranceId: String?, errorCode: Int) {
            main.post { if (current?.uttId == utteranceId) finishCurrent("error") }
        }

        override fun onStop(utteranceId: String?, interrupted: Boolean) {
            main.post { if (current?.uttId == utteranceId) finishCurrent("done") }
        }
    }

    private fun applySpeaker(t: TextToSpeech, speaker: String) {
        val pref = prefs[speaker] ?: DEFAULT_PREFS.getValue("cj")
        val voice = resolveVoice(pref, speaker)
        val key = voice?.name ?: "<default>"
        if (key != appliedVoiceKey) {
            try {
                if (voice != null) {
                    t.setVoice(voice)
                } else if (t.isLanguageAvailable(Locale.US) >= TextToSpeech.LANG_AVAILABLE) {
                    t.setLanguage(Locale.US)
                } else {
                    t.defaultVoice?.let { t.setVoice(it) }
                }
                appliedVoiceKey = key
            } catch (e: Throwable) {
                Log.w(TAG, "setVoice failed for $key", e)
            }
        }
        t.setPitch(pref.pitch)
        t.setSpeechRate(pref.rate)
    }

    private fun resolveVoice(pref: Pref, speaker: String): Voice? {
        val wanted = pref.voice
        if (wanted != null) {
            voicesCache.firstOrNull { it.name == wanted }?.let { return it }
        }
        return if (speaker == "smoke") autoSmoke else autoCj
    }

    private fun loadVoices(): List<Voice> = try {
        tts?.voices?.toList() ?: emptyList()
    } catch (t: Throwable) {
        emptyList()
    }

    private fun isEnglish(v: Voice) = v.locale.language == "en"

    private fun isInstalled(v: Voice) =
        !v.features.orEmpty().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)

    /** Picks two different male-sounding English voices (CJ, Big Smoke), or none. */
    private fun pickAutoVoices() {
        val english = voicesCache.filter { isEnglish(it) && isInstalled(it) }
        val order = compareBy<Voice>(
            { it.isNetworkConnectionRequired },
            { if (it.locale.country == "US") 0 else 1 },
            { -it.quality },
        )
        val picks = ArrayList<Voice>()
        for (hint in MALE_HINTS) {
            val matches = english.filter {
                val n = it.name.lowercase(Locale.ROOT)
                n.contains(hint) && !(hint == "male" && n.contains("female"))
            }.sortedWith(order)
            // One voice per named speaker hint (local/network variants are the same person);
            // the generic "male" hint may contribute several distinct voices.
            val take = if (hint == "male") 2 else 1
            for (v in matches.take(take)) {
                if (picks.none { it.name == v.name }) picks += v
                if (picks.size == 2) break
            }
            if (picks.size == 2) break
        }
        if (picks.size >= 2) {
            autoCj = picks[0]
            autoSmoke = picks[1]
        } else {
            autoCj = null
            autoSmoke = null
        }
        Log.i(TAG, "Auto voices: cj=${autoCj?.name} smoke=${autoSmoke?.name}")
    }

    // ---- focus / events / watchdog ---------------------------------------------------------------

    private fun requestFocus() {
        main.removeCallbacks(releaseFocusRunnable)
        if (hasFocus) return
        val req = focusRequest ?: return
        val r = try {
            audio.requestAudioFocus(req)
        } catch (t: Throwable) {
            AudioManager.AUDIOFOCUS_REQUEST_FAILED
        }
        hasFocus = r == AudioManager.AUDIOFOCUS_REQUEST_GRANTED || r == AudioManager.AUDIOFOCUS_REQUEST_DELAYED
    }

    private fun abandonFocus() {
        val req = focusRequest ?: return
        if (!hasFocus) return
        hasFocus = false
        try {
            audio.abandonAudioFocusRequest(req)
        } catch (t: Throwable) {
            Log.w(TAG, "abandonAudioFocus failed", t)
        }
    }

    private fun emitStart(item: Item) {
        if (item.startEmitted) return
        item.startEmitted = true
        item.host.get()?.let { emit(it, item.webId, "start") }
    }

    private fun emit(host: SAWebHost, webId: String, event: String) {
        host.callJs("onTtsEvent", JSONObject.quote(webId) + "," + JSONObject.quote(event))
    }

    private fun armWatchdog(ms: Long, block: () -> Unit) {
        cancelWatchdog()
        val r = Runnable {
            watchdog = null
            block()
        }
        watchdog = r
        main.postDelayed(r, ms)
    }

    private fun cancelWatchdog() {
        watchdog?.let { main.removeCallbacks(it) }
        watchdog = null
    }
}
