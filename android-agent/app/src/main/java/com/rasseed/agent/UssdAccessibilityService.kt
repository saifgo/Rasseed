package com.rasseed.agent

import android.accessibilityservice.AccessibilityService
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.telephony.TelephonyManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Fallback for operators whose balance code opens an interactive USSD session (e.g. Orange *101#
 * shows "01:Page suivante" with Send/Cancel), which Android's silent USSD API refuses on many phones.
 * The code is dialled like a normal call on the right SIM; this service reads the popup text and
 * presses Cancel to close the session.
 */
class UssdAccessibilityService : AccessibilityService() {

    override fun onServiceConnected() {
        instance = this
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    override fun onInterrupt() {}

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        val capture = pending ?: return
        val pkg = event.packageName?.toString() ?: return
        if (!USSD_PACKAGES.any { pkg.contains(it) }) return
        val root = rootInActiveWindow ?: event.source ?: return
        val texts = mutableListOf<String>()
        collectTexts(root, texts)
        val text = texts.joinToString("\n").trim()
        if (text.length < 5 || PROGRESS.containsMatchIn(text)) return // "USSD code running…"
        pending = null
        dismiss(root)
        capture.result = text
        capture.latch.countDown()
    }

    private fun collectTexts(node: AccessibilityNodeInfo, out: MutableList<String>) {
        val cls = node.className?.toString() ?: ""
        val t = node.text?.toString()?.trim()
        if (!t.isNullOrEmpty() && !cls.contains("Button") && !cls.contains("EditText")) out += t
        for (i in 0 until node.childCount) node.getChild(i)?.let { collectTexts(it, out) }
    }

    /** Closes the session: Cancel/OK if found, otherwise Back. */
    private fun dismiss(root: AccessibilityNodeInfo) {
        for (label in DISMISS_LABELS) {
            val btn = root.findAccessibilityNodeInfosByText(label).firstOrNull { it.isClickable }
            if (btn != null && btn.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return
        }
        performGlobalAction(GLOBAL_ACTION_BACK)
    }

    private class Capture {
        val latch = CountDownLatch(1)
        @Volatile var result: String? = null
    }

    companion object {
        @Volatile private var instance: UssdAccessibilityService? = null
        @Volatile private var pending: Capture? = null

        private val USSD_PACKAGES = listOf("com.android.phone", "telephony", "telecom", "dialer", "incallui", "ussd")
        private val PROGRESS = Regex("(running|en cours|ex[ée]cution|loading|chargement|جار)", RegexOption.IGNORE_CASE)
        private val DISMISS_LABELS = listOf("Cancel", "Annuler", "OK", "Fermer", "Dismiss", "إلغاء", "موافق")

        fun isEnabled(context: Context): Boolean {
            val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
            return enabled.split(':').any { it.startsWith(context.packageName + "/") }
        }

        /** Dials the USSD on the given SIM and returns the popup text, or an error code. Not on the main thread. */
        @SuppressLint("MissingPermission")
        fun run(context: Context, subscriptionId: Int, code: String, timeoutSeconds: Long = 45): Telephony.UssdResult {
            val service = instance ?: return Telephony.UssdResult(false, null, "accessibility_disabled")
            val handle = phoneAccountFor(context, subscriptionId)
                ?: return Telephony.UssdResult(false, null, "no_phone_account_for_sim")
            val capture = Capture()
            pending = capture
            // The popup may not render while the screen is off.
            @Suppress("DEPRECATION")
            val wake = (context.getSystemService(Context.POWER_SERVICE) as PowerManager).newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP, "rasseed:ussd",
            )
            try {
                wake.acquire(timeoutSeconds * 1000)
                val intent = Intent(Intent.ACTION_CALL, Uri.fromParts("tel", code, null))
                    .putExtra(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, handle)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                service.startActivity(intent)
                capture.latch.await(timeoutSeconds, TimeUnit.SECONDS)
            } catch (e: Exception) {
                return Telephony.UssdResult(false, null, "dial_failed: ${e.message}")
            } finally {
                pending = null
                if (wake.isHeld) wake.release()
            }
            val text = capture.result ?: return Telephony.UssdResult(false, null, "popup_timeout")
            return Telephony.UssdResult(true, text, null)
        }

        @SuppressLint("MissingPermission")
        private fun phoneAccountFor(context: Context, subscriptionId: Int): PhoneAccountHandle? {
            val telecom = context.getSystemService(TelecomManager::class.java) ?: return null
            val handles = telecom.callCapablePhoneAccounts
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val tm = context.getSystemService(TelephonyManager::class.java)
                handles.firstOrNull { tm.getSubscriptionId(it) == subscriptionId }?.let { return it }
            }
            return handles.firstOrNull { it.id == subscriptionId.toString() }
                ?: handles.singleOrNull()
        }
    }
}
