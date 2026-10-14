package com.samaps.app.car

import androidx.annotation.DrawableRes
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.SectionedItemList
import androidx.car.app.model.Template
import androidx.lifecycle.Lifecycle
import com.samaps.app.NavHub
import com.samaps.app.R
import org.json.JSONObject

/** Home / Work / favorites / recents from `SA.getPlaces()`. */
class PlacesScreen(carContext: CarContext) : Screen(carContext) {

    private var places: JSONObject? = null
    private var loaded = false

    init {
        NavHub.requestPlaces { result ->
            places = result
            loaded = true
            if (lifecycle.currentState.isAtLeast(Lifecycle.State.CREATED)) invalidate()
        }
    }

    @Suppress("DEPRECATION") // setTitle/setHeaderAction work on every host API level
    override fun onGetTemplate(): Template {
        val b = ListTemplate.Builder()
            .setTitle(carContext.getString(R.string.car_places_title))
            .setHeaderAction(Action.BACK)
        if (!loaded) return b.setLoading(true).build()

        val limit = CarUi.listLimit(carContext)
        var used = 0
        val saved = ItemList.Builder()
        var savedCount = 0
        val recents = ItemList.Builder()
        var recentCount = 0

        fun add(list: ItemList.Builder, title: String, place: Place, @DrawableRes icon: Int): Boolean {
            if (used >= limit) return false
            val row = Row.Builder()
                .setTitle(title)
                .setImage(CarUi.icon(carContext, icon))
                .setOnClickListener { pick(place) }
            val sub = if (title == place.name) place.address else listOfNotNull(
                place.name,
                place.address
            ).joinToString(" · ")
            if (!sub.isNullOrBlank()) row.addText(sub)
            list.addItem(row.build())
            used++
            return true
        }

        val p = places
        Place.fromJson(p?.optJSONObject("home"))?.let {
            if (add(saved, carContext.getString(R.string.car_home), it, R.drawable.ic_row_home)) savedCount++
        }
        Place.fromJson(p?.optJSONObject("work"))?.let {
            if (add(saved, carContext.getString(R.string.car_work), it, R.drawable.ic_row_work)) savedCount++
        }
        p?.optJSONArray("favorites")?.let { arr ->
            for (i in 0 until arr.length()) {
                val place = Place.fromJson(arr.optJSONObject(i)) ?: continue
                if (add(saved, place.name, place, R.drawable.ic_act_places)) savedCount++
            }
        }
        p?.optJSONArray("recents")?.let { arr ->
            for (i in 0 until arr.length()) {
                val place = Place.fromJson(arr.optJSONObject(i)) ?: continue
                if (add(recents, place.name, place, R.drawable.ic_row_recent)) recentCount++
            }
        }

        if (savedCount == 0 && recentCount == 0) {
            return b.setSingleList(
                ItemList.Builder().setNoItemsMessage(carContext.getString(R.string.car_places_none)).build()
            ).build()
        }
        if (savedCount > 0) {
            b.addSectionedList(SectionedItemList.create(saved.build(), carContext.getString(R.string.car_places_saved)))
        }
        if (recentCount > 0) {
            b.addSectionedList(SectionedItemList.create(recents.build(), carContext.getString(R.string.car_places_recent)))
        }
        return b.build()
    }

    private fun pick(place: Place) {
        NavHub.carNavigateTo(place.toJson())
        screenManager.popToRoot()
    }
}
