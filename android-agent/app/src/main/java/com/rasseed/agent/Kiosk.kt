package com.rasseed.agent

import android.Manifest
import android.app.Activity
import android.app.ActivityManager
import android.app.NotificationManager
import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.telecom.TelecomManager
import java.security.MessageDigest

/** Device admin component. The setup script makes it the device owner, which is what allows kiosk mode. */
class KioskAdmin : DeviceAdminReceiver()

/**
 * Forgot-PIN escape hatch, reachable only from a PC over adb (kiosk-reset.bat): the DUMP permission
 * is held by the adb shell but can't be given to a normal app.
 */
class KioskResetReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Kiosk.disable(context, null)
        Prefs(context).kioskPinHash = null
    }
}

/**
 * Kiosk mode: the phone only runs Sarfli Agent. Needs the app to be device owner (set over adb by
 * setup-device.bat). While on:
 *  - the agent is the home screen and the task is locked (no Home, Recents, notification shade),
 *  - only the phone/dialer apps may open on top of it, so USSD popups still work,
 *  - every user-installed app is suspended (can't run, notify or pop up),
 *  - Do Not Disturb is on (if allowed), the lock screen is off, the agent can't be uninstalled.
 * Leaving it needs the PIN chosen when it was turned on.
 */
object Kiosk {
    private val TELEPHONY_PACKAGES = listOf(
        "com.android.phone", "com.android.server.telecom", "com.android.dialer", "com.google.android.dialer",
        "com.android.incallui", "com.android.stk", "com.android.stk2", "com.android.contacts",
        "com.samsung.android.incallui", "com.samsung.android.dialer", "com.android.mms.service",
    )

    private fun admin(context: Context) = ComponentName(context, KioskAdmin::class.java)
    private fun dpm(context: Context) = context.getSystemService(DevicePolicyManager::class.java)
    private fun homeAlias(context: Context) = ComponentName(context.packageName, "${context.packageName}.KioskHome")

    fun isDeviceOwner(context: Context) = dpm(context)?.isDeviceOwnerApp(context.packageName) == true

    /** Kiosk is wanted and actually possible. */
    fun isOn(context: Context) = Prefs(context).kioskOn && isDeviceOwner(context)

    fun hasPin(context: Context) = Prefs(context).kioskPinHash != null

    fun checkPin(context: Context, pin: String) = Prefs(context).kioskPinHash == hash(context, pin)

    /** Turns kiosk on with a new PIN and locks [activity] in. */
    fun enable(activity: Activity, pin: String) {
        val prefs = Prefs(activity)
        prefs.kioskPinHash = hash(activity, pin)
        prefs.kioskOn = true
        apply(activity)
        lock(activity)
    }

    /**
     * Re-applies every kiosk policy. Idempotent: called on each start of the screen, after a reboot and
     * after an app update, so a setting changed or reset by the system is put back.
     */
    fun apply(context: Context) {
        if (!isOn(context)) return
        val dpm = dpm(context) ?: return
        val admin = admin(context)
        val pkg = context.packageName
        safe { dpm.setLockTaskPackages(admin, allowedPackages(context).toTypedArray()) }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // Only the power menu stays, so the phone can still be restarted. No notifications, Home or Recents.
            safe { dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS) }
        }
        safe { dpm.setStatusBarDisabled(admin, true) }
        safe { dpm.setKeyguardDisabled(admin, true) }
        safe { dpm.setUninstallBlocked(admin, pkg, true) }
        safe { dpm.setGlobalSetting(admin, Settings.Global.STAY_ON_WHILE_PLUGGED_IN, "7") }
        // Permissions can't be revoked by mistake while the device is locked down.
        val perms = Telephony.REQUIRED.toMutableList()
        if (Build.VERSION.SDK_INT >= 33) perms += Manifest.permission.POST_NOTIFICATIONS
        for (p in perms) safe { dpm.setPermissionGrantState(admin, pkg, p, DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED) }
        // The agent is the launcher, so it comes back by itself after a reboot.
        safe {
            context.packageManager.setComponentEnabledSetting(
                homeAlias(context), PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP,
            )
            val home = IntentFilter(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_HOME)
                addCategory(Intent.CATEGORY_DEFAULT)
            }
            dpm.addPersistentPreferredActivity(admin, home, homeAlias(context))
        }
        suspendOtherApps(context, dpm, admin)
        setDoNotDisturb(context, true)
    }

    /**
     * Turns kiosk off and gives the phone back (apps, status bar, launcher). The app stays device owner,
     * so kiosk can be turned on again without a PC. [activity] is null when reset over adb.
     */
    fun disable(context: Context, activity: Activity?) {
        val prefs = Prefs(context)
        prefs.kioskOn = false
        if (!isDeviceOwner(context)) return
        val dpm = dpm(context) ?: return
        val admin = admin(context)
        activity?.let { a -> safe { a.stopLockTask() } }
        // Emptying the list also ends lock task when there is no activity to stop it.
        safe { dpm.setLockTaskPackages(admin, emptyArray()) }
        safe { dpm.setStatusBarDisabled(admin, false) }
        safe { dpm.setKeyguardDisabled(admin, false) }
        safe { dpm.clearPackagePersistentPreferredActivities(admin, context.packageName) }
        safe {
            context.packageManager.setComponentEnabledSetting(
                homeAlias(context), PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP,
            )
        }
        val suspended = prefs.kioskSuspended
        if (suspended.isNotEmpty()) safe { dpm.setPackagesSuspended(admin, suspended.toTypedArray(), false) }
        prefs.kioskSuspended = emptySet()
        setDoNotDisturb(context, false)
    }

    /** Gives up device ownership entirely (kiosk off first). After this the setup script is needed again. */
    fun removeDeviceOwner(activity: Activity) {
        disable(activity, activity)
        val dpm = dpm(activity) ?: return
        safe { dpm.setUninstallBlocked(admin(activity), activity.packageName, false) }
        @Suppress("DEPRECATION")
        safe { dpm.clearDeviceOwnerApp(activity.packageName) }
    }

    /** Enters lock task if kiosk is on and the activity isn't locked yet. */
    fun lock(activity: Activity) {
        if (!isOn(activity)) return
        val am = activity.getSystemService(ActivityManager::class.java)
        if (am.lockTaskModeState == ActivityManager.LOCK_TASK_MODE_NONE) safe { activity.startLockTask() }
    }

    /**
     * Our package plus every app that may show the call/USSD screens. Without them in the list, the
     * system would refuse to open the dialer while locked and every USSD would fail.
     */
    private fun allowedPackages(context: Context): Set<String> {
        val out = linkedSetOf(context.packageName)
        out += TELEPHONY_PACKAGES
        val telecom = context.getSystemService(TelecomManager::class.java)
        safe { telecom?.defaultDialerPackage?.let { out += it } }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) safe { telecom?.systemDialerPackage?.let { out += it } }
        val pm = context.packageManager
        for (action in listOf(Intent.ACTION_CALL, Intent.ACTION_DIAL)) {
            safe {
                pm.queryIntentActivities(Intent(action, Uri.parse("tel:123")), PackageManager.MATCH_ALL)
                    .forEach { out += it.activityInfo.packageName }
            }
        }
        return out
    }

    /** Suspends every user-installed app (not system apps: the phone needs those). */
    private fun suspendOtherApps(context: Context, dpm: DevicePolicyManager, admin: ComponentName) {
        val keep = allowedPackages(context)
        @Suppress("DEPRECATION")
        val targets = context.packageManager.getInstalledApplications(0)
            .filter { it.flags and ApplicationInfo.FLAG_SYSTEM == 0 && it.packageName !in keep }
            .map { it.packageName }
        if (targets.isEmpty()) return
        safe {
            val failed = dpm.setPackagesSuspended(admin, targets.toTypedArray(), true).toSet()
            val prefs = Prefs(context)
            prefs.kioskSuspended = prefs.kioskSuspended + (targets.toSet() - failed)
        }
    }

    /** Silences every other notification. Needs DND access, granted by the setup script. */
    private fun setDoNotDisturb(context: Context, on: Boolean) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        if (!nm.isNotificationPolicyAccessGranted) return
        safe {
            nm.setInterruptionFilter(
                if (on) NotificationManager.INTERRUPTION_FILTER_NONE else NotificationManager.INTERRUPTION_FILTER_ALL,
            )
        }
    }

    fun dndAllowed(context: Context) =
        context.getSystemService(NotificationManager::class.java)?.isNotificationPolicyAccessGranted == true

    private fun hash(context: Context, pin: String): String =
        MessageDigest.getInstance("SHA-256").digest("${context.packageName}:$pin".toByteArray())
            .joinToString("") { "%02x".format(it) }

    private inline fun safe(block: () -> Unit) {
        try {
            block()
        } catch (_: Throwable) {
            // One policy failing (older Android, brand restrictions) must not stop the others.
        }
    }
}
