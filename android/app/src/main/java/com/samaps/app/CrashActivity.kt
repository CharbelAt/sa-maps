package com.samaps.app

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/**
 * Shows the crash report (runs in the separate ":crash" process, plain framework views only,
 * so it still works when the main app can't start).
 */
class CrashActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val report = intent.getStringExtra(CrashReporter.EXTRA_REPORT) ?: "No report."
        val pad = (16 * resources.displayMetrics.density).toInt()

        val title = TextView(this).apply {
            text = "SA Maps crashed. The report below was sent to the developer automatically."
            setTextColor(Color.parseColor("#E0A72A"))
            textSize = 17f
            setTypeface(typeface, Typeface.BOLD)
        }
        val body = TextView(this).apply {
            text = report
            setTextColor(Color.WHITE)
            textSize = 11f
            typeface = Typeface.MONOSPACE
            setTextIsSelectable(true)
            setPadding(0, pad, 0, pad)
        }
        val copy = Button(this).apply {
            text = "Copy report"
            setOnClickListener {
                getSystemService(ClipboardManager::class.java)
                    ?.setPrimaryClip(ClipData.newPlainText("SA Maps crash", report))
                Toast.makeText(this@CrashActivity, "Copied", Toast.LENGTH_SHORT).show()
            }
        }
        val close = Button(this).apply {
            text = "Close"
            setOnClickListener { finishAndRemoveTask() }
        }
        val buttons = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.END
            addView(copy)
            addView(close)
        }
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad * 3, pad, pad * 2)
            setBackgroundColor(Color.BLACK)
            addView(title)
            addView(body)
            addView(buttons)
        }
        setContentView(ScrollView(this).apply {
            setBackgroundColor(Color.BLACK)
            addView(column)
        })
    }
}
