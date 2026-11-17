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
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.CloudDone
import androidx.compose.material.icons.rounded.CreditCardOff
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.Flag
import androidx.compose.material.icons.rounded.PersonAdd
import androidx.compose.material.icons.rounded.Replay
import androidx.compose.material.icons.rounded.ShoppingBag
import androidx.compose.material.icons.rounded.Undo
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import app.alga.admin.App
import app.alga.admin.data.AdminEvent
import app.alga.admin.ui.Cache
import app.alga.admin.ui.LocalNav
import app.alga.admin.ui.Route
import app.alga.admin.ui.components.Card
import app.alga.admin.ui.components.ErrorCard
import app.alga.admin.ui.components.Fmt
import app.alga.admin.ui.components.IconBadge
import app.alga.admin.ui.components.Skeleton
import app.alga.admin.ui.components.StatusDot
import app.alga.admin.ui.components.pressable
import app.alga.admin.ui.errorText
import app.alga.admin.ui.screenPadding
import app.alga.admin.ui.theme.Palette
import app.alga.admin.ui.theme.Type
import app.alga.admin.ui.theme.palette
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

fun kindLook(kind: String, p: Palette): Pair<ImageVector, Color> = when (kind) {
    "purchase" -> Icons.Rounded.ShoppingBag to p.good
    "subscription_started" -> Icons.Rounded.AutoAwesome to p.accent
    "subscription_renewed" -> Icons.Rounded.Replay to p.good
    "refund" -> Icons.Rounded.Undo to p.bad
    "payment_failed" -> Icons.Rounded.CreditCardOff to p.warn
    "signup" -> Icons.Rounded.PersonAdd to p.accent
    "report" -> Icons.Rounded.Flag to p.bad
    "report_spike" -> Icons.Rounded.Warning to p.bad
    "sfu_down" -> Icons.Rounded.CloudOff to p.bad
    "sfu_up" -> Icons.Rounded.CloudDone to p.good
    "api_errors" -> Icons.Rounded.ErrorOutline to p.warn
    else -> Icons.Rounded.AutoAwesome to p.text3
}

@Suppress("UNCHECKED_CAST")
@Composable
fun AlertsScreen() {
    val app = App.get(LocalContext.current)
    val p = palette
    val events = remember { mutableStateListOf<AdminEvent>().apply { addAll(Cache.values["events"] as List<AdminEvent>? ?: emptyList()) } }
    var error by remember { mutableStateOf<String?>(null) }
    var loaded by remember { mutableStateOf(events.isNotEmpty()) }
    var more by remember { mutableStateOf(true) }
    var live by remember { mutableStateOf(false) }
    val list = rememberLazyListState()

    LaunchedEffect(Unit) {
        try {
            val fresh = app.api.events()
            events.clear(); events.addAll(fresh); Cache.values["events"] = fresh.toList()
            more = fresh.size >= 60; error = null
        } catch (e: Exception) { if (e is kotlinx.coroutines.CancellationException) throw e; error = errorText(e) }
        loaded = true
    }
    // Live while the tab is open: new events slide in at the top.
    DisposableEffect(Unit) {
        val src = app.api.stream(
            onEvent = { e -> android.os.Handler(android.os.Looper.getMainLooper()).post { if (events.none { it.id == e.id }) events.add(0, e) } },
            onState = { open, _ -> live = open },
        )
        onDispose { src.cancel() }
    }
    LaunchedEffect(list) {
        snapshotFlow { list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }.collect { last ->
            if (more && loaded && events.isNotEmpty() && last >= list.layoutInfo.totalItemsCount - 3) {
                more = false
                val older = runCatching { withContext(Dispatchers.IO) { app.api.events(before = events.last().createdAt) } }.getOrNull()
                if (older != null) { events.addAll(older.filter { o -> events.none { it.id == o.id } }); more = older.size >= 60 }
            }
        }
    }

    LazyColumn(state = list, contentPadding = screenPadding(), modifier = Modifier.fillMaxSize()) {
        item {
            Row(Modifier.fillMaxWidth().padding(start = 4.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                StatusDot(if (live) p.good else p.text3, pulse = live)
                Spacer(Modifier.width(8.dp))
                Text(if (live) "Ao vivo: novos avisos aparecem aqui na hora" else "Conectando ao vivo…", style = Type.caption, color = p.text3)
            }
        }
        if (!loaded) item { Skeleton(Modifier.fillMaxWidth().height(320.dp)) }
        if (error != null && events.isEmpty()) item { ErrorCard(error!!) { error = null } }
        if (loaded && events.isEmpty() && error == null) item {
            Card { Text("Nenhum aviso ainda. Compras, cadastros, denúncias urgentes e quedas aparecem aqui.", style = Type.body, color = p.text3) }
        }
        val byDay = events.groupBy { Fmt.dayKey(it.createdAt) }
        byDay.forEach { (_, dayEvents) ->
            item(key = "h-${dayEvents.first().createdAt}") {
                Text(Fmt.dayHeader(dayEvents.first().createdAt), style = Type.label, color = p.text3, modifier = Modifier.padding(start = 4.dp, top = 18.dp, bottom = 8.dp))
            }
            item(key = "d-${dayEvents.first().id}") {
                Card(padding = 6.dp) { dayEvents.forEachIndexed { i, e -> EventRow(e, i < dayEvents.lastIndex) } }
            }
        }
    }
}

@Composable
private fun EventRow(e: AdminEvent, divider: Boolean) {
    val p = palette
    val nav = LocalNav.current
    val (icon, tint) = kindLook(e.kind, p)
    Column {
        Row(
            Modifier.fillMaxWidth().then(if (e.user != null) Modifier.pressable { nav.push(Route.User(e.user.id)) } else Modifier).padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconBadge(icon, tint)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(e.title, style = Type.bodyStrong, color = p.text, maxLines = 1)
                Text(listOfNotNull(e.user?.displayName, e.body).joinToString(" · "), style = Type.caption, color = p.text3, maxLines = 2)
            }
            Spacer(Modifier.width(8.dp))
            Text(Fmt.clock(e.createdAt), style = Type.caption, color = p.text3)
        }
        if (divider) Box(Modifier.fillMaxWidth().padding(start = 66.dp).height(1.dp).background(p.line))
    }
}

