package app.alga.admin.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.awaitHorizontalTouchSlopOrCancellation
import androidx.compose.foundation.gestures.horizontalDrag
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.alga.admin.data.Point
import app.alga.admin.ui.theme.Type
import app.alga.admin.ui.theme.palette
import kotlin.math.max
import kotlin.math.roundToInt

private val Ease = CubicBezierEasing(0.2f, 0f, 0f, 1f)

/**
 * Touch tracking shared by the charts: index under the finger while dragging sideways, null otherwise; a tick per new
 * index. A vertical drag is left to the list, so a chart never traps the scroll.
 */
private fun Modifier.scrub(count: Int, onIndex: (Int?) -> Unit, haptic: () -> Unit): Modifier = pointerInput(count) {
    fun at(x: Float): Int = if (count <= 1) 0 else (x / size.width * (count - 1)).roundToInt().coerceIn(0, count - 1)
    awaitEachGesture {
        val down = awaitFirstDown(requireUnconsumed = false)
        var last = -1
        val start = awaitHorizontalTouchSlopOrCancellation(down.id) { change, _ ->
            change.consume()
        } ?: return@awaitEachGesture
        last = at(start.position.x)
        onIndex(last)
        haptic()
        horizontalDrag(start.id) { c ->
            val i = at(c.position.x)
            if (i != last) { last = i; onIndex(i); haptic() }
            c.consume()
        }
        onIndex(null)
    }
}

private fun DrawScope.axisLabel(tm: TextMeasurer, text: String, x: Float, y: Float, style: TextStyle, alignEnd: Boolean = false, center: Boolean = false) {
    val r = tm.measure(text, style)
    val dx = when { alignEnd -> -r.size.width.toFloat(); center -> -r.size.width / 2f; else -> 0f }
    drawText(r, topLeft = Offset((x + dx).coerceIn(0f, size.width - r.size.width), y))
}

/**
 * Smooth area chart. Scrubbing reports the index so the caller's headline can show that point (the number above the
 * chart is the readout, as in a stock app); horizontal hairlines carry the scale on the right.
 */
@Composable
fun AreaChart(
    points: List<Point>,
    modifier: Modifier = Modifier,
    color: Color = palette.accent,
    height: Dp = 168.dp,
    axis: (Double) -> String = { Fmt.compact(it) },
    selected: Int? = null,
    onSelect: (Int?) -> Unit = {},
) {
    val p = palette
    val tm = rememberTextMeasurer()
    val haptic = LocalHapticFeedback.current
    val reveal = remember { Animatable(0f) }
    LaunchedEffect(points) { reveal.snapTo(0f); reveal.animateTo(1f, tween(700, easing = Ease)) }
    val labelStyle = Type.caption.copy(color = p.text3)
    Canvas(
        modifier.fillMaxWidth().height(height)
            .scrub(points.size, onSelect) { haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove) },
    ) {
        if (points.isEmpty()) return@Canvas
        val bottomPad = 22.dp.toPx()
        val h = size.height - bottomPad
        val maxV = max(points.maxOf { it.value }, 1.0)
        val top = niceCeil(maxV)
        // The scale label lives in a band above the top gridline, where the line can never reach.
        val band = 20.dp.toPx()
        val x = { i: Int -> if (points.size == 1) size.width / 2 else i * size.width / (points.size - 1) }
        val y = { v: Double -> (h - (v / top * (h - band))).toFloat() }
        for (f in listOf(0.0, 0.5, 1.0)) {
            val gy = y(top * f)
            drawLine(p.line, Offset(0f, gy), Offset(size.width, gy), 1.dp.toPx(), pathEffect = if (f == 0.0) null else PathEffect.dashPathEffect(floatArrayOf(4f, 6f)))
        }
        axisLabel(tm, axis(top), 0f, 0f, labelStyle)
        val line = Path()
        points.forEachIndexed { i, pt ->
            if (i == 0) line.moveTo(x(0), y(pt.value)) else {
                val x0 = x(i - 1); val x1 = x(i); val mid = (x0 + x1) / 2
                line.cubicTo(mid, y(points[i - 1].value), mid, y(pt.value), x1, y(pt.value))
            }
        }
        val area = Path().apply { addPath(line); lineTo(x(points.lastIndex), h); lineTo(x(0), h); close() }
        clipRect(right = size.width * reveal.value) {
            drawPath(area, Brush.verticalGradient(listOf(color.copy(alpha = if (p.dark) 0.30f else 0.20f), color.copy(alpha = 0f)), startY = 0f, endY = h))
            drawPath(line, color, style = Stroke(2.2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
        // X labels: first, middle, last.
        val idx = listOf(0, points.lastIndex / 2, points.lastIndex).distinct()
        idx.forEach { i -> axisLabel(tm, Fmt.bucket(points[i].t), x(i), h + 6.dp.toPx(), labelStyle, alignEnd = i == points.lastIndex && i != 0, center = i != 0 && i != points.lastIndex) }
        val s = selected ?: return@Canvas
        if (s !in points.indices) return@Canvas
        val sx = x(s); val sy = y(points[s].value)
        drawLine(p.text3.copy(alpha = 0.6f), Offset(sx, 0f), Offset(sx, h), 1.dp.toPx())
        drawCircle(p.surface, 7.dp.toPx(), Offset(sx, sy))
        drawCircle(color, 4.5.dp.toPx(), Offset(sx, sy))
    }
}

/** Vertical bars, the last one (today, this week) brighter; scrub like the area chart. */
@Composable
fun BarChart(
    points: List<Point>,
    modifier: Modifier = Modifier,
    color: Color = palette.accent,
    height: Dp = 132.dp,
    axis: (Double) -> String = { Fmt.compact(it) },
    selected: Int? = null,
    onSelect: (Int?) -> Unit = {},
) {
    val p = palette
    val tm = rememberTextMeasurer()
    val haptic = LocalHapticFeedback.current
    val grow = remember { Animatable(0f) }
    LaunchedEffect(points) { grow.snapTo(0f); grow.animateTo(1f, tween(650, easing = Ease)) }
    val labelStyle = Type.caption.copy(color = p.text3)
    Canvas(modifier.fillMaxWidth().height(height).scrub(points.size, onSelect) { haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove) }) {
        if (points.isEmpty()) return@Canvas
        val bottomPad = 22.dp.toPx()
        val h = size.height - bottomPad
        val top = niceCeil(max(points.maxOf { it.value }, 1.0))
        val slot = size.width / points.size
        val gap = (slot * 0.28f).coerceIn(1.dp.toPx(), 8.dp.toPx())
        val w = slot - gap
        drawLine(p.line, Offset(0f, h), Offset(size.width, h), 1.dp.toPx())
        axisLabel(tm, axis(top), size.width, 0f, labelStyle, alignEnd = true)
        drawLine(p.line, Offset(0f, 18.dp.toPx()), Offset(size.width, 18.dp.toPx()), 1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(4f, 6f)))
        val usable = h - 20.dp.toPx()
        points.forEachIndexed { i, pt ->
            val bh = (pt.value / top * usable).toFloat() * grow.value
            val c = when {
                selected == i -> color
                selected != null -> color.copy(alpha = 0.35f)
                i == points.lastIndex -> color
                else -> color.copy(alpha = 0.62f)
            }
            if (bh > 0f) drawRoundRect(c, Offset(i * slot + gap / 2, h - bh), Size(w, bh), CornerRadius(minOf(w / 2, 4.dp.toPx())))
        }
        val idx = listOf(0, points.lastIndex).distinct()
        idx.forEach { i -> axisLabel(tm, Fmt.bucket(points[i].t), i * slot + slot / 2, h + 6.dp.toPx(), labelStyle, alignEnd = i == points.lastIndex && i != 0, center = false) }
    }
}

/** The round number just above `v` (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × 10^n), so the scale reads cleanly and the line fills the chart. */
fun niceCeil(v: Double): Double {
    if (v <= 0) return 1.0
    val exp = Math.pow(10.0, Math.floor(Math.log10(v)))
    val f = v / exp
    val nice = listOf(1.0, 1.2, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0, 8.0, 10.0).first { f <= it + 1e-9 }
    return nice * exp
}

/** Selected index holder for a chart + its readout. */
@Composable
fun rememberSelection() = remember { mutableStateOf<Int?>(null) }
