package app.alga.admin.ui.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.alga.admin.App
import app.alga.admin.data.Overview
import app.alga.admin.data.Purchase
import app.alga.admin.ui.LocalNav
import app.alga.admin.ui.Route
import app.alga.admin.ui.components.AreaChart
import app.alga.admin.ui.components.Avatar
import app.alga.admin.ui.components.Card
import app.alga.admin.ui.components.DeltaChip
import app.alga.admin.ui.components.ErrorCard
import app.alga.admin.ui.components.Fmt
import app.alga.admin.ui.components.KeyValue
import app.alga.admin.ui.components.Metric
import app.alga.admin.ui.components.MetricRow
import app.alga.admin.ui.components.Overline
import app.alga.admin.ui.components.SectionTitle
import app.alga.admin.ui.components.Segmented
import app.alga.admin.ui.components.ShareBar
import app.alga.admin.ui.components.Skeleton
import app.alga.admin.ui.components.Tag
import app.alga.admin.ui.components.pressable
import app.alga.admin.ui.components.rememberSelection
import app.alga.admin.ui.rememberLoaded
import app.alga.admin.ui.screenPadding
import app.alga.admin.ui.theme.Type
import app.alga.admin.ui.theme.palette
import androidx.compose.ui.platform.LocalContext

private val PERIODS = listOf("today" to "Hoje", "7d" to "7 dias", "30d" to "30 dias", "90d" to "90 dias", "12m" to "1 ano")
private val PERIOD_PHRASE = mapOf("today" to "hoje", "7d" to "nos últimos 7 dias", "30d" to "nos últimos 30 dias", "90d" to "nos últimos 90 dias", "12m" to "nos últimos 12 meses")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen() {
    val app = App.get(LocalContext.current)
    var period by rememberSaveable { mutableStateOf("30d") }
    val load = rememberLoaded("overview:$period", everyMs = 60_000) { app.api.overview(period) }
    val o = load.data
    PullToRefreshBox(isRefreshing = load.loading && o != null, onRefresh = load.refresh, modifier = Modifier.fillMaxSize()) {
        LazyColumn(contentPadding = screenPadding(), modifier = Modifier.fillMaxSize()) {
            item { Segmented(PERIODS, period, { period = it }, Modifier.fillMaxWidth().padding(bottom = 16.dp)) }
            if (o == null) {
                item { if (load.error != null) ErrorCard(load.error, load.refresh) else HomeSkeleton() }
                return@LazyColumn
            }
            if (load.error != null) item { Text("Mostrando os últimos dados: ${load.error}", style = Type.caption, color = palette.warn, modifier = Modifier.padding(bottom = 10.dp)) }
            item { Hero(o) }
            item { Kpis(o) }
            item { MrrCard(o) }
            item { SectionTitle("Últimas compras", trailing = "${o.received.charges} cobranças ${PERIOD_PHRASE[o.period]}") }
            item {
                Card(padding = 6.dp) {
                    if (o.latest.isEmpty()) Text("Nenhuma compra ainda.", style = Type.body, color = palette.text3, modifier = Modifier.padding(16.dp))
                    o.latest.take(12).forEachIndexed { i, pu -> PurchaseRow(pu, divider = i < minOf(12, o.latest.size) - 1) }
                }
            }
            if (o.byProduct.isNotEmpty()) {
                item { SectionTitle("Por produto", trailing = PERIOD_PHRASE[o.period]) }
                item {
                    Card {
                        val max = o.byProduct.maxOf { it.net.brl }.coerceAtLeast(1)
                        o.byProduct.take(8).forEach { b -> ShareBar(b.name, "${Fmt.money(b.net.brl)} · ${b.count}", b.net.brl.toFloat() / max) }
                    }
                }
            }
            item { SectionTitle("Funil da loja", trailing = "desde ${Fmt.dateTime(o.funnel.since)}") }
            item {
                Card {
                    val f = o.funnel
                    KeyValue("Loja aberta", Fmt.int(f.shopOpen))
                    KeyValue("Provou um item", Fmt.int(f.tryOn))
                    KeyValue("Checkout criado", Fmt.int(f.checkout))
                    KeyValue("Checkout de presente", Fmt.int(f.giftCheckout), divider = false)
                }
            }
        }
    }
}

@Composable
private fun Hero(o: Overview) {
    val p = palette
    var sel by rememberSelection()
    // Running total over the period: a calm, monotonic line whose end is the headline; touching a point reads
    // "until that day" and that day's own amount.
    val cumulative = remember(o) {
        var acc = 0.0
        o.series.map { acc += it.value; it.copy(value = acc) }
    }
    val shown = sel?.let { cumulative.getOrNull(it) }
    Card(padding = 22.dp) {
        Overline("Recebido ${PERIOD_PHRASE[o.period]}")
        Spacer(Modifier.height(10.dp))
        AnimatedContent(shown?.value?.toLong() ?: o.received.net.brl, transitionSpec = { fadeIn(tween(120)) togetherWith fadeOut(tween(90)) }, label = "hero") { v ->
            Text(Fmt.money(v), style = Type.hero, color = p.text, maxLines = 1)
        }
        Spacer(Modifier.height(8.dp))
        Box(Modifier.height(24.dp), contentAlignment = Alignment.CenterStart) {
            if (shown != null) {
                val day = o.series[sel!!].value.toLong()
                Text("Até ${Fmt.bucketLong(shown.t)} · ${if (day >= 0) "+" else "−"}${Fmt.money(kotlin.math.abs(day))} ${if (o.bucket == "hour") "nesta hora" else if (o.bucket == "month") "no mês" else "no dia"}", style = Type.label, color = p.text2)
            } else DeltaChip(o.received.net.brl, o.received.previousNet.brl)
        }
        Spacer(Modifier.height(18.dp))
        AreaChart(cumulative, axis = { Fmt.moneyAxis(it) }, selected = sel, onSelect = { sel = it }, color = p.accent)
        Spacer(Modifier.height(18.dp))
        Row(Modifier.fillMaxWidth()) {
            Stat("Bruto", Fmt.moneyShort(o.received.gross.brl), Modifier.weight(1f))
            Stat("Reembolsos", if (o.received.refunds.brl == 0L) "R$ 0" else "−${Fmt.moneyShort(o.received.refunds.brl)}", Modifier.weight(1f), if (o.received.refunds.brl > 0) p.bad else null)
            Stat("Cobranças", Fmt.int(o.received.charges), Modifier.weight(1f))
        }
        if (o.received.net.usd != 0L || o.received.gross.usd != 0L) {
            Spacer(Modifier.height(12.dp))
            Text("Em dólar (Stripe): ${Fmt.money(o.received.net.usd, "USD")} líquido", style = Type.caption, color = p.text3)
        }
    }
}

@Composable
private fun Stat(label: String, value: String, modifier: Modifier, tone: Color? = null) {
    val p = palette
    Column(modifier) {
        Text(label, style = Type.caption, color = p.text3)
        Spacer(Modifier.height(3.dp))
        Text(value, style = Type.number, color = tone ?: p.text, maxLines = 1)
    }
}

@Composable
private fun Kpis(o: Overview) {
    val p = palette
    val s = o.subscribers
    val c = o.conversion
    Spacer(Modifier.height(12.dp))
    MetricRow {
        Metric(
            "MRR", Fmt.moneyShort(o.mrr.now.brl), Modifier.weight(1f),
            sub = if (o.mrr.atRiskCount > 0) "${Fmt.moneyShort(o.mrr.atRisk.brl)} em risco (${o.mrr.atRiskCount} assinaturas)" else "Nada em risco",
        )
        Metric("Assinantes Plus", Fmt.int(s.plus), Modifier.weight(1f), sub = "${s.renewing} recorrentes · ${s.period} avulsos · ${s.pass} passes")
    }
    MetricRow {
        Metric("Novos no período", "+${Fmt.int(s.newInPeriod)}", Modifier.weight(1f), tone = if (s.newInPeriod > 0) p.good else null, sub = "${s.churnedInPeriod} saíram do Plus")
        Metric("Churn do Plus (30 d)", Fmt.pct(s.churn30d), Modifier.weight(1f), tone = s.churn30d?.let { if (it > 0.06) p.bad else null }, sub = "Meta: até 6% ao mês")
    }
    MetricRow {
        Metric("Conversão Plus", Fmt.pct(c.plusRate), Modifier.weight(1f), sub = "Assinantes ÷ ${Fmt.int(c.mau)} ativos no mês")
        Metric("ARPPU", c.arppuCents?.let { Fmt.money(it) } ?: "—", Modifier.weight(1f), sub = "${c.payers} pagantes no período")
    }
    MetricRow {
        Metric("Pagantes ÷ MAU", Fmt.pct(c.payerRate), Modifier.weight(1f), sub = "Meta: 4%")
        Metric("Taxa de reembolso", Fmt.pct(c.refundRate), Modifier.weight(1f), tone = c.refundRate?.let { if (it > 0.05) p.bad else null }, sub = "${o.received.refundCount} reembolsos")
    }
}

@Composable
private fun MrrCard(o: Overview) {
    val p = palette
    var sel by rememberSelection()
    val shown = sel?.let { o.mrr.series.getOrNull(it) }
    SectionTitle("Receita recorrente", trailing = if (o.bucket == "month") "12 meses" else "90 dias")
    Card {
        Text(Fmt.money(shown?.value?.toLong() ?: o.mrr.now.brl), style = Type.display, color = p.text)
        Spacer(Modifier.height(4.dp))
        Text(shown?.let { "MRR em ${Fmt.bucketLong(it.t)}" } ?: "MRR hoje · assinaturas que renovam sozinhas, anual ÷ 12", style = Type.caption, color = p.text3)
        Spacer(Modifier.height(16.dp))
        AreaChart(o.mrr.series, axis = { Fmt.moneyAxis(it) }, selected = sel, onSelect = { sel = it }, color = p.good, height = 140.dp)
    }
}

private val KIND_LABEL = mapOf("order" to "Compra", "subscription_first" to "Assinatura", "subscription_renewal" to "Renovação", "refund" to "Reembolso")

@Composable
private fun PurchaseRow(pu: Purchase, divider: Boolean) {
    val p = palette
    val nav = LocalNav.current
    val refund = pu.kind == "refund"
    Column {
        Row(
            Modifier.fillMaxWidth().then(if (pu.user != null) Modifier.pressable { nav.push(Route.User(pu.user.id)) } else Modifier).padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Avatar(pu.user?.displayName ?: "?", pu.user?.id ?: pu.id, 40.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(pu.user?.displayName ?: "Conta removida", style = Type.bodyStrong, color = p.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    if (pu.gift) { Spacer(Modifier.width(6.dp)); Tag("Presente", p.accent) }
                }
                Spacer(Modifier.height(2.dp))
                Text("${KIND_LABEL[pu.kind] ?: pu.kind} · ${pu.productName} · ${Fmt.ago(pu.at)}", style = Type.caption, color = p.text3, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Spacer(Modifier.width(10.dp))
            Text(
                (if (refund) "−" else "") + Fmt.money(kotlin.math.abs(pu.amountCents), pu.currency),
                style = Type.number, color = if (refund) p.bad else p.text,
            )
        }
        if (divider) Box(Modifier.fillMaxWidth().padding(start = 66.dp).height(1.dp).background(p.line))
    }
}

@Composable
private fun HomeSkeleton() {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Skeleton(Modifier.fillMaxWidth().height(330.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Skeleton(Modifier.weight(1f).height(110.dp)); Skeleton(Modifier.weight(1f).height(110.dp))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Skeleton(Modifier.weight(1f).height(110.dp)); Skeleton(Modifier.weight(1f).height(110.dp))
        }
    }
}
