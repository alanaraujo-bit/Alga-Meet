package app.alga.admin.push

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import app.alga.admin.App

/** Every 15 min: two failed /health in a row = "API fora do ar"; the first success after that = "API de volta". */
class HealthWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = App.get(applicationContext)
        if (app.session.token == null) return Result.success()
        val prefs = applicationContext.getSharedPreferences("health", Context.MODE_PRIVATE)
        val fails = prefs.getInt("fails", 0)
        val ok = app.api.ping() || app.api.ping()
        if (ok) {
            if (fails >= 2) Notifier.show(applicationContext, "api-up-${System.currentTimeMillis()}", "sfu_up", "API de volta", "A API voltou a responder.")
            prefs.edit().putInt("fails", 0).apply()
        } else {
            if (fails + 1 == 2) Notifier.show(applicationContext, "api-down", "api_errors", "API fora do ar", "A API não respondeu em duas verificações seguidas (${app.session.server}).")
            prefs.edit().putInt("fails", fails + 1).apply()
        }
        return Result.success()
    }
}
