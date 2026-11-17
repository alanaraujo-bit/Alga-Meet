package app.alga.admin.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
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
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import app.alga.admin.App
import app.alga.admin.data.AdminMe
import app.alga.admin.data.ApiException
import app.alga.admin.data.Servers
import app.alga.admin.ui.components.Segmented
import app.alga.admin.ui.components.pressable
import app.alga.admin.ui.errorText
import app.alga.admin.ui.theme.Type
import app.alga.admin.ui.theme.palette
import kotlinx.coroutines.launch

@Composable
fun LoginScreen(onLoggedIn: (AdminMe) -> Unit) {
    val app = App.get(LocalContext.current)
    val p = palette
    val scope = rememberCoroutineScope()
    var server by remember { mutableStateOf(if (app.session.server == Servers.PRODUCTION) "prod" else "qa") }
    var login by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun submit() {
        if (busy || login.isBlank() || password.isEmpty()) return
        busy = true
        error = null
        scope.launch {
            try {
                val token = app.api.login(if (server == "prod") Servers.PRODUCTION else Servers.QA_USB, login.trim(), password)
                app.session.token = token
                val me = try { app.api.me() } catch (e: ApiException) {
                    app.api.logout()
                    app.session.clear()
                    throw if (e.status == 403) ApiException(403, null, "Esta conta não é da equipe do Alga Meet.") else e
                }
                password = ""
                onLoggedIn(me)
            } catch (e: Exception) {
                error = errorText(e)
            } finally {
                busy = false
            }
        }
    }

    val fieldColors = OutlinedTextFieldDefaults.colors(
        focusedBorderColor = p.accent, unfocusedBorderColor = p.line, focusedContainerColor = p.surface, unfocusedContainerColor = p.surface,
        focusedTextColor = p.text, unfocusedTextColor = p.text, cursorColor = p.accent, focusedLabelColor = p.accent, unfocusedLabelColor = p.text3,
    )
    Column(
        Modifier.fillMaxSize().systemBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Spacer(Modifier.height(72.dp))
        Box(Modifier.size(52.dp).clip(RoundedCornerShape(16.dp)).background(Color(0xFF16172A)), contentAlignment = Alignment.Center) {
            Text("A", style = Type.title, color = Color(0xFFC9CBFF))
        }
        Spacer(Modifier.height(28.dp))
        Text("Alga Admin", style = Type.display, color = p.text)
        Spacer(Modifier.height(8.dp))
        Text("O painel da equipe do Alga Meet: dinheiro, crescimento, saúde e contas.", style = Type.body, color = p.text3)
        Spacer(Modifier.height(36.dp))
        Text("Servidor", style = Type.label, color = p.text3)
        Spacer(Modifier.height(8.dp))
        Segmented(listOf("qa" to "QA local (USB)", "prod" to "Produção"), server, { server = it })
        Spacer(Modifier.height(20.dp))
        OutlinedTextField(
            login, { login = it }, label = { Text("E-mail ou usuário") }, singleLine = true, shape = RoundedCornerShape(16.dp),
            colors = fieldColors, textStyle = Type.body, modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            password, { password = it }, label = { Text("Senha") }, singleLine = true, shape = RoundedCornerShape(16.dp),
            colors = fieldColors, textStyle = Type.body, modifier = Modifier.fillMaxWidth(),
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = { submit() }),
        )
        if (error != null) {
            Spacer(Modifier.height(14.dp))
            Text(error!!, style = Type.body, color = p.bad)
        }
        Spacer(Modifier.height(24.dp))
        Box(
            Modifier.fillMaxWidth().height(54.dp).clip(RoundedCornerShape(16.dp)).background(p.accentFill).pressable(::submit),
            contentAlignment = Alignment.Center,
        ) {
            if (busy) CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
            else Text("Entrar", style = Type.bodyStrong, color = Color.White)
        }
        Spacer(Modifier.height(16.dp))
        Text(
            if (server == "qa") "QA: a API do PC chega pelo cabo (adb reverse tcp:4340 tcp:4340). Dados de teste."
            else "Produção: só contas com papel de equipe entram. Cada consulta fica no registro de auditoria.",
            style = Type.caption, color = p.text3,
        )
        Spacer(Modifier.height(48.dp))
    }
}
