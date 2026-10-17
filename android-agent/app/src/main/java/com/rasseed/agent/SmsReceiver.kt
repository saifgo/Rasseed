package com.rasseed.agent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Telephony as AndroidTelephony

/**
 * Receives every incoming SMS, stores it in the durable outbox and wakes the service to upload it.
 * Parsing (is it a credit? from whom? how much?) is done on the server so it can be changed without
 * updating the phones.
 */
class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != AndroidTelephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val parts = AndroidTelephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        if (parts.isEmpty()) return
        val subId = intent.extras?.let { e ->
            listOf("android.telephony.extra.SUBSCRIPTION_INDEX", "subscription", "sub_id")
                .firstNotNullOfOrNull { k -> if (e.containsKey(k)) e.getInt(k, -1).takeIf { it >= 0 } else null }
        }
        val slot = intent.extras?.let { e ->
            listOf("android.telephony.extra.SLOT_INDEX", "slot", "simSlot", "slot_id")
                .firstNotNullOfOrNull { k -> if (e.containsKey(k)) e.getInt(k, -1).takeIf { it >= 0 } else null }
        }
        // A long SMS arrives as several parts in one broadcast: join them.
        val from = parts[0].displayOriginatingAddress ?: parts[0].originatingAddress ?: ""
        val body = parts.joinToString("") { it.displayMessageBody ?: it.messageBody ?: "" }
        val sentAt = parts[0].timestampMillis
        val now = System.currentTimeMillis()
        Store(context).queueSms(
            QueuedSms(
                localId = "rx-$sentAt-${from.hashCode()}-${body.hashCode()}",
                subscriptionId = subId,
                slotIndex = slot,
                from = from,
                body = body,
                sentAt = sentAt,
                receivedAt = now,
            ),
        )
        AgentService.kick(context)
    }
}

/**
 * Safety net: reads the SMS inbox for messages the broadcast may have missed (app killed, phone
 * rebooting). The server de-duplicates on (phone, sender, body, sent time), so overlaps are harmless.
 */
object InboxScanner {
    fun scan(context: Context) {
        if (!Telephony.hasPermissions(context)) return
        val prefs = Prefs(context)
        val cursorId = prefs.inboxCursor
        val store = Store(context)
        val uri = Uri.parse("content://sms/inbox")
        try {
            // First run: start from the latest message instead of uploading the whole history.
            if (cursorId < 0) {
                context.contentResolver.query(uri, arrayOf("_id"), null, null, "_id DESC LIMIT 1")?.use { c ->
                    prefs.inboxCursor = if (c.moveToFirst()) c.getLong(0) else 0
                }
                return
            }
            var maxId = cursorId
            context.contentResolver.query(uri, null, "_id > ?", arrayOf(cursorId.toString()), "_id ASC")?.use { c ->
                val idCol = c.getColumnIndex("_id")
                val addrCol = c.getColumnIndex("address")
                val bodyCol = c.getColumnIndex("body")
                val dateCol = c.getColumnIndex("date")
                val sentCol = c.getColumnIndex("date_sent")
                val subCol = c.getColumnIndex("sub_id")
                while (c.moveToNext()) {
                    val id = c.getLong(idCol)
                    maxId = maxOf(maxId, id)
                    val sentAt = if (sentCol >= 0 && c.getLong(sentCol) > 0) c.getLong(sentCol) else c.getLong(dateCol)
                    val from = c.getString(addrCol) ?: ""
                    val body = c.getString(bodyCol) ?: ""
                    store.queueSms(
                        QueuedSms(
                            localId = "rx-$sentAt-${from.hashCode()}-${body.hashCode()}",
                            subscriptionId = if (subCol >= 0) c.getInt(subCol).takeIf { it >= 0 } else null,
                            slotIndex = null,
                            from = from,
                            body = body,
                            sentAt = sentAt,
                            receivedAt = c.getLong(dateCol),
                        ),
                    )
                }
            }
            prefs.inboxCursor = maxId
        } catch (_: Exception) {
            // Some ROMs restrict inbox access; the broadcast receiver remains the primary path.
        }
    }
}
