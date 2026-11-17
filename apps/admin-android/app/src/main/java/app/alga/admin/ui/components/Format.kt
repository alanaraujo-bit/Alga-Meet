package app.alga.admin.ui.components

import java.text.NumberFormat
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Currency
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToLong

/** Every number and date the app shows, in pt-BR and BRT. */
object Fmt {
    val locale: Locale = Locale.forLanguageTag("pt-BR")
    val zone: ZoneId = ZoneId.of("America/Sao_Paulo")

    private fun currency(code: String) = NumberFormat.getCurrencyInstance(locale).apply { this.currency = Currency.getInstance(code) }
    private val int = NumberFormat.getIntegerInstance(locale)
    private val dec1 = NumberFormat.getNumberInstance(locale).apply { maximumFractionDigits = 1; minimumFractionDigits = 1 }

    /** R$ 1.234,56 (no-break space replaced: it renders wider than the design wants). */
    fun money(cents: Long, code: String = "BRL"): String = currency(code).format(cents / 100.0).replace(' ', ' ')

    /** Whole reais when the value is large (R$ 12.345), cents below R$ 1.000. */
    fun moneyShort(cents: Long, code: String = "BRL"): String =
        if (abs(cents) >= 100_000) currency(code).apply { maximumFractionDigits = 0; minimumFractionDigits = 0 }.format(cents / 100.0).replace(' ', ' ')
        else money(cents, code)

    /** Axis labels: R$ 1,2 mil. */
    fun moneyAxis(cents: Double): String {
        val r = cents / 100
        return when {
            abs(r) >= 1_000_000 -> "R$ ${dec1.format(r / 1_000_000)} mi"
            abs(r) >= 1_000 -> "R$ ${dec1.format(r / 1_000)} mil"
            else -> "R$ ${int.format(r.roundToLong())}"
        }
    }

    fun int(n: Number): String = int.format(n)
    fun compact(n: Double): String = when {
        abs(n) >= 1_000_000 -> "${dec1.format(n / 1_000_000)} mi"
        abs(n) >= 10_000 -> "${dec1.format(n / 1_000)} mil"
        else -> int.format(n.roundToLong())
    }
    fun pct(r: Double?, digits: Int = 1): String = if (r == null) "—" else NumberFormat.getPercentInstance(locale).apply {
        maximumFractionDigits = digits; minimumFractionDigits = if (digits > 0 && r < 0.1) digits else 0
    }.format(r)

    /** +12,4 % / −3,0 % against the previous period; null when there is nothing to compare with. */
    fun delta(now: Long, before: Long): Pair<String, Int>? {
        if (before == 0L) return if (now == 0L) null else "novo" to 1
        val d = (now - before).toDouble() / abs(before)
        val sign = if (d > 0) "+" else if (d < 0) "−" else ""
        return "$sign${dec1.format(abs(d) * 100)}%" to d.compareTo(0.0)
    }

    fun minutes(min: Long): String = when {
        min >= 60 * 24 * 10 -> "${int.format(min / 60)} h"
        min >= 60 -> "${min / 60} h ${min % 60} min"
        else -> "$min min"
    }

    fun bytes(b: Long): String = if (b >= 1 shl 30) "${dec1.format(b / 1073741824.0)} GB" else "${int.format(b / 1048576)} MB"

    fun uptime(s: Long): String = when {
        s >= 86400 -> "${s / 86400} d ${s % 86400 / 3600} h"
        s >= 3600 -> "${s / 3600} h ${s % 3600 / 60} min"
        else -> "${s / 60} min"
    }

    fun instant(iso: String): Instant = Instant.parse(iso)

    private val dayMonth = DateTimeFormatter.ofPattern("d MMM", locale)
    private val dayMonthYear = DateTimeFormatter.ofPattern("d MMM yyyy", locale)
    private val time = DateTimeFormatter.ofPattern("HH:mm", locale)
    private val weekday = DateTimeFormatter.ofPattern("EEEE, d 'de' MMMM", locale)
    private val monthName = DateTimeFormatter.ofPattern("MMM yyyy", locale)

    fun date(iso: String?): String = iso?.let { instant(it).atZone(zone).format(dayMonthYear).replace(".", "") } ?: "—"
    fun dateTime(iso: String?): String = iso?.let { val z = instant(it).atZone(zone); "${z.format(dayMonth).replace(".", "")} às ${z.format(time)}" } ?: "—"
    fun clock(iso: String): String = instant(iso).atZone(zone).format(time)

    fun ago(iso: String?, now: Instant = Instant.now()): String {
        if (iso == null) return "—"
        val d = Duration.between(instant(iso), now)
        return when {
            d.toMinutes() < 1 -> "agora"
            d.toMinutes() < 60 -> "há ${d.toMinutes()} min"
            d.toHours() < 24 -> "há ${d.toHours()} h"
            d.toDays() < 7 -> "há ${d.toDays()} d"
            else -> date(iso)
        }
    }

    /** Section header of a feed day: "Hoje", "Ontem" or "segunda-feira, 16 de novembro". */
    fun dayHeader(iso: String): String {
        val day = instant(iso).atZone(zone).toLocalDate()
        val today = LocalDate.now(zone)
        return when (day) {
            today -> "Hoje"
            today.minusDays(1) -> "Ontem"
            else -> day.format(weekday).replaceFirstChar { it.uppercase() }
        }
    }
    fun dayKey(iso: String): LocalDate = instant(iso).atZone(zone).toLocalDate()

    /** Chart bucket keys from the API ('2026-11-16', '2026-11-16T14', '2026-11') as short labels. */
    fun bucket(t: String): String = when (t.length) {
        7 -> LocalDate.parse("$t-01").format(monthName).replace(".", "")
        10 -> LocalDate.parse(t).format(dayMonth).replace(".", "")
        13 -> "${t.substring(11, 13)}h"
        else -> t
    }
    fun bucketLong(t: String): String = when (t.length) {
        10 -> LocalDate.parse(t).format(DateTimeFormatter.ofPattern("EEE, d MMM", locale)).replace(".", "")
        13 -> "${bucket(t.substring(0, 10))}, ${t.substring(11, 13)}h"
        else -> bucket(t)
    }
}
