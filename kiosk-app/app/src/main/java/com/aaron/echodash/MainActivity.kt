package com.aaron.echodash

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import android.graphics.Color
import android.net.http.SslError
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * Thin kiosk shell: fullscreen WebView pointed at the dashboard OpenClaw
 * serves on the Mac Mini. No app logic lives here beyond staying awake and
 * reconnecting when the LAN link drops. Launches on boot (see BootReceiver)
 * but is otherwise a normal app — Home/Back behave like they would for any
 * app, dropping to LineageOS's real launcher, by design.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var statusOverlay: LinearLayout
    private lateinit var statusText: TextView
    private lateinit var prefs: SharedPreferences

    private val handler = Handler(Looper.getMainLooper())
    private var retryDelayMs = INITIAL_RETRY_MS
    private var pendingRetry: Runnable? = null

    private val periodicReload = object : Runnable {
        override fun run() {
            webView.reload()
            handler.postDelayed(this, RELOAD_INTERVAL_MS)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        webView = findViewById(R.id.webView)
        statusOverlay = findViewById(R.id.statusOverlay)
        statusText = findViewById(R.id.statusText)

        setupWebView()

        // Long-press anywhere on the dashboard to change the target URL/token
        // — there's no other UI, this is the only settings screen. Registered
        // on both the WebView and the status overlay, since the overlay sits
        // on top and eats touches whenever the dashboard is unreachable —
        // which is exactly when you're most likely to need this dialog.
        val openConfig = View.OnLongClickListener {
            showConfigDialog()
            true
        }
        webView.setOnLongClickListener(openConfig)
        statusOverlay.setOnLongClickListener(openConfig)

        loadDashboard()
        handler.postDelayed(periodicReload, RELOAD_INTERVAL_MS)
    }

    override fun onResume() {
        super.onResume()
        applyImmersiveMode()
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) applyImmersiveMode()
    }

    private fun applyImmersiveMode() {
        // The old View.SYSTEM_UI_FLAG_* immersive flags (deprecated since API
        // 30 — LineageOS 18.1 here is exactly API 30) don't reliably reclaim
        // the full gesture-nav area on real hardware, even though they
        // appeared to work in the emulator: dumpsys on the real device showed
        // the app window getting 1280x736 instead of the full 1280x800,
        // which cascaded into dashboard-web's layout getting clipped.
        // WindowInsetsController is the modern replacement.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.cacheMode = WebSettings.LOAD_NO_CACHE
        webView.settings.loadWithOverviewMode = true
        webView.settings.useWideViewPort = true
        webView.setBackgroundColor(Color.BLACK)

        // Without this, WebView maps CSS pixels to density-independent pixels
        // rather than physical pixels — on this device's 213dpi panel (vs the
        // 160dpi baseline), that scaled the whole 1280x800 layout up by
        // ~1.33x, pushing about a quarter of the canvas off the right and
        // bottom edges. Forcing initial scale to 100/density undoes that, so
        // 1 CSS px in dashboard-web actually equals 1 physical pixel here.
        val density = resources.displayMetrics.density
        webView.setInitialScale((100 / density).toInt())

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                showConnected()
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame != false) scheduleRetry()
            }

            override fun onReceivedSslError(
                view: WebView?,
                handler: SslErrorHandler?,
                error: SslError?
            ) {
                // LAN-only; a self-signed or hostname-mismatched local cert is
                // expected here, not a real MITM risk on this network.
                handler?.proceed()
            }
        }
    }

    private fun showConfigDialog() {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 24, 48, 0)
        }
        val urlInput = EditText(this).apply {
            hint = "Dashboard URL (e.g. http://mac-mini.local:8080)"
            setText(prefs.getString(KEY_URL, DEFAULT_URL))
        }
        val tokenInput = EditText(this).apply {
            hint = "Shared token"
            setText(prefs.getString(KEY_TOKEN, ""))
        }
        container.addView(urlInput)
        container.addView(tokenInput)

        AlertDialog.Builder(this)
            .setTitle("Dashboard connection")
            .setView(container)
            .setPositiveButton("Save") { _, _ ->
                prefs.edit()
                    .putString(KEY_URL, urlInput.text.toString().trim())
                    .putString(KEY_TOKEN, tokenInput.text.toString().trim())
                    .apply()
                loadDashboard()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun loadDashboard() {
        val baseUrl = prefs.getString(KEY_URL, DEFAULT_URL) ?: DEFAULT_URL
        val token = prefs.getString(KEY_TOKEN, "") ?: ""
        val separator = if (baseUrl.contains("?")) "&" else "?"
        val url = if (token.isNotEmpty()) "$baseUrl${separator}token=$token" else baseUrl
        webView.loadUrl(url)
    }

    private fun scheduleRetry() {
        showReconnecting()
        pendingRetry?.let { handler.removeCallbacks(it) }
        val retry = Runnable { loadDashboard() }
        pendingRetry = retry
        handler.postDelayed(retry, retryDelayMs)
        retryDelayMs = (retryDelayMs * 2).coerceAtMost(MAX_RETRY_MS)
    }

    private fun showReconnecting() {
        statusText.text = "Reconnecting to Mac Mini…"
        statusOverlay.visibility = View.VISIBLE
    }

    private fun showConnected() {
        retryDelayMs = INITIAL_RETRY_MS
        statusOverlay.visibility = View.GONE
    }

    companion object {
        private const val PREFS_NAME = "kiosk_prefs"
        private const val KEY_URL = "dashboard_url"
        private const val KEY_TOKEN = "dashboard_token"
        private const val DEFAULT_URL = "http://192.168.1.138:18795"
        private const val INITIAL_RETRY_MS = 5_000L
        private const val MAX_RETRY_MS = 60_000L
        private const val RELOAD_INTERVAL_MS = 30 * 60_000L // full reload every 30 min
    }
}
