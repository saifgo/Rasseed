package com.rasseed.agent

import android.accessibilityservice.AccessibilityService
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.text.Normalizer
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Fallback for operators whose balance code opens an interactive USSD session (e.g. Orange *101#
 * shows "01:Page suivante" with Send/Cancel), which Android's silent USSD API refuses on many phones.
 * The code is dialled like a normal call on the right SIM; this service reads the popup text and
 * presses Cancel to close the session. When the balance isn't on the page but the menu offers a next
 * page ("01:Page suivante"), it types that option, sends it and reads the following page too.
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
        if (text == capture.lastPage) return // previous page still on screen after we pressed Send
        capture.lastPage = text
        capture.pages += text
        val option = if (capture.pages.size < MAX_PAGES) nextPageOption(capture.allText(), text, capture.balance) else null
        if (option != null && reply(root, option)) return // wait for the next page
        pending = null
        dismiss(root)
        capture.finish()
    }

    /** Types [option] (e.g. "01") into the USSD popup and presses Send. */
    private fun reply(root: AccessibilityNodeInfo, option: String): Boolean {
        val input = findEditable(root) ?: return false
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, option)
        }
        if (!input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) return false
        for (label in SEND_LABELS) {
            for (node in root.findAccessibilityNodeInfosByText(label)) {
                var n: AccessibilityNodeInfo? = node
                while (n != null && !n.isClickable) n = n.parent
                if (n != null && n.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true
            }
        }
        return false
    }

    private fun findEditable(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        if (node.isEditable || node.className?.toString()?.contains("EditText") == true) return node
        for (i in 0 until node.childCount) node.getChild(i)?.let { c -> findEditable(c)?.let { return it } }
        return null
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

    private class Capture(val balance: Regex?) {
        val latch = CountDownLatch(1)
        // Written on the main thread, read by the waiting worker on timeout.
        val pages = CopyOnWriteArrayList<String>()
        var lastPage: String? = null
        @Volatile var result: String? = null

        fun allText() = pages.joinToString("\n")

        fun finish() {
            result = allText()
            latch.countDown()
        }
    }

    companion object {
        @Volatile private var instance: UssdAccessibilityService? = null
        @Volatile private var pending: Capture? = null

        private val USSD_PACKAGES = listOf("com.android.phone", "telephony", "telecom", "dialer", "incallui", "ussd")
        private val PROGRESS = Regex("(running|en cours|ex[ée]cution|loading|chargement|جار)", RegexOption.IGNORE_CASE)
        private val DISMISS_LABELS = listOf("Cancel", "Annuler", "OK", "Fermer", "Dismiss", "إلغاء", "موافق")
        private val SEND_LABELS = listOf("Send", "Envoyer", "Répondre", "Reply", "إرسال")
        /** A menu line offering the next page, e.g. "01:Page suivante". Group 1 is what to type. */
        private val NEXT_PAGE = Regex(
            """(?m)^\s*(\d{1,2})\s*[:.)\-]\s*(page\s+suivante|suivant|next)""",
            RegexOption.IGNORE_CASE,
        )
        private const val MAX_PAGES = 4

        /** Compiles the operator's balance pattern (server sends the JS regex; the syntax used is Java-compatible). */
        fun balancePattern(regex: String?): Regex? = try {
            regex?.let { Regex(it, RegexOption.IGNORE_CASE) }
        } catch (_: Exception) {
            null
        }

        /**
         * The option to type to see the next page, or null when [allText] already holds the balance,
         * [lastPage] has no next-page entry, or there is no pattern to tell.
         */
        fun nextPageOption(allText: String, lastPage: String, balance: Regex?): String? {
            if (balance == null) return null
            if (balance.containsMatchIn(Normalizer.normalize(allText, Normalizer.Form.NFC))) return null
            return NEXT_PAGE.find(lastPage)?.groupValues?.get(1)
        }

        /** True when the service is actually connected, not just switched on in Settings. */
        fun isRunning() = instance != null

        /**
         * The connected service, waiting briefly in case Android is still (re)binding it. Null when the
         * toggle is on but the service never connected (typical after an app update or a battery kill).
         */
        private fun awaitInstance(waitMs: Long = 5000): UssdAccessibilityService? {
            val deadline = System.currentTimeMillis() + waitMs
            while (instance == null && System.currentTimeMillis() < deadline) Thread.sleep(250)
            return instance
        }

        fun isEnabled(context: Context): Boolean {
            val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
            return enabled.split(':').any { it.startsWith(context.packageName + "/") }
        }

        /** Dials the USSD on the given SIM and returns the popup text, or an error code. Not on the main thread. */
        @SuppressLint("MissingPermission")
        fun run(
            context: Context,
            subscriptionId: Int,
            code: String,
            balanceRegex: String? = null,
            timeoutSeconds: Long = 60,
        ): Telephony.UssdResult {
            val service = awaitInstance()
                ?: return Telephony.UssdResult(false, null, "accessibility_not_running")
            val handle = phoneAccountFor(context, subscriptionId)
                ?: return Telephony.UssdResult(false, null, "no_phone_account_for_sim")
            val capture = Capture(balancePattern(balanceRegex))
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
            // Timed out waiting for a later page: report the pages read so far.
            val text = capture.result
                ?: capture.allText().ifEmpty { null }
                ?: return Telephony.UssdResult(false, null, "popup_timeout")
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
            handles.firstOrNull { it.id == subscriptionId.toString() }?.let { return it }
            // Many older phones (Android 7/8) use the SIM's ICCID as the account id.
            val iccId = try {
                context.getSystemService(SubscriptionManager::class.java)
                    ?.getActiveSubscriptionInfo(subscriptionId)?.iccId
            } catch (_: Exception) {
                null
            }
            if (!iccId.isNullOrEmpty()) {
                handles.firstOrNull { it.id.length >= 10 && (iccId.startsWith(it.id) || it.id.startsWith(iccId)) }
                    ?.let { return it }
            }
            return handles.singleOrNull()
        }
    }
}
