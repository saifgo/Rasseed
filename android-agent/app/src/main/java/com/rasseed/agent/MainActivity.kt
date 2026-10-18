package com.rasseed.agent

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
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
import java.text.DateFormat
import java.util.Date
import kotlin.concurrent.thread

/** One-screen setup: permissions, battery exemption, pairing, and live status. */
class MainActivity : Activity() {
    private lateinit var prefs: Prefs
    private lateinit var status: TextView
    private lateinit var serverInput: EditText
    private lateinit var codeInput: EditText
    private lateinit var pairSection: LinearLayout
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

        root.addView(button("1. Grant SMS & phone permissions") { requestPermissions() })
        root.addView(button("2. Allow running in background (battery)") { requestBatteryExemption() })
        root.addView(button("3. Enable balance reading (Accessibility)") {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        })
        root.addView(TextView(this).apply {
            text = "Needed when the operator's balance code shows a popup/menu (e.g. Orange *101#). " +
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
        root.addView(button("Re-pair this phone") {
            prefs.token = null
            render()
        })
        setContentView(ScrollView(this).apply { addView(root) })

        if (prefs.paired) AgentService.start(this)
    }

    override fun onResume() {
        super.onResume()
        handler.post(refresh)
    }

    override fun onPause() {
        handler.removeCallbacks(refresh)
        super.onPause()
    }

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
        val sims = Telephony.activeSims(this)
        val (sms, res) = Store(this).counts()
        val pm = getSystemService(PowerManager::class.java)
        status.text = buildString {
            appendLine("Permissions:   ${if (Telephony.hasPermissions(this@MainActivity)) "OK" else "MISSING"}")
            appendLine("Battery opt.:  ${if (pm.isIgnoringBatteryOptimizations(packageName)) "disabled (good)" else "ON — tap step 2"}")
            appendLine("Accessibility: ${if (UssdAccessibilityService.isEnabled(this@MainActivity)) "ON (good)" else "OFF — tap step 3"}")
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
