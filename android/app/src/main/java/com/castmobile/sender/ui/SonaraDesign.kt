package com.sonara.app.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * SONARA 2.0 — "Liquid Audio" Design System
 * 
 * Philosophy: The UI is alive. It breathes with the bass,
 * ripples with melodies, and flows like sound waves through air.
 * 
 * Core principles:
 * - Pure black OLED foundation (#000000)
 * - Accent colors that pulse and breathe
 * - Glass panels with depth (blur + gradient borders)
 * - Organic shapes (pill, squircle, blob)
 * - Motion as interface
 */
object LiquidDesign {
    // ─── Foundation ──────────────────────────────────────────────
    val Void = Color(0xFF000000)           // Pure black OLED
    val DeepSpace = Color(0xFF050508)      // Almost black with blue tint
    val Abyss = Color(0xFF0A0A0F)          // Surface level 1
    val Nebula = Color(0xFF121218)         // Surface level 2
    val Stardust = Color(0xFF1A1A24)       // Surface level 3
    val Moonlight = Color(0xFF252530)      // Elevated surface

    // ─── Glass ──────────────────────────────────────────────────
    val GlassUltraThin = Color(0xFFFFFFFF).copy(alpha = 0.02f)
    val GlassThin = Color(0xFFFFFFFF).copy(alpha = 0.04f)
    val GlassMedium = Color(0xFFFFFFFF).copy(alpha = 0.06f)
    val GlassThick = Color(0xFFFFFFFF).copy(alpha = 0.10f)
    val GlassBorder = Color(0xFFFFFFFF).copy(alpha = 0.08f)
    val GlassBorderActive = Color(0xFFFFFFFF).copy(alpha = 0.15f)

    // ─── Text Hierarchy ─────────────────────────────────────────
    val TextPrimary = Color(0xFFFFFFFF)
    val TextSecondary = Color(0xFFFFFFFF).copy(alpha = 0.70f)
    val TextTertiary = Color(0xFFFFFFFF).copy(alpha = 0.45f)
    val TextGhost = Color(0xFFFFFFFF).copy(alpha = 0.25f)

    // ─── Accent Palette (defaults, overridden by ThemeViewModel) ─
    val AccentPrimary = Color(0xFFFF2D95)      // Hot pink
    val AccentSecondary = Color(0xFF7C4DFF)    // Electric purple
    val AccentTertiary = Color(0xFF00E5FF)     // Cyan
    val AccentSuccess = Color(0xFF00E676)
    val AccentWarning = Color(0xFFFFAB00)
    val AccentDanger = Color(0xFFFF3D00)

    // ─── Gradients ──────────────────────────────────────────────
    fun primaryGradient(primary: Color) = Brush.horizontalGradient(
        colors = listOf(primary, primary.copy(alpha = 0.6f))
    )
    
    fun glassGradient() = Brush.verticalGradient(
        colors = listOf(
            Color.White.copy(alpha = 0.06f),
            Color.White.copy(alpha = 0.02f)
        )
    )
    
    fun auroraGradient(primary: Color, secondary: Color) = Brush.sweepGradient(
        colors = listOf(
            primary.copy(alpha = 0.4f),
            secondary.copy(alpha = 0.3f),
            primary.copy(alpha = 0.1f),
            secondary.copy(alpha = 0.2f),
            primary.copy(alpha = 0.4f)
        )
    )
    
    fun deepGlowGradient(primary: Color) = Brush.radialGradient(
        colors = listOf(
            primary.copy(alpha = 0.25f),
            primary.copy(alpha = 0.05f),
            Color.Transparent
        )
    )

    // ─── Shapes ─────────────────────────────────────────────────
    val PillShape = RoundedCornerShape(100.dp)
    val SquircleShape = RoundedCornerShape(28.dp)
    val CardShape = RoundedCornerShape(24.dp)
    val ButtonShape = RoundedCornerShape(20.dp)
    val InputShape = RoundedCornerShape(16.dp)
    val MiniShape = RoundedCornerShape(12.dp)
    val TagShape = RoundedCornerShape(8.dp)

    // ─── Dimensions ─────────────────────────────────────────────
    val SpacingXs = 4.dp
    val SpacingSm = 8.dp
    val SpacingMd = 16.dp
    val SpacingLg = 24.dp
    val SpacingXl = 32.dp
    val SpacingXxl = 48.dp

    // ─── Typography ─────────────────────────────────────────────
    val DisplayLarge = 48.sp
    val DisplayMedium = 36.sp
    val HeadlineLarge = 28.sp
    val HeadlineMedium = 22.sp
    val TitleLarge = 18.sp
    val TitleMedium = 16.sp
    val BodyLarge = 16.sp
    val BodyMedium = 14.sp
    val BodySmall = 12.sp
    val LabelLarge = 14.sp
    val LabelMedium = 12.sp
    val LabelSmall = 10.sp

    // ─── Animation Specs ────────────────────────────────────────
    val Instant = spring<Float>(stiffness = Spring.StiffnessHigh)
    val Quick = spring<Float>(dampingRatio = 0.7f, stiffness = Spring.StiffnessMedium)
    val Fluid = spring<Float>(dampingRatio = 0.8f, stiffness = Spring.StiffnessLow)
    val Breathy = tween<Float>(durationMillis = 1200, easing = EaseInOutSine)
    
    val PulseAnimation = infiniteRepeatable<Float>(
        animation = tween(2000, easing = EaseInOutSine),
        repeatMode = RepeatMode.Reverse
    )
    
    val SlowPulse = infiniteRepeatable<Float>(
        animation = tween(3000, easing = EaseInOutSine),
        repeatMode = RepeatMode.Reverse
    )

    // ─── Elevation (Glow based, not shadow) ─────────────────────
    val GlowSm = 8.dp
    val GlowMd = 16.dp
    val GlowLg = 32.dp
    val GlowXl = 64.dp
}

/**
 * Liquid motion system - organic, breathing animations
 */
object LiquidMotion {
    val PopIn = spring<Float>(dampingRatio = 0.6f, stiffness = Spring.StiffnessMedium)
    val SlideUp = spring<Float>(dampingRatio = 0.85f, stiffness = Spring.StiffnessLow)
    val Elastic = spring<Float>(dampingRatio = 0.4f, stiffness = Spring.StiffnessLow)
    val Smooth = tween<Float>(300, easing = EaseInOutCubic)
    val SmoothSize = tween<IntSize>(300, easing = EaseInOutCubic)
    val Bounce = keyframes<Float> {
        durationMillis = 500
        0f at 0 with EaseOut
        1.15f at 250 with EaseOut
        0.95f at 380 with EaseOut
        1f at 500
    }
}

// Easing functions
private val EaseInOutSine = CubicBezierEasing(0.37f, 0f, 0.63f, 1f)
private val EaseInOutCubic = CubicBezierEasing(0.65f, 0f, 0.35f, 1f)
private val EaseOut = CubicBezierEasing(0f, 0f, 0.3f, 1f)

/**
 * Extension modifiers for the Liquid design system
 */
fun Modifier.liquidGlow(color: Color, radius: Int = 20): Modifier = this.drawBehind {
    drawCircle(
        brush = Brush.radialGradient(
            colors = listOf(color.copy(alpha = 0.3f), Color.Transparent),
            radius = radius * density
        ),
        radius = radius * density
    )
}

fun Modifier.glassPanel(
    cornerRadius: Int = 24,
    alpha: Float = 0.04f
): Modifier = this
    .clip(RoundedCornerShape(cornerRadius.dp))
    .background(Color.White.copy(alpha = alpha))
    .border(1.dp, Color.White.copy(alpha = 0.08f), RoundedCornerShape(cornerRadius.dp))

fun Modifier.pulseGlow(color: Color, intensity: Float): Modifier = this.drawBehind {
    drawCircle(
        brush = Brush.radialGradient(
            colors = listOf(
                color.copy(alpha = 0.2f * intensity),
                Color.Transparent
            ),
            radius = size.maxDimension * 0.8f
        ),
        radius = size.maxDimension * 0.5f
    )
}
