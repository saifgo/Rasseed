package com.rasseed.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.content.ContextCompat
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Foreground service that runs 24/7:
 *  1. heartbeat + fetch USSD commands every few seconds,
 *  2. run each balance USSD on the right SIM (one at a time) and report the raw reply,
 *  3. upload queued SMS until the server acknowledges them.
 */
class AgentService : Service() {
    private val executor = Executors.newSingleThreadScheduledExecutor()
    private val running = AtomicBoolean(false)
    private lateinit var prefs: Prefs
    private lateinit var store: Store
    private var wakeLock: PowerManager.WakeLock? = null
    private var loops = 0

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
        store = Store(this)
        startForegroundCompat()
        wakeLock = (getSystemService(POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "rasseed:agent")
            .apply { setReferenceCounted(false); acquire() }
        executor.scheduleWithFixedDelay({ cycle() }, 0, INTERVAL_SECONDS, TimeUnit.SECONDS)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_KICK) executor.execute { cycle() }
        return START_STICKY
    }

    override fun onDestroy() {
        executor.shutdownNow()
        wakeLock?.release()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun cycle() {
        if (!running.compareAndSet(false, true)) return
        try {
            if (!prefs.paired) return
            val api = Api(prefs.serverUrl, prefs.token)
            if (loops++ % 10 == 0) InboxScanner.scan(this)

            // Results first (they may unblock a seller), then SMS, then new commands.
            for (r in store.pendingResults()) {
                api.postResult(r)
                store.ackResult(r.commandId)
            }
            flushSms(api)

            val battery = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            val level = battery?.let {
                val l = it.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
                val s = it.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
                if (l >= 0 && s > 0) l * 100 / s else null
            }
            val plugged = battery?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0)?.let { it != 0 }
            val commands = api.sync(
                Telephony.activeSims(this), level, plugged,
                "${Build.MANUFACTURER} ${Build.MODEL}", Build.VERSION.RELEASE, BuildConfig.VERSION_NAME,
            )
            prefs.lastSyncAt = System.currentTimeMillis()
            prefs.lastError = ""

            for (cmd in commands) {
                if (store.hasResult(cmd.id)) continue
                val res = if (cmd.type == "ussd_balance") {
                    val silent = Telephony.runUssd(this, cmd.subscriptionId, cmd.ussd)
                    // The silent API can't answer a menu, so if the balance is on a later page
                    // ("01:Page suivante") the popup route is needed to type 01.
                    val needsNextPage = silent.ok && UssdAccessibilityService.nextPageOption(
                        silent.response.orEmpty(), silent.response.orEmpty(),
                        UssdAccessibilityService.balancePattern(cmd.balanceRegex),
                    ) != null
                    // Interactive replies make the silent API fail on many phones: dial the code
                    // and read the popup instead.
                    if ((silent.ok && !needsNextPage) || !UssdAccessibilityService.isEnabled(this)) silent
                    else UssdAccessibilityService.run(this, cmd.subscriptionId, cmd.ussd, cmd.balanceRegex).let {
                        when {
                            it.ok -> it
                            silent.ok -> silent // keep the first page rather than nothing
                            else -> it.copy(error = "${silent.error}; dialer: ${it.error}")
                        }
                    }
                } else {
                    Telephony.UssdResult(false, null, "unsupported_command")
                }
                // Persist before sending: if the upload fails it is retried next cycle.
                val queued = QueuedResult(cmd.id, res.ok, res.response, res.error)
                store.queueResult(queued)
                try {
                    api.postResult(queued)
                    store.ackResult(cmd.id)
                } catch (_: Exception) {
                }
                // New SMS may have arrived while waiting for the USSD reply.
                flushSms(api)
            }
        } catch (e: ApiException) {
            prefs.lastError = e.message ?: "HTTP ${e.status}"
            if (e.status == 401) prefs.lastError = "Unauthorized: pair this phone again"
        } catch (e: Exception) {
            prefs.lastError = e.message ?: e.javaClass.simpleName
        } finally {
            running.set(false)
            updateNotification()
        }
    }

    private fun flushSms(api: Api) {
        while (true) {
            val batch = store.pendingSms()
            if (batch.isEmpty()) return
            val accepted = api.uploadSms(batch)
            store.ackSms(accepted)
            if (accepted.size < batch.size) return
        }
    }

    private fun startForegroundCompat() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getSystemService(NotificationManager::class.java)
                .createNotificationChannel(NotificationChannel(CHANNEL, "Agent", NotificationManager.IMPORTANCE_LOW))
        }
        val n = buildNotification("Starting…")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, n)
        }
    }

    private fun updateNotification() {
        val (sms, res) = store.counts()
        val text = when {
            !prefs.paired -> "Not paired"
            prefs.lastError.isNotEmpty() -> "Error: ${prefs.lastError.take(80)}"
            sms + res > 0 -> "Online · $sms SMS / $res results waiting"
            else -> "Online · ${Telephony.activeSims(this).size} SIM"
        }
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun buildNotification(text: String): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this).setPriority(Notification.PRIORITY_LOW)
        }
        return builder
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_stat)
            .setOngoing(true)
            .setContentIntent(open)
            .build()
    }

    companion object {
        private const val CHANNEL = "agent"
        private const val NOTIFICATION_ID = 1
        private const val INTERVAL_SECONDS = 3L
        private const val ACTION_KICK = "kick"

        fun start(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, AgentService::class.java))
        }

        /** Ask the service to sync now (e.g. a new SMS arrived). */
        fun kick(context: Context) {
            try {
                ContextCompat.startForegroundService(context, Intent(context, AgentService::class.java).setAction(ACTION_KICK))
            } catch (_: Exception) {
                // Background start restrictions: the SMS is safely queued and will go out on the next cycle.
            }
        }
    }
}

class BootReceiver : android.content.BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (Prefs(context).paired) AgentService.start(context)
    }
}
