package app.alga.admin

import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.compose.runtime.mutableStateOf
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import app.alga.admin.ui.AppRoot
import app.alga.admin.ui.theme.AlgaTheme

/**
 * One activity. The app locks behind the phone's biometrics (or its PIN) on start and after a minute in the
 * background: whoever picks up the unlocked phone does not get the company's numbers and the ban button.
 */
class MainActivity : FragmentActivity() {
    private val locked = mutableStateOf(false)
    private val openTab = mutableStateOf<String?>(null)
    private var backgroundAt = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        openTab.value = intent?.getStringExtra("tab")
        locked.value = needsLock()
        setContent {
            AlgaTheme {
                AppRoot(locked = locked.value, onUnlock = ::authenticate, openTab = openTab)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        openTab.value = intent.getStringExtra("tab")
    }

    override fun onStart() {
        super.onStart()
        if (backgroundAt != 0L && SystemClock.elapsedRealtime() - backgroundAt > 60_000 && needsLock()) locked.value = true
        if (locked.value) authenticate()
    }

    override fun onStop() {
        super.onStop()
        backgroundAt = SystemClock.elapsedRealtime()
    }

    private fun needsLock(): Boolean {
        val s = App.get(this).session
        return s.token != null && s.biometricLock &&
            BiometricManager.from(this).canAuthenticate(BIOMETRIC_STRONG or DEVICE_CREDENTIAL) == BiometricManager.BIOMETRIC_SUCCESS
    }

    private fun authenticate() {
        if (!locked.value) return
        val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { locked.value = false }
        })
        prompt.authenticate(
            BiometricPrompt.PromptInfo.Builder()
                .setTitle("Alga Admin")
                .setSubtitle("Confirme que é você")
                .setAllowedAuthenticators(BIOMETRIC_STRONG or DEVICE_CREDENTIAL)
                .build(),
        )
    }
}
