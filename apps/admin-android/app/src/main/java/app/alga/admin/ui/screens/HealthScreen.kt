package app.alga.admin.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import app.alga.admin.App
import app.alga.admin.data.Health
import app.alga.admin.ui.LocalNav
import app.alga.admin.ui.Route
import app.alga.admin.ui.components.Card
import app.alga.admin.ui.components.ErrorCard
import app.alga.admin.ui.components.Fmt
import app.alga.admin.ui.components.KeyValue
import app.alga.admin.ui.components.Metric
import app.alga.admin.ui.components.MetricRow
import app.alga.admin.ui.components.SectionTitle
import app.alga.admin.ui.components.Skeleton
import app.alga.admin.ui.components.StatusDot
import app.alga.admin.ui.rememberLoaded
import app.alga.admin.ui.screenPadding
import app.alga.admin.ui.theme.Type
import app.alga.admin.ui.theme.palette

private val JOB_NAMES = mapOf("nightly" to "Métricas da noite", "weekly" to "Resumo semanal", "activity_email" to "E-mails de atividade")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HealthScreen() {
    val app = App.get(LocalContext.current)
    val load = rememberLoaded("health", everyMs = 15_000) { app.api.health() }
    val h = load.data
    PullToRefreshBox(isRefreshing = load.loading && h != null, onRefresh = load.refresh, modifier = Modifier.fillMaxSize()) {
        LazyColumn(contentPadding = screenPadding(), modifier = Modifier.fillMaxSize()) {
            if (h == null) {
                item { if (load.error != null) ErrorCard(load.error, load.refresh) else Skeleton(Modifier.fillMaxWidth().height(380.dp)) }
                return@LazyColumn
            }
            item { Status(h, apiOk = load.error == null) }
            item { Live(h) }
            item { Quality(h) }
            item { Moderation(h) }
            item { Versions(h) }
            item { Jobs(h) }
        }
    }
}

@Composable
private fun StatusLine(ok: Boolean?, title: String, detail: String, divider: Boolean = true) {
    val p = palette
    val c = when (ok) { true -> p.good; false -> p.bad; null -> p.text3 }
    Column {
        Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            StatusDot(c, pulse = ok == true, size = 10.dp)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(title, style = Type.bodyStrong, color = p.text)
                Text(detail, style = Type.caption, color = p.text3)
            }
        }
        if (divider) Box(Modifier.fillMaxWidth().height(1.dp).background(p.line))
    }
}

@Composable
private fun Status(h: Health, apiOk: Boolean) {
    val p = palette
    val sfu = h.sfu
    Card(padding = 18.dp) {
        StatusLine(apiOk, if (apiOk) "API no ar" else "API sem resposta", "Versão ${h.version} · no ar há ${Fmt.uptime(h.uptimeS)} · ${Fmt.bytes(h.process.rssBytes)} de memória")
        StatusLine(
            sfu.ok,
            when (sfu.ok) { true -> "Servidor de voz no ar"; false -> "Servidor de voz fora do ar"; null -> "Servidor de voz: aguardando checagem" },
            when {
                sfu.ok == false && sfu.downSince != null -> "Fora desde ${Fmt.dateTime(sfu.downSince)}"
                sfu.latencyMs != null -> "Responde em ${sfu.latencyMs} ms · checado ${Fmt.ago(sfu.checkedAt)}"
                else -> "Checado a cada minuto pela API"
            },
        )
        val errs = h.api.errors5m > 0 || h.counters.billingWebhookErrors > 0
        StatusLine(
            !errs,
            if (h.api.errors1h == 0) "Sem erros 5xx na última hora" else "${h.api.errors1h} erros 5xx na última hora",
            "Webhooks de pagamento com erro: ${h.counters.billingWebhookErrors} · e-mails que falharam: ${h.counters.emailFailures} (desde o início)",
            divider = false,
        )
    }
}

@Composable
private fun Live(h: Health) {
    val l = h.live
    SectionTitle("Agora", trailing = "atualiza a cada 15 s")
    MetricRow {
        Metric("Online", Fmt.int(l.online), Modifier.weight(1f), sub = "${l.sockets} conexões")
        Metric("Em voz", Fmt.int(l.inVoice), Modifier.weight(1f), sub = "${l.voiceRooms} salas", tone = if (l.inVoice > 0) palette.good else null)
        Metric("Cinema", Fmt.int(l.cinemaSeats), Modifier.weight(1f), sub = "assentos")
    }
}

@Composable
private fun Quality(h: Health) {
    val p = palette
    val q = h.quality
    SectionTitle("Chamadas", trailing = "${q.reports7d} relatórios, 7 dias")
    MetricRow {
        Metric("Entrar na voz", q.joinP50Ms?.let { "${Fmt.int(it.toLong())} ms" } ?: "—", Modifier.weight(1f), sub = "p95: ${q.joinP95Ms?.let { "${Fmt.int(it.toLong())} ms" } ?: "—"}")
        Metric("Ida e volta", q.rttP50Ms?.let { "${Fmt.int(it.toLong())} ms" } ?: "—", Modifier.weight(1f), sub = "mediana até o SFU")
    }
    MetricRow {
        Metric("Perda de pacotes", q.lossAvgPct?.let { "${it.toString().replace('.', ',')}%" } ?: "—", Modifier.weight(1f), tone = q.lossAvgPct?.let { if (it > 2) p.warn else null }, sub = "média por sessão")
        Metric("Reconexão falhou", Fmt.pct(q.reconnectFailRate), Modifier.weight(1f), tone = q.reconnectFailRate?.let { if (it > 0.02) p.bad else null }, sub = "das sessões")
    }
    if (q.byVersion.isNotEmpty()) Card {
        q.byVersion.forEachIndexed { i, v ->
            KeyValue("App ${v.version}", "${v.reports} rel. · perda ${v.lossAvgPct?.let { "${it.toString().replace('.', ',')}%" } ?: "—"}", divider = i < q.byVersion.lastIndex)
        }
    }
    if (q.reports7d == 0) Text("Só quem ligou a telemetria de chamadas envia relatório.", style = Type.caption, color = p.text3, modifier = Modifier.padding(4.dp))
}

@Composable
private fun Moderation(h: Health) {
    val p = palette
    val m = h.moderation
    SectionTitle("Moderação")
    Card {
        KeyValue("Denúncias abertas", Fmt.int(m.openReports), valueColor = if (m.openReports > 0) p.warn else null)
        KeyValue("Urgentes na fila", Fmt.int(m.urgentReports), valueColor = if (m.urgentReports > 0) p.bad else null)
        KeyValue("Denúncias em 24 h", Fmt.int(m.reports24h))
        KeyValue("Recursos esperando decisão", Fmt.int(m.openAppeals))
        KeyValue("Arquivos em quarentena", Fmt.int(m.quarantined), divider = false)
    }
    Spacer(Modifier.height(12.dp))
    val nav = LocalNav.current
    Card(onClick = { nav.push(Route.Feedback) }) {
        Text("O que as pessoas estão dizendo", style = Type.bodyStrong, color = p.text)
        Spacer(Modifier.height(4.dp))
        Text("Relatos do \"Conta pro Eco\" no app, os mais novos primeiro.", style = Type.caption, color = p.text3)
    }
}

@Composable
private fun Versions(h: Health) {
    if (h.versions.isEmpty()) return
    SectionTitle("Versões em uso", trailing = "sessões dos últimos 7 dias")
    Card {
        h.versions.forEachIndexed { i, v -> KeyValue("${v.version} · ${v.os}", Fmt.int(v.sessions), divider = i < h.versions.lastIndex) }
    }
}

@Composable
private fun Jobs(h: Health) {
    if (h.jobs.isEmpty()) return
    SectionTitle("Tarefas agendadas")
    Card {
        h.jobs.forEachIndexed { i, j ->
            KeyValue(JOB_NAMES[j.job] ?: j.job, j.finishedAt?.let { Fmt.ago(it) } ?: "rodando ou não terminou", valueColor = if (j.finishedAt == null) palette.warn else null, divider = i < h.jobs.lastIndex)
        }
    }
}
