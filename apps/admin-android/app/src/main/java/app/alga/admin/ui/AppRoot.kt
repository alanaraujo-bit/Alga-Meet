package app.alga.admin.ui

import android.Manifest
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.MonitorHeart
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.ShowChart
import androidx.compose.material.icons.rounded.Group
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.MonitorHeart
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.ShowChart
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.alga.admin.App
import app.alga.admin.data.AdminMe
import app.alga.admin.data.ApiException
import app.alga.admin.push.Push
import app.alga.admin.ui.components.Avatar
import app.alga.admin.ui.components.LocalHaze
import app.alga.admin.ui.components.Tag
import app.alga.admin.ui.components.glass
import app.alga.admin.ui.screens.AlertsScreen
import app.alga.admin.ui.screens.FeedbackScreen
import app.alga.admin.ui.screens.GrowthScreen
import app.alga.admin.ui.screens.HealthScreen
import app.alga.admin.ui.screens.HomeScreen
import app.alga.admin.ui.screens.LoginScreen
import app.alga.admin.ui.screens.PeopleScreen
import app.alga.admin.ui.screens.SettingsScreen
import app.alga.admin.ui.screens.UserScreen
import app.alga.admin.ui.theme.Type
import app.alga.admin.ui.theme.palette
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.hazeSource
import kotlinx.coroutines.launch

sealed interface Route {
    data class User(val id: String) : Route
    data object Settings : Route
    data object Feedback : Route
}

/** What every screen needs from the shell. */
class Nav(val me: AdminMe, val push: (Route) -> Unit, val back: () -> Unit, val logout: () -> Unit)

val LocalNav = staticCompositionLocalOf<Nav> { error("no nav") }

private data class Tab(val key: String, val label: String, val title: String, val icon: ImageVector, val iconOn: ImageVector, val adminOnly: Boolean = false)

private val TABS = listOf(
    Tab("home", "Início", "Dinheiro", Icons.Outlined.Home, Icons.Rounded.Home, adminOnly = true),
    Tab("growth", "Uso", "Uso e crescimento", Icons.Outlined.ShowChart, Icons.Rounded.ShowChart, adminOnly = true),
    Tab("health", "Saúde", "Saúde do sistema", Icons.Outlined.MonitorHeart, Icons.Rounded.MonitorHeart),
    Tab("people", "Contas", "Contas", Icons.Outlined.Group, Icons.Rounded.Group),
    Tab("alerts", "Alertas", "Alertas", Icons.Outlined.Notifications, Icons.Rounded.Notifications),
)

/** Content insets under the floating glass bars. */
data class Chrome(val top: Dp, val bottom: Dp)
val LocalChrome = staticCompositionLocalOf { Chrome(0.dp, 0.dp) }

@Composable
fun AppRoot(locked: Boolean, onUnlock: () -> Unit, openTab: MutableState<String?>) {
    val app = App.get(LocalContext.current)
    var token by remember { mutableStateOf(app.session.token) }
    var me by remember { mutableStateOf<AdminMe?>(null) }
    var meError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val p = palette

    fun logout() {
        scope.launch {
            app.api.logout()
            Push.setOnCall(app, false)
            Push.cancelHealthCheck(app)
            app.session.clear()
            Cache.values.clear()
            me = null
            token = null
        }
    }

    Box(Modifier.fillMaxSize().background(p.bg)) {
        when {
            token == null -> LoginScreen(onLoggedIn = { m -> me = m; token = app.session.token })
            locked -> LockScreen(onUnlock)
            me == null -> {
                LaunchedEffect(token) {
                    try {
                        me = app.api.me()
                    } catch (e: Exception) {
                        // A revoked session or an account that stopped being staff: back to the login.
                        if (e is ApiException && (e.status == 401 || e.status == 403)) { app.session.clear(); token = null } else meError = errorText(e)
                    }
                }
                Splash(meError) { meError = null; token = app.session.token; me = null }
            }
            else -> Shell(me!!, openTab, ::logout)
        }
    }
}

@Composable
private fun Shell(me: AdminMe, openTab: MutableState<String?>, logout: () -> Unit) {
    val app = App.get(LocalContext.current)
    val p = palette
    val tabs = TABS.filter { me.isAdmin || !it.adminOnly }
    var tab by rememberSaveable { mutableStateOf(tabs.first().key) }
    val stack = remember { mutableStateListOf<Route>() }
    val haze = remember { HazeState() }
    val notifyPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}

    LaunchedEffect(openTab.value) {
        openTab.value?.let { t -> if (tabs.any { it.key == t }) { tab = t; stack.clear() } }
        openTab.value = null
    }
    LaunchedEffect(Unit) {
        notifyPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        runCatching { Push.register(app) }
        Push.scheduleHealthCheck(app)
    }
    BackHandler(enabled = stack.isNotEmpty() || tab != tabs.first().key) {
        if (stack.isNotEmpty()) stack.removeAt(stack.lastIndex) else tab = tabs.first().key
    }

    val nav = remember(me) { Nav(me, { stack.add(it) }, { if (stack.isNotEmpty()) stack.removeAt(stack.lastIndex) }, logout) }
    val status = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
    val navBar = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    val chrome = Chrome(top = status + 64.dp, bottom = navBar + 96.dp)

    CompositionLocalProvider(LocalNav provides nav, LocalHaze provides haze, LocalChrome provides chrome) {
        val route = stack.lastOrNull()
        AnimatedContent(
            targetState = route,
            transitionSpec = {
                val forward = targetState != null && (initialState == null || stack.size > 1)
                if (forward) (slideInHorizontally(tween(320)) { it / 3 } + fadeIn(tween(220))) togetherWith (slideOutHorizontally(tween(320)) { -it / 8 } + fadeOut(tween(160)))
                else (slideInHorizontally(tween(320)) { -it / 8 } + fadeIn(tween(220))) togetherWith (slideOutHorizontally(tween(320)) { it / 3 } + fadeOut(tween(160)))
            },
            label = "route",
        ) { r ->
            when (r) {
                null -> Box(Modifier.fillMaxSize()) {
                    Box(Modifier.fillMaxSize().hazeSource(haze)) {
                        AnimatedContent(tab, transitionSpec = { fadeIn(tween(180)) togetherWith fadeOut(tween(120)) }, label = "tab") { t ->
                            when (t) {
                                "home" -> HomeScreen()
                                "growth" -> GrowthScreen()
                                "health" -> HealthScreen()
                                "people" -> PeopleScreen()
                                else -> AlertsScreen()
                            }
                        }
                    }
                    TopBar(tabs.first { it.key == tab }.title, me) { stack.add(Route.Settings) }
                    TabBar(tabs, tab) { tab = it }
                }
                is Route.User -> UserScreen(r.id)
                Route.Settings -> SettingsScreen()
                Route.Feedback -> FeedbackScreen()
            }
        }
    }
}

@Composable
private fun TopBar(title: String, me: AdminMe, onSettings: () -> Unit) {
    val p = palette
    Row(
        Modifier.fillMaxWidth().glass(RoundedCornerShape(0.dp), strong = true).windowInsetsPadding(WindowInsets.statusBars)
            .height(64.dp).padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, style = Type.title, color = p.text, modifier = Modifier.weight(1f))
        if (me.env != "production") {
            Tag("QA", p.warn)
            Spacer(Modifier.width(12.dp))
        }
        Box(Modifier.clip(CircleShape).clickable(onClick = onSettings)) { Avatar(me.displayName, me.id, 34.dp) }
    }
}

@Composable
private fun BoxScope.TabBar(tabs: List<Tab>, selected: String, onSelect: (String) -> Unit) {
    val p = palette
    Row(
        Modifier.align(Alignment.BottomCenter).windowInsetsPadding(WindowInsets.navigationBars).padding(horizontal = 16.dp, vertical = 12.dp)
            .fillMaxWidth().height(68.dp).glass(RoundedCornerShape(26.dp), strong = true).padding(horizontal = 6.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        tabs.forEach { t ->
            val on = t.key == selected
            Column(
                Modifier.weight(1f).clip(RoundedCornerShape(20.dp))
                    .background(if (on) p.accentSoft else androidx.compose.ui.graphics.Color.Transparent)
                    .clickable(remember { MutableInteractionSource() }, null) { onSelect(t.key) }
                    .padding(vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Icon(if (on) t.iconOn else t.icon, t.label, tint = if (on) p.accent else p.text3, modifier = Modifier.size(22.dp))
                Spacer(Modifier.height(3.dp))
                Text(t.label, style = Type.caption.copy(fontSize = androidx.compose.ui.unit.TextUnit(10.5f, androidx.compose.ui.unit.TextUnitType.Sp)), color = if (on) p.accent else p.text3, maxLines = 1)
            }
        }
    }
}

@Composable
private fun LockScreen(onUnlock: () -> Unit) {
    val p = palette
    Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Icon(Icons.Rounded.Lock, null, tint = p.accent, modifier = Modifier.size(40.dp))
        Spacer(Modifier.height(20.dp))
        Text("Alga Admin bloqueado", style = Type.title, color = p.text)
        Spacer(Modifier.height(8.dp))
        Text("Use a digital ou o PIN do celular para ver os números.", style = Type.body, color = p.text3)
        Spacer(Modifier.height(28.dp))
        Text("Desbloquear", style = Type.bodyStrong, color = p.accent, modifier = Modifier.clip(RoundedCornerShape(14.dp)).clickable(onClick = onUnlock).padding(horizontal = 18.dp, vertical = 12.dp))
    }
}

@Composable
private fun Splash(error: String?, retry: () -> Unit) {
    val p = palette
    Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        if (error == null) Text("Conectando…", style = Type.body, color = p.text3)
        else {
            Text(error, style = Type.body, color = p.text2)
            Spacer(Modifier.height(16.dp))
            Text("Tentar de novo", style = Type.bodyStrong, color = p.accent, modifier = Modifier.clickable(onClick = retry).padding(12.dp))
        }
    }
}

/** Padding for a scrolling screen under the glass bars. */
@Composable
fun screenPadding(): PaddingValues {
    val c = LocalChrome.current
    return PaddingValues(start = 16.dp, end = 16.dp, top = c.top + 8.dp, bottom = c.bottom + 16.dp)
}

