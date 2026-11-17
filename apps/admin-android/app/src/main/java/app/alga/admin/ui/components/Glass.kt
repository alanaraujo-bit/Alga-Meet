package app.alga.admin.ui.components

import androidx.compose.foundation.border
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.dp
import app.alga.admin.ui.theme.palette
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.HazeStyle
import dev.chrisbanes.haze.HazeTint
import dev.chrisbanes.haze.hazeEffect

/**
 * Liquid glass, used only where content scrolls under chrome (top bar, tab bar, floating controls): a real backdrop
 * blur of what is behind (Haze, RenderEffect on Android 12+), a tint so text keeps its contrast, and a light rim that
 * is brighter at the top edge, like light caught on the glass. Cards stay solid: glass on glass reads as noise.
 */
val LocalHaze = staticCompositionLocalOf { HazeState() }

@Composable
fun Modifier.glass(shape: Shape = RoundedCornerShape(24.dp), strong: Boolean = false): Modifier {
    val p = palette
    val style = HazeStyle(
        backgroundColor = p.bg,
        tints = listOf(HazeTint(if (strong) p.glass.copy(alpha = (p.glass.alpha + 0.12f).coerceAtMost(1f)) else p.glass)),
        blurRadius = 28.dp,
        noiseFactor = 0.04f,
    )
    val rim = Brush.verticalGradient(
        listOf(Color.White.copy(alpha = if (p.dark) 0.16f else 0.70f), Color.White.copy(alpha = if (p.dark) 0.04f else 0.25f)),
    )
    return this
        .clip(shape)
        .hazeEffect(state = LocalHaze.current, style = style)
        .border(1.dp, rim, shape)
}
