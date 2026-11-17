package app.alga.admin.push

import android.content.Context
import android.content.Intent
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import app.alga.admin.App
import app.alga.admin.BuildConfig
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.tasks.await
import java.util.concurrent.TimeUnit

/** Which kinds exist (packages/shared/src/admin.ts ADMIN_EVENT_KINDS) and how the phone registers for them. */
object Push {
    val kinds = listOf(
        "purchase" to "Compras", "subscription_started" to "Assinaturas novas", "subscription_renewed" to "Renovações",
        "refund" to "Reembolsos", "payment_failed" to "Pagamentos recusados", "signup" to "Cadastros",
        "report" to "Denúncias urgentes", "report_spike" to "Picos de denúncias",
        "sfu_down" to "Voz fora do ar", "sfu_up" to "Voz de volta", "api_errors" to "Erros na API",
    )
    val moneyKinds = setOf("purchase", "subscription_started", "subscription_renewed", "refund", "payment_failed")

    fun firebaseReady(context: Context) = BuildConfig.HAS_FIREBASE && FirebaseApp.getApps(context).isNotEmpty()

    /** Registers this phone (FCM token) for the kinds not muted; no-op without Firebase. */
    suspend fun register(app: App, fcmToken: String? = null): Boolean {
        if (!firebaseReady(app)) return false
        val token = fcmToken ?: FirebaseMessaging.getInstance().token.await()
        val muted = app.session.mutedKinds
        app.api.registerDevice(token, if (muted.isEmpty()) null else kinds.map { it.first }.filter { it !in muted })
        app.session.deviceToken = token
        return true
    }

    fun setOnCall(context: Context, on: Boolean) {
        App.get(context).session.onCall = on
        val i = Intent(context, StreamService::class.java)
        if (on) context.startForegroundService(i) else context.stopService(i)
    }

    /** API down shows up within ~15 min even with the app closed (FCM cannot tell you the API itself is gone). */
    fun scheduleHealthCheck(context: Context) {
        val req = PeriodicWorkRequestBuilder<HealthWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("api-health", ExistingPeriodicWorkPolicy.KEEP, req)
    }

    fun cancelHealthCheck(context: Context) = WorkManager.getInstance(context).cancelUniqueWork("api-health")
}
