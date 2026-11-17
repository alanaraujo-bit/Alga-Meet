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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.alga.admin.App
import app.alga.admin.data.UserSummary
import app.alga.admin.ui.LocalNav
import app.alga.admin.ui.Route
import app.alga.admin.ui.components.Avatar
import app.alga.admin.ui.components.Card
import app.alga.admin.ui.components.Fmt
import app.alga.admin.ui.components.SectionTitle
import app.alga.admin.ui.components.Tag
import app.alga.admin.ui.components.pressable
import app.alga.admin.ui.errorText
import app.alga.admin.ui.rememberLoaded
import app.alga.admin.ui.screenPadding
import app.alga.admin.ui.theme.Palette
import app.alga.admin.ui.theme.Type
import app.alga.admin.ui.theme.palette
import kotlinx.coroutines.delay

@Composable
fun PeopleScreen() {
    val app = App.get(LocalContext.current)
    val p = palette
    var q by rememberSaveable { mutableStateOf("") }
    var results by remember { mutableStateOf<List<UserSummary>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(q) {
        if (q.isBlank()) { results = null; error = null; return@LaunchedEffect }
        delay(280)
        try { results = app.api.search(q.trim()); error = null } catch (e: Exception) { if (e is kotlinx.coroutines.CancellationException) throw e; error = errorText(e) }
    }
    val recent = rememberLoaded("recent-signups") { app.api.events().filter { it.kind == "signup" && it.user != null } }

    LazyColumn(contentPadding = screenPadding(), modifier = Modifier.fillMaxSize()) {
        item {
            Row(
                Modifier.fillMaxWidth().height(52.dp).background(p.surface, RoundedCornerShape(16.dp)).padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Rounded.Search, null, tint = p.text3, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(12.dp))
                Box(Modifier.weight(1f)) {
                    if (q.isEmpty()) Text("Nome, @usuário, e-mail ou id", style = Type.body, color = p.text3)
                    BasicTextField(
                        q, { q = it }, singleLine = true, textStyle = Type.body.copy(color = p.text), cursorBrush = SolidColor(p.accent),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
        if (error != null) item { Text(error!!, style = Type.body, color = p.bad, modifier = Modifier.padding(12.dp)) }
        val list = results
        if (list != null) {
            item { SectionTitle(if (list.isEmpty()) "Ninguém encontrado" else "Resultados", trailing = if (list.size == 30) "os 30 primeiros" else null) }
            if (list.isNotEmpty()) item { Card(padding = 6.dp) { list.forEachIndexed { i, u -> PersonRow(u.id, u.displayName, "@${u.username} · ${u.email}", u, i < list.lastIndex) } } }
        } else {
            val signups = recent.data.orEmpty()
            item { SectionTitle("Cadastros recentes") }
            item {
                Card(padding = 6.dp) {
                    if (signups.isEmpty()) Text(if (recent.loading) "Carregando…" else "Nenhum cadastro registrado ainda.", style = Type.body, color = p.text3, modifier = Modifier.padding(16.dp))
                    signups.take(20).forEachIndexed { i, e -> PersonRow(e.user!!.id, e.user.displayName, "@${e.user.username} · ${Fmt.ago(e.createdAt)}", null, i < minOf(20, signups.size) - 1) }
                }
            }
        }
    }
}

fun stateTag(state: String, p: Palette): Pair<String, androidx.compose.ui.graphics.Color>? = when (state) {
    "banned" -> "Banida" to p.bad
    "suspended" -> "Suspensa" to p.warn
    "deleting" -> "Excluindo" to p.text3
    else -> null
}

@Composable
private fun PersonRow(id: String, name: String, sub: String, u: UserSummary?, divider: Boolean) {
    val p = palette
    val nav = LocalNav.current
    Column {
        Row(Modifier.fillMaxWidth().pressable { nav.push(Route.User(id)) }.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar(name, id, 42.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(name, style = Type.bodyStrong, color = p.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(sub, style = Type.caption, color = p.text3, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (u != null) {
                stateTag(u.state, p)?.let { (t, c) -> Spacer(Modifier.width(6.dp)); Tag(t, c) }
                if (u.plan == "plus") { Spacer(Modifier.width(6.dp)); Tag("Plus", p.accent) }
                if (u.staffRole != null) { Spacer(Modifier.width(6.dp)); Tag("Equipe", p.good) }
            }
        }
        if (divider) Box(Modifier.fillMaxWidth().padding(start = 68.dp).height(1.dp).background(p.line))
    }
}
