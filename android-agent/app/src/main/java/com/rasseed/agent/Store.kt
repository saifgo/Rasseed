package com.rasseed.agent

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/** Pairing info and status, kept in SharedPreferences. */
class Prefs(context: Context) {
    private val p = context.getSharedPreferences("agent", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = p.getString("server", "") ?: ""
        set(v) = p.edit().putString("server", v.trimEnd('/')).apply()
    var token: String?
        get() = p.getString("token", null)
        set(v) = p.edit().putString("token", v).apply()
    var deviceName: String
        get() = p.getString("name", "") ?: ""
        set(v) = p.edit().putString("name", v).apply()
    /** Highest content://sms/inbox _id already queued (for the inbox safety scan). */
    var inboxCursor: Long
        get() = p.getLong("inboxCursor", -1)
        set(v) = p.edit().putLong("inboxCursor", v).apply()
    var lastSyncAt: Long
        get() = p.getLong("lastSync", 0)
        set(v) = p.edit().putLong("lastSync", v).apply()
    var lastError: String
        get() = p.getString("lastError", "") ?: ""
        set(v) = p.edit().putString("lastError", v).apply()

    val paired get() = token != null && serverUrl.isNotEmpty()
}

data class QueuedSms(
    val localId: String,
    val subscriptionId: Int?,
    val slotIndex: Int?,
    val from: String,
    val body: String,
    val sentAt: Long,
    val receivedAt: Long,
)

data class QueuedResult(val commandId: String, val ok: Boolean, val response: String?, val error: String?)

/**
 * Durable outbox. Every SMS and every USSD result is written here first and only deleted after the
 * server acknowledged it, so nothing is lost if the network or the server is down.
 */
class Store(context: Context) : SQLiteOpenHelper(context, "agent.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE sms (local_id TEXT PRIMARY KEY, sub_id INTEGER, slot INTEGER, sender TEXT NOT NULL,
               body TEXT NOT NULL, sent_at INTEGER NOT NULL, received_at INTEGER NOT NULL)""",
        )
        db.execSQL(
            """CREATE TABLE results (command_id TEXT PRIMARY KEY, ok INTEGER NOT NULL, response TEXT, error TEXT)""",
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}

    @Synchronized
    fun queueSms(m: QueuedSms) {
        val v = ContentValues().apply {
            put("local_id", m.localId)
            if (m.subscriptionId != null) put("sub_id", m.subscriptionId) else putNull("sub_id")
            if (m.slotIndex != null) put("slot", m.slotIndex) else putNull("slot")
            put("sender", m.from)
            put("body", m.body)
            put("sent_at", m.sentAt)
            put("received_at", m.receivedAt)
        }
        writableDatabase.insertWithOnConflict("sms", null, v, SQLiteDatabase.CONFLICT_IGNORE)
    }

    @Synchronized
    fun pendingSms(limit: Int = 50): List<QueuedSms> {
        val out = mutableListOf<QueuedSms>()
        readableDatabase.rawQuery("SELECT * FROM sms ORDER BY received_at LIMIT $limit", null).use { c ->
            while (c.moveToNext()) {
                out += QueuedSms(
                    localId = c.getString(c.getColumnIndexOrThrow("local_id")),
                    subscriptionId = c.getColumnIndexOrThrow("sub_id").let { if (c.isNull(it)) null else c.getInt(it) },
                    slotIndex = c.getColumnIndexOrThrow("slot").let { if (c.isNull(it)) null else c.getInt(it) },
                    from = c.getString(c.getColumnIndexOrThrow("sender")),
                    body = c.getString(c.getColumnIndexOrThrow("body")),
                    sentAt = c.getLong(c.getColumnIndexOrThrow("sent_at")),
                    receivedAt = c.getLong(c.getColumnIndexOrThrow("received_at")),
                )
            }
        }
        return out
    }

    @Synchronized
    fun ackSms(ids: List<String>) {
        val db = writableDatabase
        ids.forEach { db.delete("sms", "local_id = ?", arrayOf(it)) }
    }

    @Synchronized
    fun queueResult(r: QueuedResult) {
        val v = ContentValues().apply {
            put("command_id", r.commandId)
            put("ok", if (r.ok) 1 else 0)
            put("response", r.response)
            put("error", r.error)
        }
        writableDatabase.insertWithOnConflict("results", null, v, SQLiteDatabase.CONFLICT_REPLACE)
    }

    @Synchronized
    fun pendingResults(): List<QueuedResult> {
        val out = mutableListOf<QueuedResult>()
        readableDatabase.rawQuery("SELECT * FROM results", null).use { c ->
            while (c.moveToNext()) {
                out += QueuedResult(
                    commandId = c.getString(0),
                    ok = c.getInt(1) == 1,
                    response = c.getString(2),
                    error = c.getString(3),
                )
            }
        }
        return out
    }

    @Synchronized
    fun ackResult(id: String) {
        writableDatabase.delete("results", "command_id = ?", arrayOf(id))
    }

    @Synchronized
    fun hasResult(id: String): Boolean =
        readableDatabase.rawQuery("SELECT 1 FROM results WHERE command_id = ?", arrayOf(id)).use { it.moveToFirst() }

    fun counts(): Pair<Int, Int> {
        val sms = readableDatabase.rawQuery("SELECT COUNT(*) FROM sms", null).use { it.moveToFirst(); it.getInt(0) }
        val res = readableDatabase.rawQuery("SELECT COUNT(*) FROM results", null).use { it.moveToFirst(); it.getInt(0) }
        return sms to res
    }
}
