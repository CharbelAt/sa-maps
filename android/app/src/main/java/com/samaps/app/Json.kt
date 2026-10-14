package com.samaps.app

import org.json.JSONObject

/**
 * `optString` returns the literal "null" for JSON nulls; this returns a trimmed non-blank
 * string or null.
 */
fun JSONObject.optStr(key: String): String? {
    if (!has(key) || isNull(key)) return null
    return optString(key).trim().takeIf { it.isNotEmpty() }
}
