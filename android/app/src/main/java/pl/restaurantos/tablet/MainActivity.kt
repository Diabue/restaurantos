package pl.restaurantos.tablet

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.app.admin.DevicePolicyManager
import android.content.ActivityNotFoundException
import android.content.ContentResolver
import android.content.ContentValues
import android.content.Intent
import android.content.RestrictionsManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.util.Base64
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {
    private lateinit var browser: WebView
    private lateinit var offline: LinearLayout
    private lateinit var settingsButton: Button
    private val preferences by lazy { getSharedPreferences("tablet", MODE_PRIVATE) }
    private val restrictions by lazy { getSystemService(RestrictionsManager::class.java) }
    private val policies by lazy { getSystemService(DevicePolicyManager::class.java) }
    private var origin: Uri? = null
    private var startPage: Uri? = null
    private var photoChooser: ValueCallback<Array<Uri>>? = null
    private val photoRequestCode = 8

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = FrameLayout(this).apply { setBackgroundColor(0xfff8fafc.toInt()) }
        if (Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener { view, insets ->
                val bars = insets.getInsets(WindowInsets.Type.systemBars())
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                insets
            }
        }
        browser = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.setSupportMultipleWindows(false)
            setDownloadListener { url, _, _, _, _ -> saveDownload(url) }
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                    if (!sameOrigin(Uri.parse(view.url.orEmpty()))) return false
                    photoChooser?.onReceiveValue(null)
                    photoChooser = callback
                    val picker = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "image/*"
                        putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/jpeg", "image/png", "image/webp"))
                    }
                    try {
                        startActivityForResult(picker, photoRequestCode)
                    } catch (_: ActivityNotFoundException) {
                        photoChooser = null
                        callback.onReceiveValue(null)
                        Toast.makeText(this@MainActivity, "Wybór plików jest niedostępny.", Toast.LENGTH_SHORT).show()
                    }
                    return true
                }
            }
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    return request.isForMainFrame && !sameOrigin(request.url)
                }

                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (request.isForMainFrame) showOffline()
                }

                override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: android.webkit.WebResourceResponse) {
                    if (request.isForMainFrame && response.statusCode >= 400) showOffline()
                }
            }
        }
        offline = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = android.view.Gravity.CENTER
            setPadding(24, 24, 24, 24)
            setBackgroundColor(0xfff8fafc.toInt())
            addView(TextView(this@MainActivity).apply {
                text = "RestaurantOS\nSprawdź połączenie z serwerem."
                textSize = 21f
                gravity = android.view.Gravity.CENTER
                setPadding(0, 0, 0, 18)
            })
            addView(Button(this@MainActivity).apply {
                text = "Spróbuj ponownie"
                setOnClickListener { loadStation(force = true) }
            })
            settingsButton = Button(this@MainActivity).apply {
                text = "Adres serwera"
                setOnClickListener { configure() }
            }
            addView(settingsButton)
        }
        root.addView(browser, FrameLayout.LayoutParams(-1, -1))
        root.addView(offline, FrameLayout.LayoutParams(-1, -1))
        setContentView(root)
        loadStation()
    }

    @Deprecated("Activity result callback for the WebView photo picker")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != photoRequestCode) return
        val selected = data?.data?.takeIf { resultCode == RESULT_OK && it.scheme == ContentResolver.SCHEME_CONTENT }
        photoChooser?.onReceiveValue(selected?.let { arrayOf(it) })
        photoChooser = null
    }

    override fun onDestroy() {
        photoChooser?.onReceiveValue(null)
        photoChooser = null
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        loadStation()
        if (policies.isLockTaskPermitted(packageName)) {
            startLockTask()
            if (Build.VERSION.SDK_INT >= 30) {
                window.insetsController?.apply {
                    systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    hide(WindowInsets.Type.systemBars())
                }
            }
        }
    }

    private fun loadStation(force: Boolean = false) {
        // Migrate existing test installations once; later manual settings persist.
        if (!preferences.getBoolean("cloud_default_applied", false)) {
            preferences.edit().putString("server_url", BuildConfig.DEFAULT_SERVER)
                .putBoolean("cloud_default_applied", true).apply()
        }
        val managed = restrictions.applicationRestrictions
        val configured = managed.getString("server_url")?.takeIf { it.isNotBlank() }
        settingsButton.visibility = if (configured != null || policies.isLockTaskPermitted(packageName)) View.GONE else View.VISIBLE
        val address = configured ?: preferences.getString("server_url", null) ?: BuildConfig.DEFAULT_SERVER
        val base = validOrigin(address)
        if (base == null) {
            showOffline()
            return
        }
        val page = base.buildUpon().path("/staff")
        val mode = managed.getString("mode")
        if (mode in listOf("WAITER", "KITCHEN", "MANAGER")) page.appendQueryParameter("mode", mode)
        managed.getString("venue")?.takeIf { it.isNotBlank() }?.let { page.appendQueryParameter("venue", it) }
        val target = page.build()
        if (force || target != startPage) {
            origin = base
            startPage = target
            offline.visibility = View.GONE
            browser.loadUrl(target.toString())
        }
    }

    private fun validOrigin(value: String): Uri? {
        val uri = Uri.parse(value.trim())
        if (uri.host.isNullOrBlank() || uri.userInfo != null || uri.scheme !in listOf("http", "https")) return null
        if (!BuildConfig.DEBUG && uri.scheme != "https") return null
        return Uri.Builder().scheme(uri.scheme).encodedAuthority(uri.encodedAuthority).build()
    }

    private fun sameOrigin(uri: Uri): Boolean {
        val configured = origin ?: return false
        return uri.scheme == configured.scheme && uri.host == configured.host && uri.port == configured.port
    }

    private fun showOffline() {
        offline.visibility = View.VISIBLE
    }

    private fun configure() {
        val field = EditText(this).apply {
            setSingleLine()
            setText(preferences.getString("server_url", BuildConfig.DEFAULT_SERVER))
            hint = "https://adres-lokalu"
        }
        val dialog = AlertDialog.Builder(this).setTitle("Adres serwera RestaurantOS").setView(field)
            .setNegativeButton("Anuluj", null).setPositiveButton("Zapisz", null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val value = validOrigin(field.text.toString())
                if (value == null) {
                    field.error = "Podaj poprawny adres serwera."
                    return@setOnClickListener
                }
                preferences.edit().putString("server_url", value.toString()).apply()
                dialog.dismiss()
                loadStation(force = true)
            }
        }
        dialog.show()
    }

    private fun saveDownload(url: String) {
        val prefix = url.substringBefore(',', "")
        val csv = prefix == "data:text/csv;charset=utf-8;base64"
        if (!csv && prefix != "data:image/png;base64") return
        if (!sameOrigin(Uri.parse(browser.url.orEmpty()))) return
        val payload = url.substringAfter(',')
        if (payload.length > (if (csv) 12_000_000 else 350_000)) {
            Toast.makeText(this, "Plik jest za duży do pobrania.", Toast.LENGTH_SHORT).show()
            return
        }
        val bytes = try { Base64.decode(payload, Base64.DEFAULT) } catch (_: IllegalArgumentException) { return }
        val name = if (csv) {
            val header = String(bytes, 0, minOf(100, bytes.size), Charsets.UTF_8).substringBefore('\n')
            val day = Regex("""\d{4}-\d{2}-\d{2}""").find(header)?.value ?: System.currentTimeMillis().toString()
            "RestaurantOS-sprzedaz-$day.csv"
        } else "RestaurantOS-QR-${System.currentTimeMillis()}.png"
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.MIME_TYPE, if (csv) "text/csv" else "image/png")
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val target = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return
        try {
            contentResolver.openOutputStream(target)?.use { it.write(bytes) }
                ?: error("Brak strumienia zapisu")
            contentResolver.update(target, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
            Toast.makeText(this, "Zapisano w Pobranych: $name", Toast.LENGTH_SHORT).show()
        } catch (_: Exception) {
            contentResolver.delete(target, null, null)
            Toast.makeText(this, "Nie udało się zapisać pliku.", Toast.LENGTH_SHORT).show()
        }
    }
}
