package com.rasseed.agent

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

data class SimSlot(val slotIndex: Int, val subscriptionId: Int, val carrierName: String)

object Telephony {

    fun hasPermissions(context: Context) = REQUIRED.all {
        ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
    }

    val REQUIRED = arrayOf(
        Manifest.permission.RECEIVE_SMS,
        Manifest.permission.READ_SMS,
        Manifest.permission.CALL_PHONE,
        Manifest.permission.READ_PHONE_STATE,
    )

    /** Active SIMs with their slot and subscription id (dual-SIM phones report two). */
    @SuppressLint("MissingPermission")
    fun activeSims(context: Context): List<SimSlot> {
        if (!hasPermissions(context)) return emptyList()
        val sm = context.getSystemService(SubscriptionManager::class.java) ?: return emptyList()
        return sm.activeSubscriptionInfoList.orEmpty().map {
            SimSlot(it.simSlotIndex, it.subscriptionId, it.carrierName?.toString() ?: "")
        }
    }

    data class UssdResult(val ok: Boolean, val response: String?, val error: String?)

    /**
     * Runs a single-shot USSD (e.g. *100#) on the given SIM and waits for the network reply.
     * Must not be called on the main thread. Android only runs one USSD session at a time,
     * so callers run commands strictly one after another.
     */
    @SuppressLint("MissingPermission")
    fun runUssd(context: Context, subscriptionId: Int, code: String, timeoutSeconds: Long = 40): UssdResult {
        if (!hasPermissions(context)) return UssdResult(false, null, "missing_permission")
        val tm = context.getSystemService(TelephonyManager::class.java)?.createForSubscriptionId(subscriptionId)
            ?: return UssdResult(false, null, "no_telephony")
        val latch = CountDownLatch(1)
        var result = UssdResult(false, null, "timeout")
        val callback = object : TelephonyManager.UssdResponseCallback() {
            override fun onReceiveUssdResponse(tm: TelephonyManager, request: String, response: CharSequence) {
                result = UssdResult(true, response.toString(), null)
                latch.countDown()
            }

            override fun onReceiveUssdResponseFailed(tm: TelephonyManager, request: String, failureCode: Int) {
                val reason = when (failureCode) {
                    TelephonyManager.USSD_RETURN_FAILURE -> "USSD_RETURN_FAILURE"
                    TelephonyManager.USSD_ERROR_SERVICE_UNAVAIL -> "USSD_ERROR_SERVICE_UNAVAIL"
                    else -> "USSD_FAILED_$failureCode"
                }
                result = UssdResult(false, null, reason)
                latch.countDown()
            }
        }
        try {
            tm.sendUssdRequest(code, callback, Handler(Looper.getMainLooper()))
        } catch (e: Exception) {
            return UssdResult(false, null, "exception: ${e.message}")
        }
        latch.await(timeoutSeconds, TimeUnit.SECONDS)
        return result
    }
}
