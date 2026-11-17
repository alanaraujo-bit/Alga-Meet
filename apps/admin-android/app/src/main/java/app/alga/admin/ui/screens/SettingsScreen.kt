package app.alga.admin.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import app.alga.admin.BuildConfig
import app.alga.admin.push.Push
import app.alga.admin.ui.LocalNav
import app.alga.admin.ui.components.Avatar
import app.alga.admin.ui.components.Card
import app.alga.admin.ui.components.KeyValue
import app.alga.admin.ui.components.SectionTitle
import app.alga.admin.ui.components.pressable
import app.alga.admin.ui.errorText
import app.alga.admin.ui.theme.Type
import app.alga.admin.ui.theme.palette
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen() {
    val app = App.get(LocalContext.current)
    val nav = LocalNav.current
    val me = nav.me
    val p = palette
    val scope = rememberCoroutineScope()
    val fcm = Push.firebaseReady(app)
    var muted by remember { mutableStateOf(app.session.mutedKinds) }
    var onCall by remember { mutableStateOf(app.session.onCall) }
    var lock by remember { mutableStateOf(app.session.biometricLock) }
    var testResult by remember { mutableStateOf<String?>(null) }

    fun saveKinds(next: Set<String>) {
        muted = next
        app.session.mutedKinds = next
        scope.launch { runCatching { Push.register(app) } }
    }

    DetailScaffold("Ajustes") {
        item {
            Card(padding = 20.dp) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Avatar(me.displayName, me.id, 52.dp)
                    Spacer(Modifier.width(14.dp))
                    Column {
                        Text(me.displayName, style = Type.title, color = p.text)
                        Text("@${me.username} · ${if (me.isAdmin) "administrador" else "moderação"}", style = Type.caption, color = p.text3)
                    }
                }
                Spacer(Modifier.height(14.dp))
                KeyValue("Servidor", app.session.server.removePrefix("https://").removePrefix("http://"))
                KeyValue("Ambiente", if (me.env == "production") "Produção" else "QA (dados de teste)", valueColor = if (me.env == "production") null else p.warn)
                KeyValue("API", "versão ${me.version}")
                KeyValue("App", "versão ${BuildConfig.VERSION_NAME}", divider = false)
            }
        }
        item { SectionTitle("Notificações") }
        item {
            Card {
                Text(
                    when {
                        fcm && me.push.fcm -> "Push pelo Firebase ligado: os avisos chegam na hora, mesmo com o app fechado."
                        fcm -> "O servidor não tem a chave do Firebase (FCM_SERVICE_ACCOUNT). Use o modo plantão enquanto isso."
                        else -> "Este app foi compilado sem o projeto Firebase. Use o modo plantão para receber na hora."
                    },
                    style = Type.body, color = p.text2,
                )
                Spacer(Modifier.height(12.dp))
                Toggle("Modo plantão", "Mantém uma conexão direta com o servidor e mostra um aviso fixo discreto. Gasta um pouco mais de bateria.", onCall) {
                    onCall = it
                    Push.setOnCall(app, it)
                }
                Toggle("Bloquear com digital", "Pede a digital ou o PIN ao abrir e depois de 1 minuto fora.", lock) {
                    lock = it
                    app.session.biometricLock = it
                }
                Spacer(Modifier.height(8.dp))
                Box(
                    Modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(14.dp)).background(p.raised).pressable {
                        testResult = "Enviando…"
                        scope.launch {
                            testResult = try {
                                val r = app.api.testPush()
                                if (r.sent > 0) "Enviada: chegou em ${r.sent} ${if (r.sent > 1) "conexões" else "conexão"} deste aparelho." else "Nada recebeu: ligue o modo plantão (ou o Firebase) e tente de novo."
                            } catch (e: Exception) { errorText(e) }
                        }
                    },
                    contentAlignment = Alignment.Center,
                ) { Text("Enviar notificação de teste", style = Type.bodyStrong, color = p.text) }
                testResult?.let { Spacer(Modifier.height(8.dp)); Text(it, style = Type.caption, color = p.text3) }
            }
        }
        item { SectionTitle("O que avisar") }
        item {
            Card(padding = 12.dp) {
                Push.kinds.filter { me.isAdmin || it.first !in Push.moneyKinds }.forEach { (k, label) ->
                    Toggle(label, null, k !in muted) { on -> saveKinds(if (on) muted - k else muted + k) }
                }
            }
        }
        item {
            Spacer(Modifier.height(24.dp))
            Box(
                Modifier.fillMaxWidth().height(52.dp).clip(RoundedCornerShape(16.dp)).background(p.bad.copy(alpha = 0.12f)).pressable(nav.logout),
                contentAlignment = Alignment.Center,
            ) { Text("Sair desta conta", style = Type.bodyStrong, color = p.bad) }
            Spacer(Modifier.height(8.dp))
            Text("Sair encerra a sessão no servidor e para os avisos neste celular.", style = Type.caption, color = p.text3, modifier = Modifier.padding(horizontal = 4.dp))
        }
    }
}

@Composable
private fun Toggle(title: String, sub: String?, on: Boolean, onChange: (Boolean) -> Unit) {
    val p = palette
    Row(Modifier.fillMaxWidth().pressable { onChange(!on) }.padding(vertical = 10.dp, horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = Type.bodyStrong, color = p.text)
            if (sub != null) Text(sub, style = Type.caption, color = p.text3)
        }
        Spacer(Modifier.width(12.dp))
        Switch(
            on, onChange,
            colors = SwitchDefaults.colors(checkedTrackColor = p.accentFill, checkedThumbColor = Color.White, uncheckedTrackColor = p.raised, uncheckedBorderColor = p.line, uncheckedThumbColor = p.text3),
        )
    }
}
