package com.samaps.app.car

import androidx.annotation.DrawableRes
import androidx.car.app.navigation.model.Maneuver
import com.samaps.app.R
import com.samaps.app.optStr
import org.json.JSONObject

/**
 * NavState `next`/`then` step (icon key + OSRM type/modifier/exit) -> Car App Library Maneuver
 * type and our own maneuver icon.
 */
object ManeuverMapper {

    data class Mapped(val type: Int, @param:DrawableRes val icon: Int, val exitNumber: Int?)

    fun map(step: JSONObject): Mapped {
        val icon = step.optStr("icon")?.lowercase().orEmpty()
        val osrmType = step.optStr("type")?.lowercase().orEmpty()
        val modifier = step.optStr("modifier")?.lowercase().orEmpty()
        val drivingSide = step.optStr("drivingSide")?.lowercase() ?: "right"
        val exit = if (step.isNull("exit")) null else step.optInt("exit", 0).takeIf { it > 0 }
        val key = icon.ifEmpty { iconFromOsrm(osrmType, modifier, drivingSide) }
        return fromIcon(key, osrmType, modifier, exit)
            ?: fromIcon(iconFromOsrm(osrmType, modifier, drivingSide), osrmType, modifier, exit)
            ?: Mapped(Maneuver.TYPE_UNKNOWN, R.drawable.ic_man_straight, null)
    }

    private fun fromIcon(key: String, osrmType: String, modifier: String, exit: Int?): Mapped? {
        val left = key.endsWith("-left")
        val slight = modifier.contains("slight")
        fun lr(l: Int, r: Int) = if (left) l else r
        return when (key) {
            "depart" -> Mapped(Maneuver.TYPE_DEPART, R.drawable.ic_man_depart, null)
            "arrive" -> Mapped(Maneuver.TYPE_DESTINATION, R.drawable.ic_man_arrive, null)
            "straight" -> Mapped(Maneuver.TYPE_STRAIGHT, R.drawable.ic_man_straight, null)
            "turn-left", "turn-right" -> Mapped(
                lr(Maneuver.TYPE_TURN_NORMAL_LEFT, Maneuver.TYPE_TURN_NORMAL_RIGHT),
                lr(R.drawable.ic_man_turn_left, R.drawable.ic_man_turn_right), null
            )
            "slight-left", "slight-right" -> Mapped(
                lr(Maneuver.TYPE_TURN_SLIGHT_LEFT, Maneuver.TYPE_TURN_SLIGHT_RIGHT),
                lr(R.drawable.ic_man_slight_left, R.drawable.ic_man_slight_right), null
            )
            "sharp-left", "sharp-right" -> Mapped(
                lr(Maneuver.TYPE_TURN_SHARP_LEFT, Maneuver.TYPE_TURN_SHARP_RIGHT),
                lr(R.drawable.ic_man_sharp_left, R.drawable.ic_man_sharp_right), null
            )
            "uturn-left", "uturn-right" -> Mapped(
                lr(Maneuver.TYPE_U_TURN_LEFT, Maneuver.TYPE_U_TURN_RIGHT),
                lr(R.drawable.ic_man_uturn_left, R.drawable.ic_man_uturn_right), null
            )
            "merge-left", "merge-right" -> Mapped(
                lr(Maneuver.TYPE_MERGE_LEFT, Maneuver.TYPE_MERGE_RIGHT),
                lr(R.drawable.ic_man_merge_left, R.drawable.ic_man_merge_right), null
            )
            "ramp-left", "ramp-right" -> {
                val type = if (osrmType == "off ramp") {
                    if (slight) lr(Maneuver.TYPE_OFF_RAMP_SLIGHT_LEFT, Maneuver.TYPE_OFF_RAMP_SLIGHT_RIGHT)
                    else lr(Maneuver.TYPE_OFF_RAMP_NORMAL_LEFT, Maneuver.TYPE_OFF_RAMP_NORMAL_RIGHT)
                } else {
                    if (slight) lr(Maneuver.TYPE_ON_RAMP_SLIGHT_LEFT, Maneuver.TYPE_ON_RAMP_SLIGHT_RIGHT)
                    else lr(Maneuver.TYPE_ON_RAMP_NORMAL_LEFT, Maneuver.TYPE_ON_RAMP_NORMAL_RIGHT)
                }
                Mapped(type, lr(R.drawable.ic_man_ramp_left, R.drawable.ic_man_ramp_right), null)
            }
            "fork-left", "fork-right" -> Mapped(
                lr(Maneuver.TYPE_FORK_LEFT, Maneuver.TYPE_FORK_RIGHT),
                lr(R.drawable.ic_man_fork_left, R.drawable.ic_man_fork_right), null
            )
            "keep-left", "keep-right" -> Mapped(
                lr(Maneuver.TYPE_KEEP_LEFT, Maneuver.TYPE_KEEP_RIGHT),
                lr(R.drawable.ic_man_keep_left, R.drawable.ic_man_keep_right), null
            )
            "roundabout-ccw" -> roundabout(ccw = true, osrmType = osrmType, exit = exit)
            "roundabout-cw" -> roundabout(ccw = false, osrmType = osrmType, exit = exit)
            else -> null
        }
    }

    private fun roundabout(ccw: Boolean, osrmType: String, exit: Int?): Mapped {
        val icon = if (ccw) R.drawable.ic_man_roundabout_ccw else R.drawable.ic_man_roundabout_cw
        val leaving = osrmType == "exit roundabout" || osrmType == "exit rotary"
        return when {
            leaving -> Mapped(
                if (ccw) Maneuver.TYPE_ROUNDABOUT_EXIT_CCW else Maneuver.TYPE_ROUNDABOUT_EXIT_CW, icon, null
            )
            exit != null -> Mapped(
                if (ccw) Maneuver.TYPE_ROUNDABOUT_ENTER_AND_EXIT_CCW else Maneuver.TYPE_ROUNDABOUT_ENTER_AND_EXIT_CW,
                icon,
                exit
            )
            // ENTER_AND_EXIT requires an exit number; without one just announce entering.
            else -> Mapped(
                if (ccw) Maneuver.TYPE_ROUNDABOUT_ENTER_CCW else Maneuver.TYPE_ROUNDABOUT_ENTER_CW, icon, null
            )
        }
    }

    /** Derives an icon key from raw OSRM fields when the web did not send one. */
    private fun iconFromOsrm(type: String, modifier: String, drivingSide: String): String {
        val side = when {
            modifier.contains("left") -> "left"
            modifier.contains("right") -> "right"
            else -> null
        }
        return when {
            type == "depart" -> "depart"
            type == "arrive" -> "arrive"
            type in setOf("roundabout", "rotary", "roundabout turn", "exit roundabout", "exit rotary") ->
                if (drivingSide == "left") "roundabout-cw" else "roundabout-ccw"
            modifier == "uturn" -> if (drivingSide == "left") "uturn-right" else "uturn-left"
            side == null -> "straight"
            type == "merge" -> "merge-$side"
            type == "on ramp" || type == "off ramp" -> "ramp-$side"
            type == "fork" -> "fork-$side"
            modifier.startsWith("slight") && (type == "continue" || type == "new name") -> "keep-$side"
            modifier.startsWith("slight") -> "slight-$side"
            modifier.startsWith("sharp") -> "sharp-$side"
            else -> "turn-$side"
        }
    }
}
