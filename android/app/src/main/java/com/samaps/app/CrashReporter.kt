package com.samaps.app

import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Process
import android.util.Log
import android.webkit.WebView
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.system.exitProcess

/**
 * Catches crashes on real devices we can't attach a debugger to: saves the report, uploads it
 * to the voice server's POST /crash (best effort), and shows it in [CrashActivity], which runs
 * in its own ":crash" process so it works even when app start-up itself is what crashes.
 */
object CrashReporter {
    private const val TAG = "SAMaps/Crash"
    private const val ENDPOINT = "https://tts.109-199-116-38.sslip.io/crash"
    private const val REPORT_FILE = "last-crash.txt"
    private const val SENT_FILE = "last-crash.sent"
    const val EXTRA_REPORT = "report"

    fun install(app: Application) {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            try {
                val report = buildReport(app, "CRASH", thread, error)
                File(app.filesDir, REPORT_FILE).writeText(report)
                File(app.filesDir, SENT_FILE).delete()
                if (upload(report, waitMs = 2500)) File(app.filesDir, SENT_FILE).writeText("ok")
                app.startActivity(
                    Intent(app, CrashActivity::class.java)
                        .putExtra(EXTRA_REPORT, report)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
                )
            } catch (t: Throwable) {
                Log.e(TAG, "crash handler failed", t)
                previous?.uncaughtException(thread, error)
                return@setDefaultUncaughtExceptionHandler
            }
            Process.killProcess(Process.myPid())
            exitProcess(10)
        }
        // A report that couldn't be sent while crashing (no network): retry on this start.
        val report = File(app.filesDir, REPORT_FILE)
        val sent = File(app.filesDir, SENT_FILE)
        if (report.exists() && !sent.exists()) {
            val text = runCatching { report.readText() }.getOrNull() ?: return
            Thread { if (upload(text, 0)) runCatching { sent.writeText("ok") } }.start()
        }
    }

    /** Something failed but the app can keep going: log it and send it anyway. */
    fun nonFatal(context: Context, where: String, error: Throwable) {
        Log.e(TAG, "non-fatal in $where", error)
        val report = buildReport(context, "NON-FATAL in $where", Thread.currentThread(), error)
        upload(report, waitMs = 0)
    }

    fun buildReport(context: Context, kind: String, thread: Thread, error: Throwable): String {
        val version = runCatching {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName
        }.getOrNull() ?: "?"
        val webView = runCatching {
            WebView.getCurrentWebViewPackage()?.let { "${it.packageName} ${it.versionName}" }
        }.getOrNull() ?: "unknown"
        val time = SimpleDateFormat("yyyy-MM-dd HH:mm:ss Z", Locale.US).format(Date())
        return buildString {
            appendLine("SA Maps $kind")
            appendLine("time: $time")
            appendLine("app: ${context.packageName} $version")
            appendLine("device: ${Build.MANUFACTURER} ${Build.MODEL} (${Build.DEVICE})")
            appendLine("android: ${Build.VERSION.RELEASE} (sdk ${Build.VERSION.SDK_INT}) build ${Build.DISPLAY}")
            appendLine("webview: $webView")
            appendLine("thread: ${thread.name}")
            appendLine()
            append(Log.getStackTraceString(error).ifEmpty { error.toString() })
        }
    }

    /** POSTs the report; waits up to [waitMs] (0 = fire and forget). Returns true if it was sent. */
    private fun upload(report: String, waitMs: Long): Boolean {
        var ok = false
        val t = Thread {
            try {
                val conn = URL(ENDPOINT).openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.connectTimeout = 2000
                conn.readTimeout = 2000
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "text/plain; charset=utf-8")
                conn.outputStream.use { it.write(report.take(60_000).toByteArray()) }
                ok = conn.responseCode in 200..299
                conn.disconnect()
            } catch (e: Throwable) {
                Log.w(TAG, "upload failed: $e")
            }
        }
        t.start()
        if (waitMs > 0) runCatching { t.join(waitMs) }
        return ok
    }
}
