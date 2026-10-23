package com.rasseed.agent

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

class ApiException(val status: Int, message: String) : IOException(message)

data class Command(
    val id: String,
    val type: String,
    val ussd: String,
    val subscriptionId: Int,
    val slotIndex: Int,
    /** Operator's balance pattern; null on older servers. */
    val balanceRegex: String? = null,
)

/** Minimal JSON-over-HTTP client for the server's /api/device endpoints. */
class Api(private val baseUrl: String, private val token: String?) {

    private fun post(path: String, body: JSONObject): JSONObject {
        val conn = URL(baseUrl + path).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 10_000
            conn.readTimeout = 20_000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")
            conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val status = conn.responseCode
            val text = (if (status in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            if (status !in 200..299) throw ApiException(status, "HTTP $status $text")
            return if (text.isBlank()) JSONObject() else JSONObject(text)
        } finally {
            conn.disconnect()
        }
    }

    fun pair(code: String): Pair<String, String> {
        val r = post("/api/device/pair", JSONObject().put("code", code))
        return r.getString("token") to r.optString("name")
    }

    fun sync(sims: List<SimSlot>, battery: Int?, charging: Boolean?, model: String, android: String, app: String): List<Command> {
        val body = JSONObject()
            .put("sims", JSONArray(sims.map {
                JSONObject().put("slotIndex", it.slotIndex).put("subscriptionId", it.subscriptionId).put("carrierName", it.carrierName)
            }))
            .put("model", model)
            .put("androidVersion", android)
            .put("appVersion", app)
        if (battery != null) body.put("batteryPct", battery)
        if (charging != null) body.put("charging", charging)
        val arr = post("/api/device/sync", body).optJSONArray("commands") ?: JSONArray()
        return (0 until arr.length()).map {
            val c = arr.getJSONObject(it)
            Command(
                c.getString("id"), c.getString("type"), c.getString("ussd"), c.getInt("subscriptionId"), c.getInt("slotIndex"),
                if (c.isNull("balanceRegex")) null else c.optString("balanceRegex").ifEmpty { null },
            )
        }
    }

    /** Returns the local ids the server stored (or already had). */
    fun uploadSms(messages: List<QueuedSms>): List<String> {
        val arr = JSONArray(messages.map { m ->
            JSONObject()
                .put("localId", m.localId)
                .put("subscriptionId", m.subscriptionId ?: JSONObject.NULL)
                .put("slotIndex", m.slotIndex ?: JSONObject.NULL)
                .put("from", m.from)
                .put("body", m.body)
                .put("sentAt", m.sentAt)
                .put("receivedAt", m.receivedAt)
        })
        val accepted = post("/api/device/sms", JSONObject().put("messages", arr)).optJSONArray("accepted") ?: JSONArray()
        return (0 until accepted.length()).map { accepted.getString(it) }
    }

    fun postResult(r: QueuedResult) {
        post(
            "/api/device/result",
            JSONObject()
                .put("id", r.commandId)
                .put("ok", r.ok)
                .put("response", r.response ?: JSONObject.NULL)
                .put("error", r.error ?: JSONObject.NULL),
        )
    }
}
