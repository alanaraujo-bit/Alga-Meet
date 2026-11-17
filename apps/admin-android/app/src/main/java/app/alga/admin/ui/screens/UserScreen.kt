package app.alga.admin.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import app.alga.admin.App
import app.alga.admin.data.AccountActionBody
import app.alga.admin.data.UserDetail
import app.alga.admin.ui.LocalNav
import app.alga.admin.ui.components.Avatar
import app.alga.admin.ui.components.Card
import app.alga.admin.ui.components.ErrorCard
import app.alga.admin.ui.components.Fmt
import app.alga.admin.ui.components.LocalHaze
import app.alga.admin.ui.components.KeyValue
import app.alga.admin.ui.components.SectionTitle
import app.alga.admin.ui.components.Skeleton
import app.alga.admin.ui.components.Tag
import app.alga.admin.ui.components.glass
import app.alga.admin.ui.components.pressable
import app.alga.admin.ui.errorText
import app.alga.admin.ui.rememberLoaded
import app.alga.admin.ui.theme.Type
import app.alga.admin.ui.theme.palette
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.hazeSource
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.temporal.ChronoUnit

val REASONS = listOf(
    "spam" to "Spam", "harassment" to "Assédio", "hate" to "Discurso de ódio", "scam" to "Golpe ou fraude",
    "impersonation" to "Fingir ser outra pessoa", "sexual_content" to "Conteúdo sexual explícito", "privacy" to "Exposição de dados",
    "violence" to "Ameaça ou violência", "self_harm" to "Incentivo à autolesão", "non_consensual_intimate" to "Imagem íntima sem consentimento",
    "csam" to "Abuso infantil", "malware" to "Vírus ou invasão", "illegal_goods" to "Itens ilegais", "piracy" to "Pirataria",
    "ban_evasion" to "Fuga de moderação", "underage" to "Menor de 16 anos", "other" to "Termos ou Diretrizes",
)
private val ACTION_LABEL = mapOf("warn" to "Advertência", "suspend" to "Suspensão", "ban" to "Banimento", "lift" to "Medida retirada")
private val SUB_STATUS = mapOf("active" to "ativa", "past_due" to "cobrança pendente", "canceled" to "reembolsada", "expired" to "encerrada", "pending" to "aguardando")
private val ORDER_STATUS = mapOf("paid" to "pago", "refunded" to "reembolsado", "pending" to "aguardando", "canceled" to "cancelado", "expired" to "expirado")

/** Detail screens share the shell's glass: their own source for the back bar. */
@Composable
fun DetailScaffold(title: String, content: androidx.compose.foundation.lazy.LazyListScope.() -> Unit) {
    val p = palette
    val nav = LocalNav.current
    val haze = remember { HazeState() }
    val status = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
    val bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    CompositionLocalProvider(LocalHaze provides haze) { Box(Modifier.fillMaxSize().background(p.bg)) {
        LazyColumn(
            Modifier.fillMaxSize().hazeSource(haze),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = status + 72.dp, bottom = bottom + 32.dp),
            content = content,
        )
        Row(
            Modifier.fillMaxWidth().glass(RoundedCornerShape(0.dp), strong = true).windowInsetsPadding(WindowInsets.statusBars).height(64.dp).padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(44.dp).clip(RoundedCornerShape(22.dp)).pressable(nav.back), contentAlignment = Alignment.Center) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Voltar", tint = p.text)
            }
            Spacer(Modifier.width(6.dp))
            Text(title, style = Type.title, color = p.text, maxLines = 1)
        }
    } }
}

@Composable
fun UserScreen(id: String) {
    val app = App.get(LocalContext.current)
    val load = rememberLoaded("user:$id") { app.api.user(id) }
    val u = load.data
    var acting by remember { mutableStateOf(false) }
    DetailScaffold(u?.displayName ?: "Conta") {
        if (u == null) {
            item { if (load.error != null) ErrorCard(load.error, load.refresh) else Skeleton(Modifier.fillMaxWidth().height(300.dp)) }
            return@DetailScaffold
        }
        item { Header(u) }
        item { Account(u) }
        if (u.billing != null) item { BillingSection(u.billing) }
        item { Sessions(u) }
        item { Actions(u) { acting = true } }
    }
    if (u != null && acting) ActionSheet(u, onDone = { acting = false; load.refresh() }, onDismiss = { acting = false })
}

@Composable
private fun Header(u: UserDetail) {
    val p = palette
    Card(padding = 22.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(u.displayName, u.id, 64.dp)
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f)) {
                Text(u.displayName, style = Type.title, color = p.text)
                Text("@${u.username}", style = Type.body, color = p.text2)
                Text(u.email, style = Type.caption, color = p.text3)
            }
        }
        Spacer(Modifier.height(14.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (u.plan == "plus") Tag("Plus", p.accent) else Tag("Gratuito", p.text3)
            stateTag(u.state, p)?.let { (t, c) -> Tag(t, c) }
            if (u.staffRole != null) Tag(if (u.staffRole == "admin") "Admin" else "Moderação", p.good)
            if (u.legalHold) Tag("Guarda legal", p.warn)
        }
        Spacer(Modifier.height(12.dp))
        Text("Conta criada em ${Fmt.date(u.createdAt)} · último acesso ${Fmt.ago(u.lastSeenAt)}", style = Type.caption, color = p.text3)
    }
}

@Composable
private fun Account(u: UserDetail) {
    val p = palette
    SectionTitle("Conta")
    Card {
        KeyValue("E-mail confirmado", if (u.emailVerified) "Sim" else "Não", valueColor = if (u.emailVerified) null else p.warn)
        KeyValue("Faixa etária", when (u.ageBracket) { "adult" -> "18+"; "teen" -> "16–17"; else -> "Não informada" })
        KeyValue("Plus desde", u.plusSince?.let { Fmt.date(it) } ?: "—")
        if (u.suspendedUntil != null && u.state == "suspended") KeyValue("Suspensa até", Fmt.dateTime(u.suspendedUntil), valueColor = p.warn)
        if (u.deletionPurgeAfter != null) KeyValue("Exclusão definitiva em", Fmt.date(u.deletionPurgeAfter), valueColor = p.warn)
        KeyValue("Espaços · amigos", "${u.counts.spaces} · ${u.counts.friends}")
        KeyValue("Denúncias contra a conta", Fmt.int(u.counts.reportsAgainst), valueColor = if (u.counts.reportsAgainst > 0) p.warn else null)
        KeyValue("Denúncias feitas · arquivadas", "${u.counts.reportsBy} · ${u.counts.falseReports}", divider = false)
    }
}

@Composable
private fun BillingSection(b: UserDetail.Billing) {
    val p = palette
    SectionTitle("Pagamentos", trailing = "total pago ${Fmt.money(b.lifetime.brl)}")
    Card(padding = 6.dp) {
        if (b.subscriptions.isEmpty() && b.orders.isEmpty()) Text("Nenhum pagamento.", style = Type.body, color = p.text3, modifier = Modifier.padding(16.dp))
        b.subscriptions.forEach { s ->
            Line(
                title = "Plus ${if (s.kind == "renewing") "recorrente" else if (s.kind == "pass") "(passe)" else "avulso"} · ${SUB_STATUS[s.status] ?: s.status}",
                sub = "${s.provider} · desde ${Fmt.date(s.startedAt)}" + (s.currentPeriodEnd?.let { " · até ${Fmt.date(it)}" } ?: "") + if (s.cancelAtPeriodEnd) " · não renova" else "",
                value = if (s.amountCents == 0L) "grátis" else Fmt.money(s.amountCents, s.currency),
                tone = if (s.status == "canceled") p.bad else null,
            )
        }
        b.orders.forEach { o ->
            Line(
                title = "${o.productId}${if (o.gift) " · presente" else ""}",
                sub = "${ORDER_STATUS[o.status] ?: o.status} · ${o.provider} · ${Fmt.dateTime(o.paidAt ?: o.createdAt)}",
                value = Fmt.money(o.amountCents, o.currency),
                tone = if (o.status == "refunded") p.bad else if (o.status != "paid") p.text3 else null,
            )
        }
    }
}

@Composable
private fun Line(title: String, sub: String, value: String, tone: Color?) {
    val p = palette
    Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = Type.bodyStrong, color = p.text, maxLines = 1)
            Text(sub, style = Type.caption, color = p.text3, maxLines = 2)
        }
        Spacer(Modifier.width(10.dp))
        Text(value, style = Type.number, color = tone ?: p.text)
    }
}

@Composable
private fun Sessions(u: UserDetail) {
    val p = palette
    SectionTitle("Aparelhos conectados", trailing = "${u.sessions.size}")
    Card(padding = 6.dp) {
        if (u.sessions.isEmpty()) Text("Nenhuma sessão aberta.", style = Type.body, color = p.text3, modifier = Modifier.padding(16.dp))
        u.sessions.forEach { s -> Line(listOfNotNull(s.client, s.os).joinToString(" · ").ifEmpty { "Aparelho desconhecido" }, "Entrou ${Fmt.date(s.createdAt)} · usado ${Fmt.ago(s.lastUsedAt)}", "", null) }
    }
    if (u.actions.isNotEmpty()) {
        SectionTitle("Histórico de medidas")
        Card(padding = 6.dp) {
            u.actions.forEach { a ->
                Line(
                    "${ACTION_LABEL[a.type] ?: a.type} · ${REASONS.toMap()[a.reason] ?: a.reason}",
                    Fmt.dateTime(a.createdAt) + (a.until?.let { " · até ${Fmt.dateTime(it)}" } ?: "") + (a.note?.let { "\n$it" } ?: ""),
                    "", if (a.type == "ban") p.bad else null,
                )
            }
        }
    }
}

@Composable
private fun Actions(u: UserDetail, open: () -> Unit) {
    val p = palette
    val nav = LocalNav.current
    if (u.id == nav.me.id) return
    Spacer(Modifier.height(24.dp))
    Box(
        Modifier.fillMaxWidth().height(52.dp).clip(RoundedCornerShape(16.dp)).background(p.raised).pressable(open),
        contentAlignment = Alignment.Center,
    ) { Text("Aplicar uma medida", style = Type.bodyStrong, color = p.text) }
    Spacer(Modifier.height(8.dp))
    Text("Advertência, suspensão, banimento ou retirar a medida atual. O servidor confere a permissão e registra quem fez.", style = Type.caption, color = p.text3, modifier = Modifier.padding(horizontal = 4.dp))
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ActionSheet(u: UserDetail, onDone: () -> Unit, onDismiss: () -> Unit) {
    val app = App.get(LocalContext.current)
    val p = palette
    val scope = rememberCoroutineScope()
    val restricted = u.state == "suspended" || u.state == "banned"
    val types = buildList {
        add("warn" to "Advertir"); add("suspend" to "Suspender"); add("ban" to "Banir")
        if (restricted) add("lift" to "Retirar medida")
    }
    var type by remember { mutableStateOf(if (restricted) "lift" else "warn") }
    var reason by remember { mutableStateOf("spam") }
    var days by remember { mutableStateOf(7) }
    var note by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val summary = when (type) {
        "warn" -> "Advertir @${u.username}"
        "suspend" -> "Suspender @${u.username} por $days ${if (days == 1) "dia" else "dias"}"
        "ban" -> "Banir @${u.username}"
        else -> "Retirar a medida de @${u.username}"
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = p.surface) {
        Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 28.dp)) {
            Text("Aplicar uma medida", style = Type.title, color = p.text)
            Spacer(Modifier.height(16.dp))
            Chips(types, type) { type = it }
            Spacer(Modifier.height(18.dp))
            Text("Motivo", style = Type.label, color = p.text3)
            Spacer(Modifier.height(8.dp))
            Chips(REASONS, reason) { reason = it }
            if (type == "suspend") {
                Spacer(Modifier.height(18.dp))
                Text("Por quanto tempo", style = Type.label, color = p.text3)
                Spacer(Modifier.height(8.dp))
                Chips(listOf("1" to "1 dia", "3" to "3 dias", "7" to "7 dias", "30" to "30 dias"), days.toString()) { days = it.toInt() }
            }
            Spacer(Modifier.height(18.dp))
            OutlinedTextField(
                note, { note = it.take(2000) }, label = { Text("Nota interna (opcional)") }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp),
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = p.accent, unfocusedBorderColor = p.line, focusedTextColor = p.text, unfocusedTextColor = p.text),
            )
            if (error != null) { Spacer(Modifier.height(10.dp)); Text(error!!, style = Type.body, color = p.bad) }
            Spacer(Modifier.height(20.dp))
            val danger = type == "ban" || type == "suspend"
            Box(
                Modifier.fillMaxWidth().height(52.dp).clip(RoundedCornerShape(16.dp)).background(if (danger) p.bad else p.accentFill).pressable { confirm = true },
                contentAlignment = Alignment.Center,
            ) { Text(summary, style = Type.bodyStrong, color = Color.White) }
        }
    }
    if (confirm) AlertDialog(
        onDismissRequest = { confirm = false },
        containerColor = p.surface,
        title = { Text("$summary?", style = Type.title, color = p.text) },
        text = {
            Text(
                when (type) {
                    "warn" -> "A pessoa recebe a advertência por e-mail e no app, e pode recorrer em 30 dias."
                    "lift" -> "A conta volta a funcionar na hora."
                    else -> "As sessões da pessoa são encerradas agora. Ela recebe o motivo e pode recorrer em 30 dias."
                },
                style = Type.body, color = p.text2,
            )
        },
        confirmButton = {
            TextButton(enabled = !busy, onClick = {
                busy = true
                scope.launch {
                    try {
                        app.api.accountAction(u.id, AccountActionBody(
                            type = type, reason = reason, note = note.ifBlank { null },
                            until = if (type == "suspend") Instant.now().plus(days.toLong(), ChronoUnit.DAYS).toString() else null,
                        ))
                        confirm = false
                        onDone()
                    } catch (e: Exception) {
                        error = errorText(e)
                        confirm = false
                    } finally { busy = false }
                }
            }) { Text("Confirmar", color = if (type == "ban" || type == "suspend") p.bad else p.accent) }
        },
        dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancelar", color = p.text2) } },
    )
}

@Composable
private fun Chips(options: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit) {
    val p = palette
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (k, label) ->
            val on = k == selected
            Text(
                label, style = Type.label, color = if (on) Color.White else p.text2,
                modifier = Modifier.clip(RoundedCornerShape(12.dp)).background(if (on) p.accentFill else p.raised).pressable { onSelect(k) }.padding(horizontal = 14.dp, vertical = 9.dp),
            )
        }
    }
}
