package com.samaps.app.car

import androidx.annotation.DrawableRes
import androidx.car.app.CarContext
import androidx.car.app.constraints.ConstraintManager
import androidx.car.app.model.CarIcon
import androidx.car.app.model.Distance
import androidx.car.app.versioning.CarAppApiLevels
import androidx.core.graphics.drawable.IconCompat
import kotlin.math.max
import kotlin.math.roundToLong

/** Small helpers shared by the car screens. */
object CarUi {

    fun icon(context: CarContext, @DrawableRes res: Int): CarIcon =
        CarIcon.Builder(IconCompat.createWithResource(context, res)).build()

    /** Distance with sensible rounding for `units` = "metric" | "imperial". */
    fun distance(meters: Double, units: String?): Distance {
        val m = if (meters.isFinite()) max(0.0, meters) else 0.0
        return if (units.equals("imperial", ignoreCase = true)) {
            val feet = m * 3.28084
            val miles = m / 1609.344
            when {
                miles < 0.1 -> Distance.create(roundTo(feet, if (feet < 100) 10.0 else 50.0), Distance.UNIT_FEET)
                miles < 10 -> Distance.create(round1(miles), Distance.UNIT_MILES_P1)
                else -> Distance.create(miles.roundToLong().toDouble(), Distance.UNIT_MILES)
            }
        } else {
            when {
                m < 1000 -> {
                    val step = when {
                        m < 100 -> 5.0
                        m < 300 -> 10.0
                        else -> 50.0
                    }
                    val r = roundTo(m, step)
                    if (r >= 1000) Distance.create(1.0, Distance.UNIT_KILOMETERS_P1)
                    else Distance.create(r, Distance.UNIT_METERS)
                }
                m < 10_000 -> Distance.create(round1(m / 1000.0), Distance.UNIT_KILOMETERS_P1)
                else -> Distance.create((m / 1000.0).roundToLong().toDouble(), Distance.UNIT_KILOMETERS)
            }
        }
    }

    /** Max rows a list may show on this host. */
    fun listLimit(context: CarContext): Int = try {
        if (context.carAppApiLevel >= CarAppApiLevels.LEVEL_2) {
            context.getCarService(ConstraintManager::class.java)
                .getContentLimit(ConstraintManager.CONTENT_LIMIT_TYPE_LIST)
        } else {
            6
        }
    } catch (t: Throwable) {
        6
    }

    private fun roundTo(v: Double, step: Double): Double = (v / step).roundToLong() * step
    private fun round1(v: Double): Double = (v * 10).roundToLong() / 10.0
}
