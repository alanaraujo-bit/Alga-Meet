package app.alga.admin

import android.app.Application
import android.content.Context
import app.alga.admin.data.Api
import app.alga.admin.data.Session
import app.alga.admin.push.Notifier
import app.alga.admin.push.Push
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow

class App : Application() {
    lateinit var session: Session
        private set
    lateinit var api: Api
        private set

    /** "Something happened, refresh what is on screen" (a push or a stream event arrived). */
    val bus = MutableSharedFlow<Unit>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    override fun onCreate() {
        super.onCreate()
        session = Session(this)
        api = Api(session)
        Notifier.createChannels(this)
        if (session.token != null) {
            Push.scheduleHealthCheck(this)
            if (session.onCall) runCatching { Push.setOnCall(this, true) }
        }
    }

    companion object {
        fun get(context: Context) = context.applicationContext as App
    }
}
