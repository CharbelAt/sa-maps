package com.samaps.app.car

import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.SearchTemplate
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

/** Destination search on the car screen (Photon geocoder, debounced 400 ms). */
class SearchScreen(carContext: CarContext) : Screen(carContext) {

    private val main = Handler(Looper.getMainLooper())
    private val io: ExecutorService = Executors.newSingleThreadExecutor()

    private var query = ""
    private var results: List<Place> = emptyList()
    private var loading = false
    private var failed = false
    private var searchSeq = 0
    private val debounced = Runnable { runSearch() }

    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onDestroy(owner: LifecycleOwner) {
                main.removeCallbacks(debounced)
                io.shutdownNow()
            }
        })
    }

    override fun onGetTemplate(): Template {
        val b = SearchTemplate.Builder(object : SearchTemplate.SearchCallback {
            override fun onSearchTextChanged(searchText: String) = onQuery(searchText, DEBOUNCE_MS)
            override fun onSearchSubmitted(searchText: String) = onQuery(searchText, 0L)
        })
            .setHeaderAction(Action.BACK)
            .setSearchHint(carContext.getString(R.string.car_search_hint))
            .setShowKeyboardByDefault(true)
        if (loading) b.setLoading(true) else b.setItemList(buildList())
        return b.build()
    }

    private fun onQuery(text: String, delayMs: Long) {
        val q = text.trim()
        if (q == query && delayMs > 0) return
        query = q
        main.removeCallbacks(debounced)
        if (q.length < 2) {
            searchSeq++
            results = emptyList()
            failed = false
            if (loading) {
                loading = false
            }
            refresh()
            return
        }
        main.postDelayed(debounced, delayMs)
    }

    private fun runSearch() {
        val q = query
        if (q.length < 2) return
        val id = ++searchSeq
        val near = LocationHub.last
        loading = true
        refresh()
        try {
            io.execute {
                val found = try {
                    Photon.search(q, near, limit = 8)
                } catch (t: Throwable) {
                    Log.w(TAG, "Photon search failed for '$q'", t)
                    null
                }
                main.post {
                    if (id != searchSeq) return@post
                    loading = false
                    failed = found == null
                    results = found ?: emptyList()
                    refresh()
                }
            }
        } catch (t: Throwable) {
            loading = false
        }
    }

    private fun buildList(): ItemList {
        val list = ItemList.Builder()
        val limit = CarUi.listLimit(carContext)
        val here = LocationHub.last
        val units = NavHub.lastCarNavState?.optStr("units")
        for (p in results.take(limit)) list.addItem(CarUi.placeRow(carContext, p, here, units) { pick(p) })
        if (results.isEmpty()) {
            when {
                failed -> list.setNoItemsMessage(carContext.getString(R.string.car_search_error))
                query.length >= 2 -> list.setNoItemsMessage(carContext.getString(R.string.car_search_none))
            }
        }
        return list.build()
    }

    private fun pick(p: Place) {
        NavHub.carNavigateTo(p.toJson())
        screenManager.popToRoot()
    }

    private fun refresh() {
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.CREATED)) invalidate()
    }

    companion object {
        private const val TAG = "SAMaps/CarSearch"
        private const val DEBOUNCE_MS = 400L
    }
}
