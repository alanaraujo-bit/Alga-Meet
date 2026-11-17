package app.alga.admin.push

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.NotificationCompat
import app.alga.admin.App
import app.alga.admin.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.sse.EventSource

/**
 * "Modo plantão": a foreground service holding GET /admin/stream open, so events arrive at once without FCM (or as a
 * second path next to it). Reconnects with backoff up to 60 s. Costs a fixed, silent notification and some battery.
 */
class StreamService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var source: EventSource? = null
    private var backoffMs = 1000L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val n = NotificationCompat.Builder(this, "service")
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Modo plantão ligado")
            .setContentText("Conectado ao Alga Meet para avisar na hora.")
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(Notifier.openIntent(this, null))
            .build()
        startForeground(7, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING)
        if (source == null) connect()
        return START_STICKY
    }

    private fun connect() {
        val app = App.get(this)
        if (app.session.token == null || !app.session.onCall) { stopSelf(); return }
        source = app.api.stream(
            onEvent = { e ->
                Notifier.show(this, e.id, e.kind, e.title, e.body)
                app.bus.tryEmit(Unit)
            },
            onState = { open, _ ->
                if (open) backoffMs = 1000L
                else {
                    source = null
                    scope.launch {
                        delay(backoffMs)
                        backoffMs = (backoffMs * 2).coerceAtMost(60_000L)
                        connect()
                    }
                }
            },
        )
    }

    override fun onDestroy() {
        source?.cancel()
        scope.cancel()
        super.onDestroy()
    }
}
