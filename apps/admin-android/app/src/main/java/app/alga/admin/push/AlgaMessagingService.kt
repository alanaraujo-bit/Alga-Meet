package app.alga.admin.push

import app.alga.admin.App
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * FCM. In the background Android shows the server's notification itself (channel from the message); here we get the
 * foreground case and token rotations.
 */
class AlgaMessagingService : FirebaseMessagingService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onMessageReceived(message: RemoteMessage) {
        val n = message.notification ?: return
        val kind = message.data["kind"] ?: "test"
        val id = message.data["eventId"] ?: message.messageId ?: kind
        Notifier.show(this, id, kind, n.title.orEmpty(), n.body.orEmpty())
        App.get(this).bus.tryEmit(Unit)
    }

    override fun onNewToken(token: String) {
        val app = App.get(this)
        if (app.session.token == null) return
        scope.launch { Push.register(app, token) }
    }
}
