package app.alga.admin.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Where the app keeps its session. The bearer token is encrypted with an AES-GCM key that lives in the Android
 * Keystore (never exportable), so a copy of the app's files is not a copy of the session. No cloud backup either
 * (res/xml/data_extraction_rules.xml).
 */
class Session(context: Context) {
    private val prefs = context.getSharedPreferences("session", Context.MODE_PRIVATE)

    var server: String
        get() = prefs.getString("server", Servers.QA_USB) ?: Servers.QA_USB
        set(v) = prefs.edit().putString("server", v.trimEnd('/')).apply()

    var token: String?
        get() = prefs.getString("token", null)?.let { runCatching { decrypt(it) }.getOrNull() }
        set(v) = prefs.edit().apply { if (v == null) remove("token") else putString("token", encrypt(v)) }.apply()

    /** FCM token or the stream id registered with the server under this session. */
    var deviceToken: String?
        get() = prefs.getString("device", null)
        set(v) = prefs.edit().putString("device", v).apply()

    var mutedKinds: Set<String>
        get() = prefs.getStringSet("muted", emptySet()) ?: emptySet()
        set(v) = prefs.edit().putStringSet("muted", v).apply()

    var biometricLock: Boolean
        get() = prefs.getBoolean("biometric", true)
        set(v) = prefs.edit().putBoolean("biometric", v).apply()

    var onCall: Boolean
        get() = prefs.getBoolean("on_call", false)
        set(v) = prefs.edit().putBoolean("on_call", v).apply()

    fun clear() {
        prefs.edit().remove("token").remove("device").putBoolean("on_call", false).apply()
    }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    private fun encrypt(plain: String): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val out = c.iv + c.doFinal(plain.toByteArray())
        return Base64.encodeToString(out, Base64.NO_WRAP)
    }

    private fun decrypt(stored: String): String {
        val raw = Base64.decode(stored, Base64.NO_WRAP)
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw, 0, 12)) }
        return String(c.doFinal(raw, 12, raw.size - 12))
    }

    private companion object { const val ALIAS = "alga-admin-session" }
}

object Servers {
    /** The QA stack on the owner's PC, reached through "adb reverse tcp:4340 tcp:4340". */
    const val QA_USB = "http://127.0.0.1:4340"
    const val PRODUCTION = "https://api.algameet.com"
}
