package com.samaps.app.car

import android.app.Presentation
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.MutableContextWrapper
import android.graphics.Color
import android.graphics.Rect
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.os.SystemClock
import android.util.Log
import android.view.InputDevice
import android.view.MotionEvent
import android.view.ViewGroup
import android.view.WindowManager
import androidx.car.app.AppManager
import androidx.car.app.CarContext
import androidx.car.app.SurfaceCallback
import androidx.car.app.SurfaceContainer
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.toDrawable
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import com.samaps.app.web.SAWebHost
import com.samaps.app.web.WebMode
import org.json.JSONObject

/**
 * Draws the web app itself onto the Android Auto map surface: the car surface backs a private
 * VirtualDisplay, and a [Presentation] on that display hosts the car WebView (`?mode=car`).
 *
 * The WebView is created on the first surface and reused across surface re-creations; the
 * VirtualDisplay + Presentation are rebuilt for each surface. Map gestures are forwarded to the
 * web app as `SA.onCarGesture`, clicks as real touch events.
 */
class CarSurfaceRenderer(
    private val carContext: CarContext,
    lifecycle: Lifecycle,
) : SurfaceCallback, SAWebHost.Callbacks {

    private var virtualDisplay: VirtualDisplay? = null
    private var presentation: Presentation? = null
    private var webContext: MutableContextWrapper? = null
    private var host: SAWebHost? = null

    private var surfaceWidth = 0
    private var surfaceHeight = 0
    private var visibleArea: Rect? = null
    private var stableArea: Rect? = null
    private var destroyed = false

    /** Phone screen on/off must not stall the car WebView. */
    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            wakeWebView()
        }
    }
    private var receiverRegistered = false

    init {
        carContext.getCarService(AppManager::class.java).setSurfaceCallback(this)
        try {
            val filter = IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_OFF)
                addAction(Intent.ACTION_SCREEN_ON)
                addAction(Intent.ACTION_USER_PRESENT)
            }
            ContextCompat.registerReceiver(
                carContext.applicationContext, screenReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED
            )
            receiverRegistered = true
        } catch (t: Throwable) {
            Log.w(TAG, "Screen receiver not registered", t)
        }
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) = wakeWebView()
            override fun onResume(owner: LifecycleOwner) = wakeWebView()
        })
    }

    // ---- surface ---------------------------------------------------------------------------------

    override fun onSurfaceAvailable(surfaceContainer: SurfaceContainer) {
        if (destroyed) return
        val surface = surfaceContainer.surface
        if (surface == null) {
            Log.w(TAG, "Surface container without a surface")
            return
        }
        releaseDisplay()
        surfaceWidth = surfaceContainer.width
        surfaceHeight = surfaceContainer.height
        val dpi = surfaceContainer.dpi.takeIf { it > 0 } ?: carContext.resources.displayMetrics.densityDpi
        Log.i(TAG, "Surface available ${surfaceWidth}x$surfaceHeight @ $dpi dpi")
        try {
            val dm = carContext.getSystemService(DisplayManager::class.java)
            val vd = dm.createVirtualDisplay(
                "SAMapsCar",
                surfaceWidth,
                surfaceHeight,
                dpi,
                surface,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY
            )
            virtualDisplay = vd
            val p = Presentation(carContext, vd.display)
            p.window?.apply {
                setBackgroundDrawable(Color.BLACK.toDrawable())
                setFlags(
                    WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                    WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
                )
            }
            val h = ensureHost(p.context)
            (h.webView.parent as? ViewGroup)?.removeView(h.webView)
            p.setContentView(
                h.webView,
                ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            )
            p.show()
            presentation = p
            wakeWebView()
            pushInsets()
        } catch (t: Throwable) {
            Log.e(TAG, "Could not render on the car surface", t)
            releaseDisplay()
        }
    }

    override fun onSurfaceDestroyed(surfaceContainer: SurfaceContainer) {
        Log.i(TAG, "Surface destroyed")
        releaseDisplay()
    }

    override fun onVisibleAreaChanged(visibleArea: Rect) {
        this.visibleArea = Rect(visibleArea)
        pushInsets()
    }

    override fun onStableAreaChanged(stableArea: Rect) {
        this.stableArea = Rect(stableArea)
        pushInsets()
    }

    // ---- gestures --------------------------------------------------------------------------------

    override fun onScroll(distanceX: Float, distanceY: Float) {
        gesture(JSONObject().put("type", "scroll").put("dx", num(distanceX)).put("dy", num(distanceY)))
    }

    override fun onFling(velocityX: Float, velocityY: Float) {
        gesture(JSONObject().put("type", "fling").put("vx", num(velocityX)).put("vy", num(velocityY)))
    }

    override fun onScale(focusX: Float, focusY: Float, scaleFactor: Float) {
        gesture(
            JSONObject().put("type", "scale")
                .put("x", num(focusX)).put("y", num(focusY)).put("factor", num(scaleFactor))
        )
    }

    /** Car API 5+: deliver as a real tap (DOWN + UP) on the car WebView. */
    override fun onClick(x: Float, y: Float) {
        val web = host?.webView ?: return
        if (web.parent == null) return
        val loc = IntArray(2)
        web.getLocationInWindow(loc)
        val vx = x - loc[0]
        val vy = y - loc[1]
        val downTime = SystemClock.uptimeMillis()
        dispatchTouch(web, downTime, downTime, MotionEvent.ACTION_DOWN, vx, vy)
        dispatchTouch(web, downTime, downTime + 40, MotionEvent.ACTION_UP, vx, vy)
    }

    private fun dispatchTouch(view: android.view.View, downTime: Long, eventTime: Long, action: Int, x: Float, y: Float) {
        val props = arrayOf(MotionEvent.PointerProperties().apply {
            id = 0
            toolType = MotionEvent.TOOL_TYPE_FINGER
        })
        val coords = arrayOf(MotionEvent.PointerCoords().apply {
            this.x = x
            this.y = y
            pressure = 1f
            size = 1f
        })
        val ev = MotionEvent.obtain(
            downTime, eventTime, action, 1, props, coords,
            0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0
        )
        try {
            view.dispatchTouchEvent(ev)
        } finally {
            ev.recycle()
        }
    }

    private fun gesture(g: JSONObject) {
        host?.callJs("onCarGesture", g.toString())
    }

    private fun num(f: Float): Double = if (f.isFinite()) f.toDouble() else 0.0

    // ---- web host ------------------------------------------------------------------------------

    private fun ensureHost(displayContext: Context): SAWebHost {
        val existing = host
        if (existing != null && !existing.destroyed) {
            webContext?.baseContext = displayContext
            return existing
        }
        val wrapper = MutableContextWrapper(displayContext)
        webContext = wrapper
        val h = SAWebHost(wrapper, WebMode.CAR, this)
        h.carInsetsJson = insetsJson()
        host = h
        h.load()
        return h
    }

    override fun onRendererGone(host: SAWebHost) {
        if (this.host !== host || destroyed) return
        this.host = null
        val p = presentation ?: return
        try {
            val h = ensureHost(p.context)
            p.setContentView(h.webView)
            wakeWebView()
        } catch (t: Throwable) {
            Log.e(TAG, "Could not recreate the car WebView", t)
        }
    }

    private fun wakeWebView() {
        val web = host?.webView ?: return
        if (host?.destroyed == true) return
        try {
            web.onResume()
            web.resumeTimers()
            web.invalidate()
        } catch (t: Throwable) {
            Log.w(TAG, "wakeWebView failed", t)
        }
    }

    private fun insetsJson(): String? {
        val v = visibleArea
        val s = stableArea
        if (v == null && s == null) return null
        return JSONObject()
            .put("visible", rectJson(v ?: s!!))
            .put("stable", rectJson(s ?: v!!))
            .put("surface", JSONObject().put("width", surfaceWidth).put("height", surfaceHeight))
            .toString()
    }

    private fun rectJson(r: Rect) = JSONObject()
        .put("left", r.left)
        .put("top", r.top)
        .put("right", r.right)
        .put("bottom", r.bottom)

    private fun pushInsets() {
        val json = insetsJson() ?: return
        host?.let {
            it.carInsetsJson = json
            it.callJs("setCarInsets", json)
        }
    }

    private fun releaseDisplay() {
        presentation?.let {
            try {
                it.dismiss()
            } catch (t: Throwable) {
                Log.w(TAG, "Presentation dismiss failed", t)
            }
        }
        presentation = null
        host?.webView?.let { (it.parent as? ViewGroup)?.removeView(it) }
        virtualDisplay?.let {
            try {
                it.release()
            } catch (t: Throwable) {
                Log.w(TAG, "VirtualDisplay release failed", t)
            }
        }
        virtualDisplay = null
    }

    fun destroy() {
        if (destroyed) return
        destroyed = true
        releaseDisplay()
        host?.destroy()
        host = null
        webContext = null
        if (receiverRegistered) {
            try {
                carContext.applicationContext.unregisterReceiver(screenReceiver)
            } catch (_: Throwable) {
            }
            receiverRegistered = false
        }
    }

    companion object {
        private const val TAG = "SAMaps/CarSurface"
    }
}
