package app.alga.admin.data

import kotlinx.serialization.Serializable

// Mirror of packages/shared/src/admin.ts (the server is the source of truth; unknown fields are ignored).

@Serializable data class Money(val brl: Long = 0, val usd: Long = 0)
@Serializable data class Point(val t: String, val value: Double)
@Serializable data class PersonRef(val id: String, val username: String, val displayName: String)

@Serializable
data class AdminMe(
    val id: String, val username: String, val displayName: String, val role: String, val env: String,
    val version: String, val push: Push,
) {
    @Serializable data class Push(val fcm: Boolean)
    val isAdmin get() = role == "admin"
}

@Serializable
data class LoginBody(val login: String, val password: String)

@Serializable
data class AuthResponse(val token: String)

@Serializable
data class ResetBody(val token: String, val password: String)

@Serializable
data class Purchase(
    val id: String, val kind: String, val at: String, val amountCents: Long, val currency: String, val productId: String,
    val productName: String, val provider: String, val gift: Boolean, val user: PersonRef? = null,
)

@Serializable
data class Overview(
    val period: String, val from: String, val to: String, val received: Received, val series: List<Point>, val bucket: String,
    val mrr: Mrr, val subscribers: Subscribers, val conversion: Conversion, val byProduct: List<ByProduct>,
    val latest: List<Purchase>, val funnel: Funnel,
) {
    @Serializable data class Received(val gross: Money, val refunds: Money, val net: Money, val previousNet: Money, val charges: Int, val refundCount: Int)
    @Serializable data class Mrr(val now: Money, val atRisk: Money, val atRiskCount: Int, val series: List<Point>)
    @Serializable data class Subscribers(
        val plus: Int, val renewing: Int, val period: Int, val pass: Int, val newInPeriod: Int, val churnedInPeriod: Int, val churn30d: Double? = null,
    )
    @Serializable data class Conversion(
        val mau: Int, val plusRate: Double? = null, val payers: Int, val payerRate: Double? = null, val arppuCents: Long? = null, val refundRate: Double? = null,
    )
    @Serializable data class ByProduct(val productId: String, val name: String, val kind: String, val net: Money, val count: Int)
    @Serializable data class Funnel(val since: String, val shopOpen: Int, val tryOn: Int, val checkout: Int, val giftCheckout: Int)
}

@Serializable
data class Growth(
    val days: Int, val users: Users, val signups: Signups, val active: Active, val voice: Voice, val messages: Messages,
    val spaces: Spaces, val activation: Activation, val cohorts: List<Cohort>, val northStar: List<NorthStar>,
    val uninstall: Uninstall, val notTracked: List<String>,
) {
    @Serializable data class Users(val total: Int, val verified: Int, val pendingDeletion: Int, val staff: Int, val restricted: Int)
    @Serializable data class Signups(val inPeriod: Int, val previous: Int, val series: List<Point>)
    @Serializable data class Active(
        val dau: Int, val wau: Int, val mau: Int, val stickiness: Double? = null, val series: List<Point>, val messaging30d: Int, val voice30d: Int,
    )
    @Serializable data class Voice(
        val minutesInPeriod: Long, val people: Int, val minutesPerPerson: Long? = null, val medianSessionMin: Double? = null,
        val perDay: List<Point>, val weekly: List<Week>,
    ) { @Serializable data class Week(val week: String, val minutes: Long, val people: Int) }
    @Serializable data class Messages(val inPeriod: Int, val perDay: List<Point>)
    @Serializable data class Spaces(val total: Int, val newInPeriod: Int)
    @Serializable data class Activation(val cohort: Int, val activated: Int, val rate: Double? = null)
    @Serializable data class Cohort(val week: String, val size: Int, val weeks: List<Double?>)
    @Serializable data class NorthStar(val week: String, val value: Int? = null)
    @Serializable data class Uninstall(val total: Int, val byReason: List<Reason>) { @Serializable data class Reason(val reason: String, val count: Int) }
}

@Serializable
data class Health(
    val at: String, val version: String, val env: String, val uptimeS: Long, val live: Live, val process: Proc, val sfu: Sfu,
    val api: Api, val quality: Quality, val versions: List<Version>, val moderation: Moderation, val jobs: List<Job>, val counters: Counters,
) {
    @Serializable data class Live(val online: Int, val sockets: Int, val inVoice: Int, val voiceRooms: Int, val cinemaSeats: Int)
    @Serializable data class Proc(val rssBytes: Long, val heapUsedBytes: Long)
    @Serializable data class Sfu(val ok: Boolean? = null, val latencyMs: Long? = null, val checkedAt: String? = null, val downSince: String? = null)
    @Serializable data class Api(val errors5m: Int, val errors1h: Int, val rateLimited: Long)
    @Serializable data class Quality(
        val reports7d: Int, val joinP50Ms: Double? = null, val joinP95Ms: Double? = null, val rttP50Ms: Double? = null,
        val lossAvgPct: Double? = null, val reconnectFailRate: Double? = null, val byVersion: List<ByVersion>,
    ) { @Serializable data class ByVersion(val version: String, val reports: Int, val lossAvgPct: Double? = null) }
    @Serializable data class Version(val version: String, val os: String, val sessions: Int)
    @Serializable data class Moderation(val openReports: Int, val urgentReports: Int, val reports24h: Int, val openAppeals: Int, val quarantined: Int)
    @Serializable data class Job(val job: String, val period: String, val finishedAt: String? = null)
    @Serializable data class Counters(val billingWebhookErrors: Long, val emailFailures: Long, val livekitWebhookFailures: Long)
}

@Serializable
data class AdminEvent(
    val id: String, val kind: String, val title: String, val body: String, val amountCents: Long? = null, val currency: String? = null,
    val user: PersonRef? = null, val createdAt: String,
)

@Serializable
data class UserSummary(
    val id: String, val username: String, val displayName: String, val email: String, val plan: String, val createdAt: String,
    val staffRole: String? = null, val state: String,
)

@Serializable
data class UserDetail(
    val id: String, val username: String, val displayName: String, val email: String, val plan: String, val createdAt: String,
    val staffRole: String? = null, val state: String, val emailVerified: Boolean, val plusSince: String? = null,
    val lastSeenAt: String? = null, val suspendedUntil: String? = null, val bannedAt: String? = null, val legalHold: Boolean,
    val deletionPurgeAfter: String? = null, val ageBracket: String? = null, val counts: Counts, val sessions: List<SessionInfo>,
    val actions: List<Action>, val billing: Billing? = null,
) {
    @Serializable data class Counts(val spaces: Int, val friends: Int, val reportsAgainst: Int, val reportsBy: Int, val falseReports: Int)
    @Serializable data class SessionInfo(val id: String, val client: String? = null, val os: String? = null, val createdAt: String, val lastUsedAt: String)
    @Serializable data class Action(val id: String, val type: String, val reason: String, val until: String? = null, val createdAt: String, val note: String? = null)
    @Serializable data class Billing(val lifetime: Money, val subscriptions: List<Sub>, val orders: List<Order>) {
        @Serializable data class Sub(
            val id: String, val productId: String, val productName: String = productId, val kind: String, val status: String, val amountCents: Long, val currency: String,
            val provider: String, val startedAt: String? = null, val currentPeriodEnd: String? = null, val cancelAtPeriodEnd: Boolean,
        )
        @Serializable data class Order(
            val id: String, val productId: String, val productName: String = productId, val status: String, val amountCents: Long, val currency: String, val provider: String,
            val createdAt: String, val paidAt: String? = null, val gift: Boolean,
        )
    }
}

@Serializable
data class Feedback(val id: String, val kind: String, val text: String, val client: String? = null, val hasScreenshot: Boolean, val createdAt: String, val user: PersonRef)

@Serializable
data class DeviceBody(val token: String, val platform: String = "android", val kinds: List<String>? = null)

@Serializable
data class AccountActionBody(val type: String, val reason: String, val until: String? = null, val note: String? = null)

@Serializable
data class ApiErrorBody(val error: Err? = null) { @Serializable data class Err(val code: String? = null, val message: String? = null) }

@Serializable data class TestResult(val sent: Int)
