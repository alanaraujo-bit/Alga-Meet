package app.alga.admin.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.alga.admin.App
import app.alga.admin.data.Growth
import app.alga.admin.data.Point
import app.alga.admin.ui.components.AreaChart
import app.alga.admin.ui.components.BarChart
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
import app.alga.admin.ui.components.rememberSelection
import app.alga.admin.ui.rememberLoaded
import app.alga.admin.ui.screenPadding
import app.alga.admin.ui.theme.Type
import app.alga.admin.ui.theme.palette

private val WINDOWS = listOf("7" to "7 dias", "30" to "30 dias", "90" to "90 dias")
private val UNINSTALL = mapOf(
    "not_using" to "Não estou usando", "friends_elsewhere" to "Os amigos usam outro app", "audio_video" to "Áudio ou vídeo",
    "performance" to "Desempenho", "missing_feature" to "Falta um recurso", "reinstalling" to "Vou reinstalar", "other" to "Outro motivo",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GrowthScreen() {
    val app = App.get(LocalContext.current)
    var days by rememberSaveable { mutableStateOf("30") }
    val load = rememberLoaded("growth:$days", everyMs = 120_000) { app.api.growth(days.toInt()) }
    val g = load.data
    PullToRefreshBox(isRefreshing = load.loading && g != null, onRefresh = load.refresh, modifier = Modifier.fillMaxSize()) {
        LazyColumn(contentPadding = screenPadding(), modifier = Modifier.fillMaxSize()) {
            item { Segmented(WINDOWS, days, { days = it }, Modifier.fillMaxWidth().padding(bottom = 16.dp)) }
            if (g == null) {
                item { if (load.error != null) ErrorCard(load.error, load.refresh) else Skeleton(Modifier.fillMaxWidth().height(420.dp)) }
                return@LazyColumn
            }
            item { Signups(g) }
            item { Active(g) }
            item { Voice(g) }
            item { MessagesCard(g) }
            item { Cohorts(g) }
            item { Base(g) }
            if (g.uninstall.total > 0) item { Uninstall(g) }
            item { NotTracked(g) }
        }
    }
}

@Composable
private fun ChartReadout(title: String, value: String, sel: Point?, label: String, showDate: Boolean = true) {
    val p = palette
    Overline(title)
    Spacer(Modifier.height(8.dp))
    Text(sel?.let { Fmt.int(it.value.toLong()) } ?: value, style = Type.display, color = p.text)
    val sub = sel?.takeIf { showDate }?.let { Fmt.bucketLong(it.t) } ?: label
    if (sub.isNotEmpty()) {
        Spacer(Modifier.height(4.dp))
        Text(sub, style = Type.caption, color = p.text3)
    }
}

@Composable
private fun Signups(g: Growth) {
    var sel by rememberSelection()
    Card(padding = 22.dp) {
        ChartReadout("Cadastros em ${g.days} dias", Fmt.int(g.signups.inPeriod), sel?.let { g.signups.series.getOrNull(it) }, "", showDate = false)
        Spacer(Modifier.height(8.dp))
        Box(Modifier.height(24.dp), contentAlignment = Alignment.CenterStart) {
            if (sel == null) DeltaChip(g.signups.inPeriod.toLong(), g.signups.previous.toLong())
            else Text(Fmt.bucketLong(g.signups.series[sel!!].t), style = Type.label, color = palette.text2)
        }
        Spacer(Modifier.height(16.dp))
        BarChart(g.signups.series, selected = sel, onSelect = { sel = it })
    }
}

@Composable
private fun Active(g: Growth) {
    val p = palette
    val a = g.active
    var sel by rememberSelection()
    SectionTitle("Pessoas ativas", trailing = "abriram o app no dia")
    MetricRow {
        Metric("Hoje", Fmt.int(a.dau), Modifier.weight(1f))
        Metric("7 dias", Fmt.int(a.wau), Modifier.weight(1f))
        Metric("30 dias", Fmt.int(a.mau), Modifier.weight(1f))
    }
    Card {
        ChartReadout("Ativos por dia", Fmt.int(a.dau), sel?.let { a.series.getOrNull(it) }, "DAU ÷ MAU (aderência): ${Fmt.pct(a.stickiness)}")
        Spacer(Modifier.height(16.dp))
        AreaChart(a.series, selected = sel, onSelect = { sel = it }, height = 140.dp)
        Spacer(Modifier.height(12.dp))
        KeyValue("Mandaram mensagem (30 d)", Fmt.int(a.messaging30d))
        KeyValue("3+ min em voz (30 d)", Fmt.int(a.voice30d), divider = false)
    }
    Spacer(Modifier.height(12.dp))
    val act = g.activation
    Card {
        Overline("Ativação")
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.Bottom) {
            Text(Fmt.pct(act.rate), style = Type.display, color = act.rate?.let { if (it >= 0.25) p.good else p.text } ?: p.text)
            Spacer(Modifier.width(10.dp))
            Text("${act.activated} de ${act.cohort} cadastros", style = Type.caption, color = p.text3, modifier = Modifier.padding(bottom = 5.dp))
        }
        Spacer(Modifier.height(6.dp))
        Text("3 min ou mais em voz com outra pessoa no dia do cadastro ou no seguinte (cadastros de 2 a 32 dias atrás). Meta: 25% orgânico, 60% pelo convite.", style = Type.caption, color = p.text3)
    }
}

@Composable
private fun Voice(g: Growth) {
    val p = palette
    val v = g.voice
    var sel by rememberSelection()
    SectionTitle("Tempo em chamada", trailing = if (g.days > 35) "últimos 35 dias" else "${g.days} dias")
    MetricRow {
        Metric("Minutos em voz", Fmt.minutes(v.minutesInPeriod), Modifier.weight(1f), sub = "${Fmt.int(v.people)} pessoas")
        Metric("Por pessoa", v.minutesPerPerson?.let { Fmt.minutes(it) } ?: "—", Modifier.weight(1f), sub = "Sessão mediana: ${v.medianSessionMin?.let { "${Fmt.int(it.toLong())} min" } ?: "—"}")
    }
    Card {
        ChartReadout("Minutos por dia", Fmt.minutes(v.minutesInPeriod), sel?.let { v.perDay.getOrNull(it) }, "soma de todas as pessoas")
        Spacer(Modifier.height(16.dp))
        BarChart(v.perDay, selected = sel, onSelect = { sel = it }, color = p.good)
        if (v.weekly.isNotEmpty()) {
            Spacer(Modifier.height(18.dp))
            Overline("Por semana (12 semanas)")
            Spacer(Modifier.height(6.dp))
            v.weekly.takeLast(6).reversed().forEachIndexed { i, w ->
                KeyValue(Fmt.bucket(w.week), "${Fmt.int(w.minutes / 60)} h · ${w.people} pessoas", divider = i < minOf(6, v.weekly.size) - 1)
            }
        }
    }
}

@Composable
private fun MessagesCard(g: Growth) {
    var sel by rememberSelection()
    SectionTitle("Mensagens")
    Card {
        ChartReadout("Mensagens em ${g.days} dias", Fmt.int(g.messages.inPeriod), sel?.let { g.messages.perDay.getOrNull(it) }, "${Fmt.int(g.spaces.newInPeriod)} espaços novos · ${Fmt.int(g.spaces.total)} no total")
        Spacer(Modifier.height(16.dp))
        BarChart(g.messages.perDay, selected = sel, onSelect = { sel = it })
    }
}

/** Weekly cohorts as a heat grid: rows = signup week, columns = week N after; deeper indigo = more retained. */
@Composable
private fun Cohorts(g: Growth) {
    val p = palette
    SectionTitle("Retenção semanal", trailing = "% que voltou ao app")
    Card(padding = 16.dp) {
        Column(Modifier.horizontalScroll(rememberScrollState())) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Cadastro", style = Type.caption, color = p.text3, modifier = Modifier.width(64.dp))
                Text("Pessoas", style = Type.caption, color = p.text3, modifier = Modifier.width(56.dp))
                for (n in 0 until 8) Text("S$n", style = Type.caption, color = p.text3, textAlign = TextAlign.Center, modifier = Modifier.width(44.dp))
            }
            Spacer(Modifier.height(6.dp))
            g.cohorts.forEach { c ->
                Row(Modifier.padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(Fmt.bucket(c.week), style = Type.caption, color = p.text2, modifier = Modifier.width(64.dp))
                    Text(Fmt.int(c.size), style = Type.caption, color = if (c.size < 10) p.text3 else p.text2, modifier = Modifier.width(56.dp))
                    c.weeks.forEach { r ->
                        Box(Modifier.width(44.dp).height(30.dp).padding(2.dp).clip(RoundedCornerShape(6.dp))
                            .background(if (r == null || c.size == 0) p.raised.copy(alpha = 0.4f) else p.accent.copy(alpha = (0.08f + 0.85f * r.toFloat()).coerceAtMost(0.93f))),
                            contentAlignment = Alignment.Center) {
                            if (r != null && c.size > 0) Text(Fmt.pct(r, 0), style = Type.caption.copy(fontSize = androidx.compose.ui.unit.TextUnit(11f, androidx.compose.ui.unit.TextUnitType.Sp)), color = if (r > 0.5) androidx.compose.ui.graphics.Color.White else p.text)
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        Text("S0 é a semana do cadastro. Grupos com menos de 10 pessoas oscilam muito: leia como tendência. A semana atual ainda está correndo.", style = Type.caption, color = p.text3)
    }
    if (g.northStar.isNotEmpty()) {
        Spacer(Modifier.height(12.dp))
        Card {
            Overline("Grupos ativos na semana (estrela-guia)")
            Spacer(Modifier.height(8.dp))
            val last = g.northStar.last()
            Text(last.value?.let { Fmt.int(it) } ?: "menos de 10", style = Type.display, color = p.text)
            Text("Espaços ou DMs com 3+ pessoas juntas em voz por 30+ min na semana de ${Fmt.bucket(last.week)}", style = Type.caption, color = p.text3)
        }
    }
}

@Composable
private fun Base(g: Growth) {
    val p = palette
    val u = g.users
    SectionTitle("Base de contas")
    Card {
        KeyValue("Contas", Fmt.int(u.total))
        KeyValue("E-mail confirmado", "${Fmt.int(u.verified)} · ${Fmt.pct(if (u.total > 0) u.verified.toDouble() / u.total else null, 0)}")
        KeyValue("Exclusão pedida", Fmt.int(u.pendingDeletion))
        KeyValue("Suspensas ou banidas", Fmt.int(u.restricted), valueColor = if (u.restricted > 0) p.warn else null)
        KeyValue("Equipe", Fmt.int(u.staff), divider = false)
    }
}

@Composable
private fun Uninstall(g: Growth) {
    SectionTitle("Por que saem", trailing = "${g.uninstall.total} respostas, 30 dias")
    Card {
        val max = g.uninstall.byReason.maxOf { it.count }.coerceAtLeast(1)
        g.uninstall.byReason.forEach { r -> ShareBar(UNINSTALL[r.reason] ?: r.reason, Fmt.int(r.count), r.count.toFloat() / max, palette.warn) }
    }
}

@Composable
private fun NotTracked(g: Growth) {
    val p = palette
    SectionTitle("O que ainda não é medido")
    Card {
        g.notTracked.forEach { t ->
            Row(Modifier.padding(vertical = 7.dp)) {
                Box(Modifier.padding(top = 7.dp).size(5.dp).clip(RoundedCornerShape(3.dp)).background(p.text3))
                Spacer(Modifier.width(12.dp))
                Text(t, style = Type.body, color = p.text2)
            }
        }
    }
}
