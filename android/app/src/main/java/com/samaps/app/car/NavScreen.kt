package com.samaps.app.car

import android.util.Log
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.DateTimeWithZone
import androidx.car.app.model.Template
import androidx.car.app.navigation.NavigationManager
import androidx.car.app.navigation.NavigationManagerCallback
import androidx.car.app.navigation.model.Destination
import androidx.car.app.navigation.model.Maneuver
import androidx.car.app.navigation.model.NavigationTemplate
import androidx.car.app.navigation.model.Step
import androidx.car.app.navigation.model.TravelEstimate
import androidx.car.app.navigation.model.Trip
import androidx.car.app.versioning.CarAppApiLevels
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.samaps.app.NavHub
import com.samaps.app.R
import com.samaps.app.optStr
import org.json.JSONObject
import java.util.TimeZone
import kotlin.math.max
import kotlin.math.roundToLong

/**
 * Root car screen: a NavigationTemplate over the web-rendered map. The radar, turn box, timers and
 * music card are all drawn by the car WebView, so the template only carries the action strips. The
 * host's own routing card is deliberately not set: it would sit on top of the web HUD and shrink
 * the area the host leaves free for it. Turn data still reaches cluster / HUD displays through
 * [NavigationManager.updateTrip].
 */
class NavScreen(carContext: CarContext) : Screen(carContext) {

    private val navManager: NavigationManager = carContext.getCarService(NavigationManager::class.java)

    private var navigating = false
    private var muted = false
    private var inPanMode = false

    private val stateListener: (JSONObject) -> Unit = { onState(it) }

    init {
        navManager.setNavigationManagerCallback(object : NavigationManagerCallback {
            override fun onStopNavigation() {
                // Host asked us to stop (e.g. another nav app started or user ended it there).
                NavHub.carCommand("stopNav")
            }

            override fun onAutoDriveEnabled() {
                Log.i(TAG, "Auto drive requested by host (not supported)")
            }
        })
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onCreate(owner: LifecycleOwner) {
                NavHub.carNavStateListeners += stateListener
                NavHub.lastCarNavState?.let { onState(it) }
            }

            override fun onDestroy(owner: LifecycleOwner) {
                NavHub.carNavStateListeners -= stateListener
                if (navigating) {
                    navigating = false
                    try {
                        navManager.navigationEnded()
                    } catch (t: Throwable) {
                        Log.w(TAG, "navigationEnded failed", t)
                    }
                }
                try {
                    navManager.clearNavigationManagerCallback()
                } catch (t: Throwable) {
                    Log.w(TAG, "clearNavigationManagerCallback failed", t)
                }
            }
        })
    }

    // ---- NavState --------------------------------------------------------------------------------

    private fun onState(s: JSONObject) {
        val nav = s.optBoolean("navigating", false)
        val mute = s.optBoolean("muted", false)
        // Only the End button and the mute icon depend on the state.
        val changed = nav != navigating || mute != muted
        if (nav != navigating) {
            navigating = nav
            try {
                if (nav) navManager.navigationStarted() else navManager.navigationEnded()
            } catch (t: Throwable) {
                Log.w(TAG, "navigation${if (nav) "Started" else "Ended"} failed", t)
            }
        }
        muted = mute
        if (nav) updateTrip(s)
        if (changed) invalidate()
    }

    // ---- template --------------------------------------------------------------------------------

    override fun onGetTemplate(): Template {
        val b = NavigationTemplate.Builder()
            .setActionStrip(buildActionStrip(navigating, muted))

        if (carContext.carAppApiLevel >= CarAppApiLevels.LEVEL_2) {
            b.setMapActionStrip(buildMapActionStrip())
            b.setPanModeListener { isInPanMode ->
                inPanMode = isInPanMode
                Log.d(TAG, "Pan mode: $isInPanMode")
            }
        }
        return b.build()
    }

    private fun buildActionStrip(navigating: Boolean, muted: Boolean): ActionStrip {
        val strip = ActionStrip.Builder()
            .addAction(
                Action.Builder()
                    .setTitle(carContext.getString(R.string.car_search))
                    .setIcon(CarUi.icon(carContext, R.drawable.ic_act_search))
                    .setOnClickListener { screenManager.push(SearchScreen(carContext)) }
                    .build()
            )
            .addAction(
                Action.Builder()
                    .setTitle(carContext.getString(R.string.car_places))
                    .setIcon(CarUi.icon(carContext, R.drawable.ic_act_places))
                    .setOnClickListener { screenManager.push(PlacesScreen(carContext)) }
                    .build()
            )
        if (navigating) {
            strip.addAction(
                Action.Builder()
                    .setTitle(carContext.getString(R.string.car_end))
                    .setIcon(CarUi.icon(carContext, R.drawable.ic_act_end))
                    .setOnClickListener { NavHub.carCommand("stopNav") }
                    .build()
            )
        }
        strip.addAction(
            Action.Builder()
                .setIcon(CarUi.icon(carContext, if (muted) R.drawable.ic_act_volume_off else R.drawable.ic_act_volume_on))
                .setOnClickListener { NavHub.carCommand("toggleMute") }
                .build()
        )
        return strip.build()
    }

    private fun buildMapActionStrip(): ActionStrip =
        ActionStrip.Builder()
            .addAction(Action.PAN)
            .addAction(
                Action.Builder()
                    .setIcon(CarUi.icon(carContext, R.drawable.ic_act_zoom_in))
                    .setOnClickListener { NavHub.carCommand("zoomIn") }
                    .build()
            )
            .addAction(
                Action.Builder()
                    .setIcon(CarUi.icon(carContext, R.drawable.ic_act_zoom_out))
                    .setOnClickListener { NavHub.carCommand("zoomOut") }
                    .build()
            )
            .addAction(
                Action.Builder()
                    .setIcon(CarUi.icon(carContext, R.drawable.ic_act_recenter))
                    .setOnClickListener { NavHub.carCommand("recenter") }
                    .build()
            )
            .build()

    private fun buildStep(o: JSONObject): Step {
        val m = ManeuverMapper.map(o)
        val mb = Maneuver.Builder(m.type).setIcon(CarUi.icon(carContext, m.icon))
        m.exitNumber?.let { mb.setRoundaboutExitNumber(it) }
        val street = o.optStr("street")
        val cue = o.optStr("instruction") ?: street ?: "Continue"
        val sb = Step.Builder(cue).setManeuver(mb.build())
        if (street != null) sb.setRoad(street)
        return sb.build()
    }

    private fun travelEstimate(s: JSONObject): TravelEstimate? {
        val remM = s.optDouble("remainingM", Double.NaN)
        if (remM.isNaN()) return null
        val remS = s.optDouble("remainingS", Double.NaN).takeIf { it.isFinite() && it >= 0 }
        val eta = s.optLong("etaEpochMs", 0L).takeIf { it > 0 }
            ?: (System.currentTimeMillis() + ((remS ?: 0.0) * 1000).roundToLong())
        return TravelEstimate.Builder(
            CarUi.distance(remM, s.optStr("units")),
            DateTimeWithZone.create(eta, TimeZone.getDefault())
        )
            .setRemainingTimeSeconds(remS?.roundToLong() ?: TravelEstimate.REMAINING_TIME_UNKNOWN)
            .build()
    }

    /** Cluster / HUD displays (host-dependent; older hosts may reject it). */
    private fun updateTrip(s: JSONObject) {
        try {
            val units = s.optStr("units")
            val tb = Trip.Builder()
            val next = s.optJSONObject("next")
            if (s.optBoolean("rerouting") || next == null) {
                tb.setLoading(true)
            } else {
                val distM = next.optDouble("distanceM", 0.0).let { if (it.isFinite()) max(0.0, it) else 0.0 }
                val speed = s.optDouble("speedMps", 0.0).let { if (it.isFinite() && it > 1.0) it else 10.0 }
                val secs = (distM / speed).roundToLong()
                val stepEstimate = TravelEstimate.Builder(
                    CarUi.distance(distM, units),
                    DateTimeWithZone.create(System.currentTimeMillis() + secs * 1000, TimeZone.getDefault())
                ).setRemainingTimeSeconds(secs).build()
                tb.addStep(buildStep(next), stepEstimate)
            }
            travelEstimate(s)?.let { est ->
                val destName = s.optJSONObject("destination")?.optStr("name") ?: "Destination"
                tb.addDestination(Destination.Builder().setName(destName).build(), est)
            }
            navManager.updateTrip(tb.build())
        } catch (t: Throwable) {
            Log.d(TAG, "updateTrip not accepted: ${t.message}")
        }
    }

    companion object {
        private const val TAG = "SAMaps/NavScreen"
    }
}
