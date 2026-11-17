package app.alga.admin.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.alga.admin.ui.theme.Type
import app.alga.admin.ui.theme.palette
import kotlin.math.abs

val CardShape = RoundedCornerShape(22.dp)

/** Press with body: scales to .97 and springs back. */
fun Modifier.pressable(onClick: () -> Unit): Modifier = composed {
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val s by animateFloatAsState(if (pressed) 0.97f else 1f, spring(dampingRatio = 0.7f, stiffness = 900f), label = "press")
    Modifier.graphicsLayer { scaleX = s; scaleY = s }.clickable(src, indication = null, onClick = onClick)
}

@Composable
fun Card(modifier: Modifier = Modifier, padding: Dp = 20.dp, onClick: (() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    val p = palette
    Column(
        modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.pressable(onClick) else Modifier)
            .clip(CardShape)
            .background(p.surface)
            .border(1.dp, p.line, CardShape)
            .padding(padding),
        content = content,
    )
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier, trailing: String? = null) {
    val p = palette
    Row(modifier.fillMaxWidth().padding(top = 28.dp, bottom = 12.dp, start = 4.dp, end = 4.dp), verticalAlignment = Alignment.Bottom) {
        Text(text, style = Type.title, color = p.text, modifier = Modifier.weight(1f))
        if (trailing != null) Text(trailing, style = Type.caption, color = p.text3)
    }
}

@Composable
fun Overline(text: String, color: Color = palette.text3) = Text(text.uppercase(), style = Type.overline, color = color)

/** "+12,4%" against the previous period, green up / red down; neutral when there is nothing to compare. */
@Composable
fun DeltaChip(now: Long, before: Long, label: String = "vs. período anterior", invert: Boolean = false) {
    val p = palette
    val d = Fmt.delta(now, before) ?: return
    val good = if (invert) d.second < 0 else d.second > 0
    val c = when { d.second == 0 -> p.text3; good -> p.good; else -> p.bad }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(d.first, style = Type.label.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold), color = c,
            modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(c.copy(alpha = 0.12f)).padding(horizontal = 7.dp, vertical = 3.dp))
        Spacer(Modifier.width(8.dp))
        Text(label, style = Type.caption, color = p.text3)
    }
}

/** A labeled number in a tile; `sub` is the quiet second line. */
@Composable
fun Metric(label: String, value: String, modifier: Modifier = Modifier, sub: String? = null, tone: Color? = null, onClick: (() -> Unit)? = null) {
    val p = palette
    Card(modifier, padding = 16.dp, onClick = onClick) {
        Text(label, style = Type.label, color = p.text3, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.height(10.dp))
        Text(value, style = Type.metric, color = tone ?: p.text, maxLines = 1)
        if (sub != null) {
            Spacer(Modifier.height(4.dp))
            Text(sub, style = Type.caption, color = p.text3, maxLines = 2)
        }
    }
}

@Composable
fun MetricRow(content: @Composable RowScope.() -> Unit) =
    Row(Modifier.fillMaxWidth().padding(bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), content = content)

/** Segmented choice (period, window). The selected pill slides its fill, no ripple. */
@Composable
fun Segmented(options: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
    val p = palette
    Row(
        modifier.clip(RoundedCornerShape(14.dp)).background(p.raised).padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        options.forEach { (key, label) ->
            val on = key == selected
            val bg by animateColorAsState(if (on) p.surface else Color.Transparent, tween(180), label = "seg")
            val fg by animateColorAsState(if (on) p.text else p.text3, tween(180), label = "segText")
            Box(
                Modifier.weight(1f).clip(RoundedCornerShape(11.dp)).background(bg)
                    .then(if (on && !p.dark) Modifier.border(1.dp, p.line, RoundedCornerShape(11.dp)) else Modifier)
                    .clickable(remember { MutableInteractionSource() }, null) { onSelect(key) }
                    .padding(vertical = 8.dp),
                contentAlignment = Alignment.Center,
            ) { Text(label, style = Type.label, color = fg, maxLines = 1) }
        }
    }
}

/** Hue of a person from their id (stable), as in the desktop's initials avatars. */
fun hueOf(id: String): Float {
    val hues = floatArrayOf(140f, 235f, 255f, 275f, 295f, 320f, 20f, 45f)
    return hues[abs(id.hashCode()) % hues.size]
}

@Composable
fun Avatar(name: String, id: String, size: Dp = 40.dp) {
    val p = palette
    val h = hueOf(id)
    val bg = Color.hsl(h, 0.32f, if (p.dark) 0.22f else 0.90f)
    val fg = Color.hsl(h, 0.45f, if (p.dark) 0.82f else 0.32f)
    val initials = name.trim().split(Regex("\\s+")).take(2).mapNotNull { it.firstOrNull()?.uppercaseChar() }.joinToString("").ifEmpty { "?" }
    Box(Modifier.size(size).clip(CircleShape).background(bg), contentAlignment = Alignment.Center) {
        Text(initials, style = Type.label.copy(fontSize = (size.value * 0.36f).sp), color = fg)
    }
}

@Composable
fun IconBadge(icon: ImageVector, tint: Color, size: Dp = 40.dp) {
    Box(Modifier.size(size).clip(RoundedCornerShape(13.dp)).background(tint.copy(alpha = 0.14f)), contentAlignment = Alignment.Center) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(size * 0.5f))
    }
}

@Composable
fun StatusDot(color: Color, pulse: Boolean = false, size: Dp = 8.dp) {
    val a = if (pulse) {
        val t = rememberInfiniteTransition(label = "pulse")
        t.animateFloat(1f, 0.35f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "a").value
    } else 1f
    Box(Modifier.size(size).graphicsLayer { alpha = a }.clip(CircleShape).background(color))
}

@Composable
fun Tag(text: String, color: Color) {
    Text(text, style = Type.caption.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Medium), color = color,
        modifier = Modifier.clip(RoundedCornerShape(7.dp)).background(color.copy(alpha = 0.13f)).padding(horizontal = 7.dp, vertical = 3.dp))
}

/** Label left, value right, hairline under (not after the last). */
@Composable
fun KeyValue(key: String, value: String, valueColor: Color? = null, divider: Boolean = true) {
    val p = palette
    Column {
        Row(Modifier.fillMaxWidth().padding(vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(key, style = Type.body, color = p.text2, modifier = Modifier.weight(1f))
            Text(value, style = Type.number, color = valueColor ?: p.text, maxLines = 1)
        }
        if (divider) Box(Modifier.fillMaxWidth().height(1.dp).background(p.line))
    }
}

/** Horizontal share bar (by product, uninstall reasons). */
@Composable
fun ShareBar(label: String, value: String, fraction: Float, color: Color = palette.accent) {
    val p = palette
    val f by animateFloatAsState(fraction.coerceIn(0f, 1f), tween(600), label = "share")
    Column(Modifier.padding(vertical = 8.dp)) {
        Row(Modifier.fillMaxWidth()) {
            Text(label, style = Type.body, color = p.text, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(value, style = Type.number, color = p.text2)
        }
        Spacer(Modifier.height(7.dp))
        Box(Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)).background(p.raised)) {
            Box(Modifier.fillMaxWidth(f).height(6.dp).clip(RoundedCornerShape(3.dp)).background(color))
        }
    }
}

/** Placeholder block while a screen loads (a soft shimmer, not a spinner). */
@Composable
fun Skeleton(modifier: Modifier) {
    val p = palette
    val t = rememberInfiniteTransition(label = "sk")
    val a by t.animateFloat(0.45f, 0.9f, infiniteRepeatable(tween(850), RepeatMode.Reverse), label = "ska")
    Box(modifier.graphicsLayer { alpha = a }.clip(RoundedCornerShape(14.dp)).background(p.raised))
}

@Composable
fun ErrorCard(message: String, onRetry: () -> Unit) {
    val p = palette
    Card {
        Text("Não foi possível carregar", style = Type.bodyStrong, color = p.text)
        Spacer(Modifier.height(6.dp))
        Text(message, style = Type.body, color = p.text3)
        Spacer(Modifier.height(14.dp))
        Text("Tentar de novo", style = Type.bodyStrong, color = p.accent, modifier = Modifier.pressable(onRetry).padding(vertical = 4.dp))
    }
}
