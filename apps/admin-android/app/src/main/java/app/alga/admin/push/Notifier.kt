package app.alga.admin.push

import android.app.NotificationChannel
import android.app.NotificationChannelGroup
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import app.alga.admin.MainActivity
import app.alga.admin.R

/**
 * Notification channels (the server names them in each FCM message: src/admin/alerts.ts CHANNELS) and the local
 * notifications shown by the stream service and the health check. A notification is tagged with its event id, so the
 * same event arriving through FCM and the stream shows once.
 */
object Notifier {
    data class Channel(val id: String, val name: String, val description: String, val importance: Int)

    val channels = listOf(
        Channel("money", "Vendas", "Compras, assinaturas novas e renovações.", NotificationManager.IMPORTANCE_HIGH),
        Channel("money_issues", "Problemas de pagamento", "Reembolsos e cobranças recusadas.", NotificationManager.IMPORTANCE_HIGH),
        Channel("growth", "Cadastros", "Cada conta nova.", NotificationManager.IMPORTANCE_DEFAULT),
        Channel("safety", "Denúncias", "Denúncias urgentes e picos de denúncias.", NotificationManager.IMPORTANCE_HIGH),
        Channel("infra", "Infraestrutura", "API e servidor de voz fora do ar ou com erros.", NotificationManager.IMPORTANCE_HIGH),
        Channel("service", "Modo plantão", "Aviso fixo enquanto o modo plantão mantém a conexão aberta.", NotificationManager.IMPORTANCE_MIN),
    )

    val channelOf = mapOf(
        "purchase" to "money", "subscription_started" to "money", "subscription_renewed" to "money", "test" to "money",
        "refund" to "money_issues", "payment_failed" to "money_issues", "signup" to "growth",
        "report" to "safety", "report_spike" to "safety", "sfu_down" to "infra", "sfu_up" to "infra", "api_errors" to "infra",
    )

    fun createChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannelGroup(NotificationChannelGroup("alga", "Alga Meet"))
        nm.createNotificationChannels(channels.map { c ->
            NotificationChannel(c.id, c.name, c.importance).apply { description = c.description; group = "alga" }
        })
    }

    fun openIntent(context: Context, eventId: String?): PendingIntent = PendingIntent.getActivity(
        context, eventId?.hashCode() ?: 0,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP).putExtra("tab", "alerts"),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    fun show(context: Context, eventId: String, kind: String, title: String, body: String) {
        val nm = NotificationManagerCompat.from(context)
        if (!nm.areNotificationsEnabled()) return
        val n = NotificationCompat.Builder(context, channelOf[kind] ?: "infra")
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(0xFF8B8EF7.toInt())
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setContentIntent(openIntent(context, eventId))
            .build()
        try {
            nm.notify(eventId, 1, n)
        } catch (_: SecurityException) {
            // POST_NOTIFICATIONS revoked: nothing to show.
        }
    }
}
