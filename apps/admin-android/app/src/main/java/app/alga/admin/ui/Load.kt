package app.alga.admin.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import app.alga.admin.App
import app.alga.admin.data.ApiException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.io.IOException

/** Last good value per key for the process: switching tabs or periods shows it at once while the fresh one loads. */
object Cache { val values = HashMap<String, Any>() }

class Loaded<T>(val data: T?, val error: String?, val loading: Boolean, val refresh: () -> Unit)

fun errorText(e: Throwable): String = when (e) {
    is ApiException -> e.message ?: "Erro ${e.status}"
    is IOException -> "Sem conexão com o servidor."
    else -> e.message ?: "Erro inesperado."
}

/**
 * Loads `block` for `key`, again on refresh(), on each push/stream event (App.bus) and every `everyMs` while the screen
 * is resumed. Errors keep the last good data on screen.
 */
@Suppress("UNCHECKED_CAST")
@Composable
fun <T : Any> rememberLoaded(key: String, everyMs: Long? = null, block: suspend () -> T): Loaded<T> {
    val app = App.get(LocalContext.current)
    var data by remember(key) { mutableStateOf(Cache.values[key] as T?) }
    var error by remember(key) { mutableStateOf<String?>(null) }
    var loading by remember(key) { mutableStateOf(true) }
    var tick by remember(key) { mutableIntStateOf(0) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(key, tick) {
        loading = true
        try {
            val v = block()
            Cache.values[key] = v
            data = v
            error = null
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            error = errorText(e)
        } finally {
            loading = false
        }
    }
    LaunchedEffect(key) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            launch { app.bus.collectLatest { tick++ } }
            if (everyMs != null) while (true) { delay(everyMs); tick++ }
        }
    }
    return Loaded(data, error, loading) { tick++ }
}

