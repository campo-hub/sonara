package com.castmobile.sender.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlin.math.*

/**
 * Splash Screen - matches reference exactly
 * - Dark background with purple/pink glow at top
 * - Circular logo with neon rings and waveform
 * - "SONARA" wide letter spacing
 * - "Feel the Sound. Live the Vibe."
 * - Gradient progress bar
 */
@Composable
fun SplashView(themeViewModel: ThemeViewModel, onFinish: () -> Unit) {
    var startAnims by remember { mutableStateOf(false) }
    val infiniteTransition = rememberInfiniteTransition(label = "Splash")
    
    // Glow pulse
    val glowScale by infiniteTransition.animateFloat(
        initialValue = 0.9f,
        targetValue = 1.1f,
        animationSpec = infiniteRepeatable(tween(2500), RepeatMode.Reverse),
        label = "glow"
    )
    
    // Waveform rotation
    val waveRotation by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(8000, easing = LinearEasing)),
        label = "waveRotation"
    )

    LaunchedEffect(Unit) {
        startAnims = true
        delay(3500)
        onFinish()
    }

    Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
        // Theme-colored glow at top
        Canvas(modifier = Modifier.fillMaxSize()) {
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(
                        themeViewModel.primary.copy(alpha = 0.25f),
                        themeViewModel.secondary.copy(alpha = 0.1f),
                        Color.Transparent
                    ),
                    center = Offset(size.width * 0.5f, size.height * 0.25f),
                    radius = size.maxDimension * 0.5f
                ),
                center = Offset(size.width * 0.5f, size.height * 0.25f),
                radius = size.maxDimension * 0.5f
            )
        }

        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(Modifier.height(120.dp))
            
            // Logo with neon rings and waveform
            Box(contentAlignment = Alignment.Center) {
                // Outer glow
                Box(
                    modifier = Modifier
                        .size(180.dp)
                        .scale(glowScale)
                        .blur(50.dp)
                        .background(
                            Brush.sweepGradient(
                                listOf(
                                    themeViewModel.primary.copy(alpha = 0.4f),
                                    themeViewModel.secondary.copy(alpha = 0.3f),
                                    themeViewModel.primary.copy(alpha = 0.2f),
                                    themeViewModel.primary.copy(alpha = 0.4f)
                                )
                            ),
                            CircleShape
                        )
                )
                
                // Concentric rings
                Canvas(modifier = Modifier.size(160.dp)) {
                    val center = Offset(size.width / 2, size.height / 2)
                    
                    // Ring 1 - outer
                    drawCircle(
                        color = themeViewModel.primary.copy(alpha = 0.3f),
                        radius = 75f,
                        style = Stroke(width = 1.5f, cap = StrokeCap.Round)
                    )
                    
                    // Ring 2 - middle
                    drawCircle(
                        color = themeViewModel.secondary.copy(alpha = 0.4f),
                        radius = 60f,
                        style = Stroke(width = 2f, cap = StrokeCap.Round)
                    )
                    
                    // Ring 3 - inner
                    drawCircle(
                        color = themeViewModel.primary.copy(alpha = 0.3f),
                        radius = 45f,
                        style = Stroke(width = 1.5f, cap = StrokeCap.Round)
                    )
                    
                    // Waveform lines inside
                    val lineCount = 12
                    for (i in 0 until lineCount) {
                        val angle = (i.toFloat() / lineCount * 360f + waveRotation) * (PI / 180f).toFloat()
                        val innerR = 15f
                        val outerR = 35f + (sin(angle * 3) * 10f)
                        
                        val start = Offset(
                            center.x + cos(angle) * innerR,
                            center.y + sin(angle) * innerR
                        )
                        val end = Offset(
                            center.x + cos(angle) * outerR,
                            center.y + sin(angle) * outerR
                        )
                        
                        drawLine(
                            color = Color.White.copy(alpha = 0.6f),
                            start = start,
                            end = end,
                            strokeWidth = 2f,
                            cap = StrokeCap.Round
                        )
                    }
                }
            }

            Spacer(Modifier.height(48.dp))
            
            // SONARA text
            Text(
                "SONARA",
                style = MaterialTheme.typography.displayMedium,
                fontWeight = FontWeight.Black,
                letterSpacing = 16.sp,
                color = Color.White
            )
            
            Spacer(Modifier.height(16.dp))
            
            // Tagline
            Text(
                "Feel the Sound. Live the Vibe.",
                style = MaterialTheme.typography.bodyLarge,
                color = Color.White.copy(alpha = 0.5f),
                letterSpacing = 1.sp
            )
            
            Spacer(Modifier.height(100.dp))
            
            // Loading section
            Text(
                "Loading your vibe...",
                style = MaterialTheme.typography.bodySmall,
                color = Color.White.copy(alpha = 0.3f)
            )
            
            Spacer(Modifier.height(12.dp))
            
            // Progress bar
            Box(
                modifier = Modifier
                    .width(200.dp)
                    .height(4.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(Color.White.copy(alpha = 0.08f))
            ) {
                val progress by animateFloatAsState(
                    if (startAnims) 1f else 0f,
                    tween(3000),
                    label = "progress"
                )
                Box(
                    modifier = Modifier
                        .fillMaxWidth(progress)
                        .fillMaxHeight()
                        .background(
                            Brush.horizontalGradient(
                                listOf(
                                    themeViewModel.primary,
                                    themeViewModel.secondary
                                )
                            )
                        )
                )
            }
        }
    }
}
