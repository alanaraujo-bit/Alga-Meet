package app.alga.admin.data

import android.os.Build
import app.alga.admin.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

class ApiException(val status: Int, val code: String?, message: String) : IOException(message)

/** The admin API (packages/shared/src/admin.ts) over OkHttp. One instance per process (App.api). */
class Api(private val session: Session) {
    val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }
    private val userAgent = "AlgaAdmin/${BuildConfig.VERSION_NAME} (Android ${Build.VERSION.RELEASE})"
    private val http = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()
    private val streamHttp = http.newBuilder().readTimeout(0, TimeUnit.SECONDS).build()
    private val jsonType = "application/json".toMediaType()

    private fun request(path: String, token: String? = session.token): Request.Builder =
        Request.Builder().url("${session.server}/api/v1$path").header("User-Agent", userAgent)
            .apply { if (token != null) header("Authorization", "Bearer $token") }

    private suspend fun call(req: Request): String = withContext(Dispatchers.IO) {
        http.newCall(req).execute().use { res -> body(res) }
    }

    private fun body(res: Response): String {
        val text = res.body?.string().orEmpty()
        if (!res.isSuccessful) {
            val err = runCatching { json.decodeFromString<ApiErrorBody>(text).error }.getOrNull()
            throw ApiException(res.code, err?.code, err?.message ?: "Erro ${res.code}")
        }
        return text
    }

    private suspend inline fun <reified T> get(path: String): T = json.decodeFromString(call(request(path).get().build()))
    private suspend inline fun <reified B, reified T> post(path: String, body: B): T =
        json.decodeFromString(call(request(path).post(json.encodeToString(body).toRequestBody(jsonType)).build()))

    suspend fun login(server: String, login: String, password: String): String {
        session.server = server
        val req = request("/auth/login", token = null).post(json.encodeToString(LoginBody(login, password)).toRequestBody(jsonType)).build()
        return json.decodeFromString<AuthResponse>(call(req)).token
    }

    suspend fun logout() = runCatching { call(request("/auth/logout").post(ByteArray(0).toRequestBody()).build()) }

    suspend fun me(): AdminMe = get("/admin/me")
    suspend fun overview(period: String): Overview = get("/admin/overview?period=$period")
    suspend fun growth(days: Int): Growth = get("/admin/growth?days=$days")
    suspend fun health(): Health = get("/admin/health")
    suspend fun events(before: String? = null): List<AdminEvent> = get("/admin/events?limit=60" + (before?.let { "&before=${enc(it)}" } ?: ""))
    suspend fun search(q: String): List<UserSummary> = get("/admin/users/search?q=${enc(q)}")
    suspend fun user(id: String): UserDetail = get("/admin/users/$id")
    suspend fun feedback(): List<Feedback> = get("/admin/feedback?limit=40")
    suspend fun registerDevice(token: String, kinds: List<String>?) { call(request("/admin/devices").post(json.encodeToString(DeviceBody(token, kinds = kinds)).toRequestBody(jsonType)).build()) }
    suspend fun testPush(): TestResult = post("/admin/devices/test", emptyMap<String, String>())
    suspend fun accountAction(userId: String, body: AccountActionBody) { call(request("/admin/users/$userId/actions").post(json.encodeToString(body).toRequestBody(jsonType)).build()) }

    /** Plain liveness, no auth (the API answers /health even when the database is slow). */
    suspend fun ping(): Boolean = withContext(Dispatchers.IO) {
        runCatching { http.newCall(request("/health", token = null).get().build()).execute().use { it.isSuccessful } }.getOrDefault(false)
    }

    /** GET /admin/stream: every AdminEvent as it happens. Close the returned source to stop. */
    fun stream(onEvent: (AdminEvent) -> Unit, onState: (open: Boolean, error: Throwable?) -> Unit): EventSource =
        EventSources.createFactory(streamHttp).newEventSource(
            request("/admin/stream").header("Accept", "text/event-stream").get().build(),
            object : EventSourceListener() {
                override fun onOpen(eventSource: EventSource, response: Response) = onState(true, null)
                override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                    if (type == "alert") runCatching { json.decodeFromString<AdminEvent>(data) }.onSuccess(onEvent)
                }
                override fun onClosed(eventSource: EventSource) = onState(false, null)
                override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) =
                    onState(false, t ?: response?.let { ApiException(it.code, null, "stream ${it.code}") })
            },
        )

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
}
