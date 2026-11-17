package app.alga.admin.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import app.alga.admin.App
import app.alga.admin.ui.LocalNav
import app.alga.admin.ui.Route
import app.alga.admin.ui.components.Avatar
import app.alga.admin.ui.components.Card
import app.alga.admin.ui.components.ErrorCard
import app.alga.admin.ui.components.Fmt
import app.alga.admin.ui.components.Skeleton
import app.alga.admin.ui.components.Tag
import app.alga.admin.ui.rememberLoaded
import app.alga.admin.ui.theme.Type
import app.alga.admin.ui.theme.palette

private val FEEDBACK_KIND = mapOf("bug" to "Erro", "crash" to "Travou", "idea" to "Ideia", "praise" to "Elogio", "other" to "Outro")

@Composable
fun FeedbackScreen() {
    val app = App.get(LocalContext.current)
    val p = palette
    val nav = LocalNav.current
    val load = rememberLoaded("feedback") { app.api.feedback() }
    DetailScaffold("Conta pro Eco") {
        val list = load.data
        if (list == null) {
            item { if (load.error != null) ErrorCard(load.error, load.refresh) else Skeleton(Modifier.fillMaxWidth().height(300.dp)) }
            return@DetailScaffold
        }
        if (list.isEmpty()) item { Card { Text("Ninguém mandou relato ainda.", style = Type.body, color = p.text3) } }
        list.forEach { f ->
            item(key = f.id) {
                Card(Modifier.padding(bottom = 12.dp), onClick = { nav.push(Route.User(f.user.id)) }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Avatar(f.user.displayName, f.user.id, 34.dp)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(f.user.displayName, style = Type.bodyStrong, color = p.text, maxLines = 1)
                            Text("${Fmt.ago(f.createdAt)}${f.client?.let { " · app $it" } ?: ""}", style = Type.caption, color = p.text3, maxLines = 1)
                        }
                        Tag(FEEDBACK_KIND[f.kind] ?: f.kind, if (f.kind == "bug" || f.kind == "crash") p.warn else p.accent)
                    }
                    Spacer(Modifier.height(12.dp))
                    Text(f.text, style = Type.body, color = p.text2)
                    if (f.hasScreenshot) { Spacer(Modifier.height(8.dp)); Text("Com captura de tela (ver no servidor).", style = Type.caption, color = p.text3) }
                }
            }
        }
    }
}
