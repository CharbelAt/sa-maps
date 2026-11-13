package com.samaps.app.car

import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.annotation.StringRes
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import com.samaps.app.LocationHub
import com.samaps.app.NavHub
import com.samaps.app.R
import com.samaps.app.optStr
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/** A kind of place to look for around you; [tags] are OSM `key:value`, any of them matches. */
class NearbyKind(@StringRes val label: Int, val tags: List<String>)

/** Most useful behind the wheel first: hosts only show the first few rows. */
private val KINDS = listOf(
    NearbyKind(R.string.car_nearby_fuel, listOf("amenity:fuel")),
    NearbyKind(R.string.car_nearby_parking, listOf("amenity:parking")),
    NearbyKind(R.string.car_nearby_food, listOf("amenity:restaurant", "amenity:fast_food")),
    NearbyKind(R.string.car_nearby_coffee, listOf("amenity:cafe")),
    NearbyKind(R.string.car_nearby_atm, listOf("amenity:atm", "amenity:bank")),
    NearbyKind(R.string.car_nearby_pharmacy, listOf("amenity:pharmacy")),
    NearbyKind(R.string.car_nearby_hospital, listOf("amenity:hospital")),
    NearbyKind(R.string.car_nearby_garage, listOf("shop:car_repair")),
)

/** "Nearest fuel / parking / food ...": pick a kind of place. */
class NearbyScreen(carContext: CarContext) : Screen(carContext) {

    @Suppress("DEPRECATION") // setTitle/setHeaderAction work on every host API level
    override fun onGetTemplate(): Template {
        val list = ItemList.Builder()
        for (kind in KINDS.take(CarUi.listLimit(carContext))) {
            list.addItem(
                Row.Builder()
                    .setTitle(carContext.getString(kind.label))
                    .setImage(CarUi.icon(carContext, R.drawable.ic_row_place))
                    .setBrowsable(true)
                    .setOnClickListener { screenManager.push(NearbyResultsScreen(carContext, kind)) }
                    .build()
            )
        }
        return ListTemplate.Builder()
            .setTitle(carContext.getString(R.string.car_nearby))
            .setHeaderAction(Action.BACK)
            .setSingleList(list.build())
            .build()
    }
}

/** The closest places of one kind, nearest first; picking one starts navigation. */
class NearbyResultsScreen(carContext: CarContext, private val kind: NearbyKind) : Screen(carContext) {

    private val main = Handler(Looper.getMainLooper())
    private val io: ExecutorService = Executors.newSingleThreadExecutor()

    /** null while loading. */
    private var results: List<Place>? = null
    private var failed = false

    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onDestroy(owner: LifecycleOwner) {
                io.shutdownNow()
            }
        })
        load()
    }

    private fun load() {
        val near = LocationHub.last
        if (near == null) {
            failed = true
            results = emptyList()
            return
        }
        val limit = CarUi.listLimit(carContext)
        io.execute {
            val found = try {
                Photon.nearby(kind.tags, near, limit)
            } catch (t: Throwable) {
                Log.w(TAG, "Nearby search failed for ${kind.tags}", t)
                null
            }
            main.post {
                failed = found == null
                results = found ?: emptyList()
                if (lifecycle.currentState.isAtLeast(Lifecycle.State.CREATED)) invalidate()
            }
        }
    }

    @Suppress("DEPRECATION") // setTitle/setHeaderAction work on every host API level
    override fun onGetTemplate(): Template {
        val b = ListTemplate.Builder()
            .setTitle(carContext.getString(kind.label))
            .setHeaderAction(Action.BACK)
        val found = results ?: return b.setLoading(true).build()

        val list = ItemList.Builder()
        val here = LocationHub.last
        val units = NavHub.lastCarNavState?.optStr("units")
        for (p in found.take(CarUi.listLimit(carContext))) {
            list.addItem(CarUi.placeRow(carContext, p, here, units) { pick(p) })
        }
        if (found.isEmpty()) {
            list.setNoItemsMessage(
                carContext.getString(
                    when {
                        LocationHub.last == null -> R.string.car_nearby_no_gps
                        failed -> R.string.car_search_error
                        else -> R.string.car_nearby_none
                    }
                )
            )
        }
        return b.setSingleList(list.build()).build()
    }

    private fun pick(p: Place) {
        NavHub.carNavigateTo(p.toJson())
        screenManager.popToRoot()
    }

    companion object {
        private const val TAG = "SAMaps/CarNearby"
    }
}
