package com.rasseed.agent

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import java.text.DateFormat
import java.util.Date
import kotlin.concurrent.thread

/** One-screen setup: permissions, battery exemption, pairing, live status and kiosk mode. */
class MainActivity : Activity() {
    private lateinit var prefs: Prefs
    private lateinit var status: TextView
    private lateinit var serverInput: EditText
    private lateinit var codeInput: EditText
    private lateinit var pairSection: LinearLayout
    private lateinit var setupSection: LinearLayout
    private lateinit var repairButton: Button
    private lateinit var kioskStatus: TextView
    private lateinit var kioskButton: Button
    private lateinit var removeOwnerButton: Button
    private var backCallback: Any? = null
    private val handler = Handler(Looper.getMainLooper())
    private val refresh = object : Runnable {
        override fun run() {
            render()
            handler.postDelayed(this, 2000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        val pad = (16 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad * 2, pad, pad)
        }
        root.addView(TextView(this).apply {
            text = getString(R.string.app_name)
            textSize = 24f
            typeface = Typeface.DEFAULT_BOLD
        })
        root.addView(TextView(this).apply {
            text = "Keep this phone plugged in, on Wi-Fi, with its SIMs inserted."
            setPadding(0, pad / 2, 0, pad)
        })

        // Setup steps open Android Settings, which kiosk mode blocks: hidden while it is on.
        setupSection = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(setupSection)
        setupSection.addView(button("1. Grant SMS & phone permissions") { requestPermissions() })
        setupSection.addView(button("2. Allow running in background (battery)") { requestBatteryExemption() })
        setupSection.addView(button("3. Enable balance reading (Accessibility)") {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        })
        setupSection.addView(TextView(this).apply {
            text = (if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) "REQUIRED on this phone (Android 7): balance checks only work with it. " else "") +
                "Needed when the operator's balance code shows a popup/menu (e.g. Orange *101#). " +
                "If Android says the setting is restricted: App info → ⋮ → Allow restricted settings, then try again. " +
                "Also: no screen lock PIN, and keep the phone charging."
            textSize = 12f
        })

        pairSection = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        serverInput = EditText(this).apply {
            hint = "Server URL, e.g. http://192.168.1.10:3100"
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            setText(prefs.serverUrl)
        }
        codeInput = EditText(this).apply {
            hint = "6-digit pairing code from Admin → Numbers & phones"
            inputType = InputType.TYPE_CLASS_NUMBER
        }
        pairSection.addView(label("4. Pair with the server"))
        pairSection.addView(serverInput)
        pairSection.addView(codeInput)
        pairSection.addView(button("Pair") { pair() })
        root.addView(pairSection)

        root.addView(label("Status"))
        status = TextView(this).apply { typeface = Typeface.MONOSPACE }
        root.addView(status)
        repairButton = button("Re-pair this phone") {
            prefs.token = null
            render()
        }
        root.addView(repairButton)

        root.addView(label("Kiosk mode"))
        kioskStatus = TextView(this).apply { textSize = 12f }
        root.addView(kioskStatus)
        kioskButton = button("") { onKioskButton() }
        root.addView(kioskButton)
        removeOwnerButton = button("Remove kiosk admin (back to a normal phone)") { confirmRemoveOwner() }
        root.addView(removeOwnerButton)
        setContentView(ScrollView(this).apply { addView(root) })

        if (prefs.paired) AgentService.start(this)
    }

    override fun onResume() {
        super.onResume()
        // Re-applied every time: puts back anything the system reset (after a reboot or an update).
        Kiosk.apply(this)
        Kiosk.lock(this)
        updateBackHandling()
        handler.post(refresh)
    }

    override fun onPause() {
        handler.removeCallbacks(refresh)
        super.onPause()
    }

    @SuppressLint("GestureBackNavigation") // Android 13+ is handled by updateBackHandling()
    @Deprecated("Android 12 and older")
    override fun onBackPressed() {
        if (Kiosk.isOn(this)) return // the agent screen can't be left in kiosk mode
        @Suppress("DEPRECATION")
        super.onBackPressed()
    }

    /** Android 13+: Back doesn't reach onBackPressed, so a do-nothing callback takes it while kiosk is on. */
    private fun updateBackHandling() {
        if (Build.VERSION.SDK_INT < 33) return
        val cb = (backCallback ?: OnBackInvokedCallback { }.also { backCallback = it }) as OnBackInvokedCallback
        onBackInvokedDispatcher.unregisterOnBackInvokedCallback(cb)
        if (Kiosk.isOn(this)) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, cb)
        }
    }

    private fun onKioskButton() {
        if (!Kiosk.isDeviceOwner(this)) return
        if (Kiosk.isOn(this)) {
            askPin("Unlock kiosk mode", "Enter the kiosk PIN.") { pin ->
                if (Kiosk.checkPin(this, pin)) {
                    Kiosk.disable(this, this)
                    toast("Kiosk mode off. Turn it back on when you are done.")
                } else {
                    toast("Wrong PIN")
                }
                kioskChanged()
            }
            return
        }
        askPin("Turn on kiosk mode", "Choose a PIN (4 to 8 digits). It is needed to leave kiosk mode.") { pin ->
            if (pin.length !in 4..8) {
                toast("The PIN must be 4 to 8 digits")
                return@askPin
            }
            askPin("Turn on kiosk mode", "Type the same PIN again.") { again ->
                if (again != pin) {
                    toast("The PINs don't match")
                } else {
                    Kiosk.enable(this, pin)
                    toast("Kiosk mode on")
                }
                kioskChanged()
            }
        }
    }

    private fun kioskChanged() {
        updateBackHandling()
        render()
    }

    private fun confirmRemoveOwner() {
        AlertDialog.Builder(this)
            .setTitle("Remove kiosk admin?")
            .setMessage("The phone goes back to normal. Kiosk mode can then only be turned on again from a PC with setup-device.bat.")
            .setPositiveButton("Remove") { _, _ ->
                Kiosk.removeDeviceOwner(this)
                kioskChanged()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun askPin(title: String, message: String, onPin: (String) -> Unit) {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        }
        AlertDialog.Builder(this)
            .setTitle(title)
            .setMessage(message)
            .setView(input)
            .setPositiveButton("OK") { _, _ -> onPin(input.text.toString().trim()) }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_LONG).show()

    private fun button(text: String, onClick: () -> Unit) = Button(this).apply {
        this.text = text
        isAllCaps = false
        setOnClickListener { onClick() }
    }

    private fun label(text: String) = TextView(this).apply {
        this.text = text
        typeface = Typeface.DEFAULT_BOLD
        setPadding(0, (20 * resources.displayMetrics.density).toInt(), 0, 8)
        gravity = Gravity.START
    }

    private fun requestPermissions() {
        val perms = Telephony.REQUIRED.toMutableList()
        if (Build.VERSION.SDK_INT >= 33) perms += Manifest.permission.POST_NOTIFICATIONS
        requestPermissions(perms.toTypedArray(), 1)
    }

    @SuppressLint("BatteryLife")
    private fun requestBatteryExemption() {
        val pm = getSystemService(PowerManager::class.java)
        if (!pm.isIgnoringBatteryOptimizations(packageName)) {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        }
    }

    private fun pair() {
        val server = serverInput.text.toString().trim().trimEnd('/')
        val code = codeInput.text.toString().trim()
        if (!server.startsWith("http")) {
            status.text = "Enter the server URL starting with http:// or https://"
            return
        }
        status.text = "Pairing…"
        thread {
            try {
                val (token, name) = Api(server, null).pair(code)
                prefs.serverUrl = server
                prefs.token = token
                prefs.deviceName = name
                prefs.lastError = ""
                runOnUiThread {
                    codeInput.setText("")
                    AgentService.start(this)
                    render()
                }
            } catch (e: Exception) {
                runOnUiThread { status.text = "Pairing failed: ${e.message}" }
            }
        }
    }

    private fun render() {
        pairSection.visibility = if (prefs.paired) View.GONE else View.VISIBLE
        val owner = Kiosk.isDeviceOwner(this)
        val kiosk = Kiosk.isOn(this)
        setupSection.visibility = if (kiosk) View.GONE else View.VISIBLE
        repairButton.visibility = if (kiosk) View.GONE else View.VISIBLE
        kioskButton.visibility = if (owner) View.VISIBLE else View.GONE
        removeOwnerButton.visibility = if (owner && !kiosk) View.VISIBLE else View.GONE
        kioskButton.text = if (kiosk) "Unlock kiosk mode (PIN)" else "Turn on kiosk mode"
        kioskStatus.text = when {
            !owner -> "Not available: run setup-device.bat on a PC and answer Y to kiosk mode."
            kiosk -> "ON: this phone only runs Sarfli Agent. Other apps are frozen and notifications are blocked." +
                if (Kiosk.dndAllowed(this)) "" else " (Do Not Disturb not allowed: run setup-device.bat again.)"
            else -> "OFF: other apps can run and show notifications."
        }
        val sims = Telephony.activeSims(this)
        val (sms, res) = Store(this).counts()
        val pm = getSystemService(PowerManager::class.java)
        status.text = buildString {
            appendLine("Permissions:   ${if (Telephony.hasPermissions(this@MainActivity)) "OK" else "MISSING"}")
            appendLine("Battery opt.:  ${if (pm.isIgnoringBatteryOptimizations(packageName)) "disabled (good)" else "ON — tap step 2"}")
            val access = when {
                !UssdAccessibilityService.isEnabled(this@MainActivity) -> "OFF — tap step 3"
                !UssdAccessibilityService.isRunning() -> "ON but NOT RUNNING — tap step 3, turn it off then on again"
                else -> "ON (good)"
            }
            appendLine("Accessibility: $access")
            appendLine("Paired:        ${if (prefs.paired) "yes (${prefs.deviceName})" else "no"}")
            appendLine("Server:        ${prefs.serverUrl}")
            appendLine("Last sync:     ${if (prefs.lastSyncAt > 0) DateFormat.getTimeInstance().format(Date(prefs.lastSyncAt)) else "never"}")
            appendLine("Waiting:       $sms SMS, $res USSD results")
            if (prefs.lastError.isNotEmpty()) appendLine("Last error:    ${prefs.lastError}")
            appendLine()
            appendLine("SIMs:")
            if (sims.isEmpty()) appendLine("  none detected")
            sims.forEach { appendLine("  slot ${it.slotIndex + 1}: ${it.carrierName} (sub ${it.subscriptionId})") }
        }
    }
}
