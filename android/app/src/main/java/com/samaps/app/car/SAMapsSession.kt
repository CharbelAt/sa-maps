package com.samaps.app.car

import android.content.Intent
import android.util.Log
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.ScreenManager
import androidx.car.app.Session
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.samaps.app.LocationHub
import com.samaps.app.NavHub
import com.samaps.app.media.MediaHub
import java.util.concurrent.Executors

/**
 * One Android Auto session: owns the car WebView renderer and marks the car as the active
 * navigation/voice owner for its whole lifetime.
 */
class SAMapsSession : Session() {

    private var renderer: CarSurfaceRenderer? = null
    private val io = Executors.newSingleThreadExecutor()

    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onCreate(owner: LifecycleOwner) {
                NavHub.setCarActive(true)
                MediaHub.refresh() // optional feature; degrades to null without notification access
            }

            override fun onStart(owner: LifecycleOwner) {
                MediaHub.refresh()
            }

            override fun onDestroy(owner: LifecycleOwner) {
                renderer?.destroy()
                renderer = null
                io.shutdownNow()
                NavHub.setCarActive(false)
            }
        })
    }

    override fun onCreateScreen(intent: Intent): Screen {
        renderer = CarSurfaceRenderer(carContext, lifecycle)
        val screen = NavScreen(carContext)
        handleIntent(intent)
        return screen
    }

    override fun onNewIntent(intent: Intent) {
        if (handleIntent(intent)) {
            carContext.getCarService(ScreenManager::class.java).popToRoot()
        }
    }

    /** Handles `androidx.car.app.action.NAVIGATE` with a geo: URI (e.g. from the Assistant). */
    private fun handleIntent(intent: Intent): Boolean {
        if (intent.action != CarContext.ACTION_NAVIGATE) return false
        val uri = intent.data ?: return false
        val (place, query) = Photon.parseGeoUri(uri)
        if (place != null) {
            NavHub.carNavigateTo(place.toJson())
            return true
        }
        if (query == null) return false
        io.execute {
            try {
                val hit = Photon.search(query, LocationHub.last, limit = 1).firstOrNull()
                if (hit != null) NavHub.carNavigateTo(hit.toJson())
            } catch (t: Throwable) {
                Log.w("SAMaps/Car", "Geocoding '$query' failed", t)
            }
        }
        return true
    }
}
