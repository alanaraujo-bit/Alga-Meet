package app.alga.admin.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import app.alga.admin.R

/**
 * Tokens from docs/design/design-system.md (dark: the app's own planes and the soft indigo accent H 279) with a light
 * counterpart for daytime. Semantic colors are rare and desaturated: money up is the only green on a screen.
 */
@Immutable
data class Palette(
    val bg: Color,
    val surface: Color,
    val raised: Color,
    val line: Color,
    val text: Color,
    val text2: Color,
    val text3: Color,
    val accent: Color,
    val accentFill: Color,
    val accentSoft: Color,
    val good: Color,
    val warn: Color,
    val bad: Color,
    val glass: Color,
    val glassEdge: Color,
    val dark: Boolean,
)

val DarkPalette = Palette(
    bg = Color(0xFF0B0B0C), surface = Color(0xFF131415), raised = Color(0xFF1A1B1D), line = Color(0x14FFFFFF),
    text = Color(0xFFF7F8F8), text2 = Color(0xFFC4CAD4), text3 = Color(0xFF8A8F98),
    accent = Color(0xFF8B8EF7), accentFill = Color(0xFF6163D0), accentSoft = Color(0x268B8EF7),
    good = Color(0xFF61C28E), warn = Color(0xFFE6B463), bad = Color(0xFFE66E68),
    glass = Color(0x6B141517), glassEdge = Color(0x1FFFFFFF), dark = true,
)

val LightPalette = Palette(
    bg = Color(0xFFF5F5F7), surface = Color(0xFFFFFFFF), raised = Color(0xFFF0F0F3), line = Color(0x14000000),
    text = Color(0xFF111216), text2 = Color(0xFF41454D), text3 = Color(0xFF6B7079),
    accent = Color(0xFF4F52C4), accentFill = Color(0xFF5154C9), accentSoft = Color(0x1A5154C9),
    good = Color(0xFF1E8A57), warn = Color(0xFFB07A12), bad = Color(0xFFC0443F),
    glass = Color(0x8CFFFFFF), glassEdge = Color(0x24FFFFFF), dark = false,
)

val LocalPalette = staticCompositionLocalOf { DarkPalette }

@OptIn(ExperimentalTextApi::class)
val Inter = FontFamily(
    Font(R.font.inter, FontWeight.Normal, variationSettings = FontVariation.Settings(FontVariation.weight(400))),
    Font(R.font.inter, FontWeight.Medium, variationSettings = FontVariation.Settings(FontVariation.weight(500))),
    Font(R.font.inter, FontWeight.SemiBold, variationSettings = FontVariation.Settings(FontVariation.weight(600))),
    Font(R.font.inter, FontWeight.Bold, variationSettings = FontVariation.Settings(FontVariation.weight(700))),
)

/** Tabular figures everywhere a number can change under the eye. */
private const val TNUM = "tnum, cv11"

object Type {
    val hero = TextStyle(fontFamily = Inter, fontWeight = FontWeight.SemiBold, fontSize = 44.sp, lineHeight = 48.sp, letterSpacing = (-1.2).sp, fontFeatureSettings = TNUM)
    val display = TextStyle(fontFamily = Inter, fontWeight = FontWeight.SemiBold, fontSize = 28.sp, lineHeight = 32.sp, letterSpacing = (-0.6).sp, fontFeatureSettings = TNUM)
    val title = TextStyle(fontFamily = Inter, fontWeight = FontWeight.SemiBold, fontSize = 20.sp, lineHeight = 26.sp, letterSpacing = (-0.3).sp)
    val metric = TextStyle(fontFamily = Inter, fontWeight = FontWeight.SemiBold, fontSize = 22.sp, lineHeight = 26.sp, letterSpacing = (-0.4).sp, fontFeatureSettings = TNUM)
    val body = TextStyle(fontFamily = Inter, fontWeight = FontWeight.Normal, fontSize = 15.sp, lineHeight = 21.sp, letterSpacing = (-0.1).sp)
    val bodyStrong = body.copy(fontWeight = FontWeight.Medium)
    val label = TextStyle(fontFamily = Inter, fontWeight = FontWeight.Medium, fontSize = 13.sp, lineHeight = 17.sp, letterSpacing = 0.sp)
    val caption = TextStyle(fontFamily = Inter, fontWeight = FontWeight.Normal, fontSize = 12.sp, lineHeight = 16.sp, fontFeatureSettings = TNUM)
    val number = TextStyle(fontFamily = Inter, fontWeight = FontWeight.Medium, fontSize = 15.sp, lineHeight = 20.sp, fontFeatureSettings = TNUM)
    val overline = TextStyle(fontFamily = Inter, fontWeight = FontWeight.SemiBold, fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 0.8.sp)
}

@Composable
fun AlgaTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val p = if (dark) DarkPalette else LightPalette
    val scheme = if (dark) {
        darkColorScheme(primary = p.accent, onPrimary = Color.White, background = p.bg, surface = p.surface, onSurface = p.text, onBackground = p.text, surfaceVariant = p.raised, outline = p.line, error = p.bad)
    } else {
        lightColorScheme(primary = p.accentFill, onPrimary = Color.White, background = p.bg, surface = p.surface, onSurface = p.text, onBackground = p.text, surfaceVariant = p.raised, outline = p.line, error = p.bad)
    }
    CompositionLocalProvider(LocalPalette provides p) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}

val palette: Palette @Composable get() = LocalPalette.current
