package com.castmobile.sender.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.*

/**
 * Equalizer Screen - with presets below controls and optimized performance
 */
@Composable
fun LiquidEqualizer(
    viewModel: MainViewModel,
    themeViewModel: ThemeViewModel,
    onDismiss: () -> Unit
) {
    var selectedPreset by remember { mutableStateOf("Flat") }
    
    val presets = remember {
        listOf(
            "Flat", "Bass Boost", "Treble Boost", "Vocal",
            "Rock", "Pop", "Jazz", "Classical",
            "Dance", "Hip Hop", "Electronic", "Acoustic"
        )
    }
    
    // Callback to handle manual slider adjustments - resets preset to Flat
    val onManualAdjustment: () -> Unit = {
        if (selectedPreset != "Flat") {
            selectedPreset = "Flat"
            viewModel.applyPreset("Flat")
        }
    }
    
    androidx.compose.ui.window.Dialog(
        onDismissRequest = onDismiss,
        properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = Color(0xFF0E0E12)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .statusBarsPadding()
                    .navigationBarsPadding()
            ) {
                // Header
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Default.ArrowBack, contentDescription = null, tint = Color.White)
                    }
                    Text(
                        "Equalizer",
                        style = MaterialTheme.typography.headlineMedium,
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.weight(1f)
                    )
                    Switch(
                        checked = viewModel.isEqualizerEnabled,
                        onCheckedChange = { viewModel.toggleEqualizer(it) },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = Color.White,
                            checkedTrackColor = themeViewModel.primary,
                            uncheckedThumbColor = Color.Gray,
                            uncheckedTrackColor = Color(0xFF1A1A1E)
                        )
                    )
                }

                val contentAlpha by animateFloatAsState(
                    if (viewModel.isEqualizerEnabled) 1f else 0.4f,
                    label = "alpha"
                )

                // Main content - scrollable
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .alpha(contentAlpha)
                        .verticalScroll(rememberScrollState()),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    // dB labels
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 32.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("+12dB", color = Color.White.copy(alpha = 0.3f), fontSize = 10.sp)
                        Text("0dB", color = Color.White.copy(alpha = 0.3f), fontSize = 10.sp)
                        Text("-12dB", color = Color.White.copy(alpha = 0.3f), fontSize = 10.sp)
                    }
                    
                    Spacer(Modifier.height(8.dp))
                    
                    // EQ Sliders
                    val freqLabels = remember { listOf("Pre", "60", "230", "910", "3.6k", "14k") }
                    
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(280.dp)
                            .padding(horizontal = 8.dp),
                        horizontalArrangement = Arrangement.SpaceEvenly
                    ) {
                        // Preamp
                        StableEqSlider(
                            label = freqLabels[0],
                            value = viewModel.preampLevel,
                            onValueChange = { 
                                viewModel.setPreamp(it)
                                onManualAdjustment()
                            },
                            min = -12000f,
                            max = 12000f,
                            tint = themeViewModel.primary,
                            enabled = viewModel.isEqualizerEnabled
                        )
                        
                        // Bands 0-4
                        for (i in 0 until 5) {
                            val level = viewModel.eqLevels[i] ?: 0
                            StableEqSlider(
                                label = freqLabels[i + 1],
                                value = level.toFloat(),
                                onValueChange = { 
                                    viewModel.setEqLevel(i, it.toInt().toShort())
                                    onManualAdjustment()
                                },
                                min = -12000f,
                                max = 12000f,
                                tint = themeViewModel.primary,
                                enabled = viewModel.isEqualizerEnabled
                            )
                        }
                    }
                    
                    Spacer(Modifier.height(8.dp))
                    
                    // dB values
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp),
                        horizontalArrangement = Arrangement.SpaceEvenly
                    ) {
                        val preampDb = viewModel.preampLevel / 1000f
                        Text(
                            "${if (preampDb >= 0) "+" else ""}${String.format("%.1f", preampDb)}dB",
                            color = themeViewModel.primary,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold
                        )
                        for (i in 0 until 5) {
                            val level = (viewModel.eqLevels[i] ?: 0).toFloat() / 1000f
                            Text(
                                "${if (level >= 0) "+" else ""}${String.format("%.1f", level)}dB",
                                color = themeViewModel.primary,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                    
                    Spacer(Modifier.height(24.dp))
                    
                    // Presets label
                    Text(
                        "Presets",
                        color = Color.White.copy(alpha = 0.5f),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 24.dp)
                    )
                    
                    Spacer(Modifier.height(12.dp))
                    
                    // Presets grid - 3 columns
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 24.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        presets.chunked(3).forEach { row ->
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                row.forEach { preset ->
                                    PresetButton(
                                        preset = preset,
                                        isSelected = selectedPreset == preset,
                                        modifier = Modifier.weight(1f),
                                        onClick = {
                                            selectedPreset = preset
                                            viewModel.applyPreset(preset)
                                        },
                                        tint = themeViewModel.primary
                                    )
                                }
                                // Fill empty slots
                                repeat(3 - row.size) {
                                    Spacer(Modifier.weight(1f))
                                }
                            }
                        }
                    }
                    
                    Spacer(Modifier.height(32.dp))
                }
            }
        }
    }
}

@Composable
fun PresetButton(
    preset: String,
    isSelected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
    tint: Color
) {
    Surface(
        onClick = onClick,
        modifier = modifier.height(44.dp),
        shape = RoundedCornerShape(12.dp),
        color = if (isSelected) tint else Color(0xFF1A1A1E),
        border = BorderStroke(1.dp, if (isSelected) tint else Color.White.copy(alpha = 0.06f))
    ) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            Text(
                preset,
                color = if (isSelected) Color.White else Color.White.copy(alpha = 0.6f),
                fontSize = 12.sp,
                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                maxLines = 1
            )
        }
    }
}

/**
 * STABLE EQ Slider - Fixed version that doesn't fight with parent state
 * 
 * Key fix: Uses internal dragging state that only syncs to parent on drag end,
 * preventing infinite recomposition loops.
 */
@Composable
fun StableEqSlider(
    label: String,
    value: Float,
    onValueChange: (Float) -> Unit,
    min: Float = -12000f,
    max: Float = 12000f,
    tint: Color,
    enabled: Boolean
) {
    // Internal dragging value - only used during active drag
    var dragValue by remember { mutableFloatStateOf(value) }
    var isDragging by remember { mutableStateOf(false) }
    
    // Sync from parent only when NOT dragging
    LaunchedEffect(value) {
        if (!isDragging) {
            dragValue = value
        }
    }
    
    // The displayed value: use dragValue during drag, otherwise use parent value
    val displayValue = if (isDragging) dragValue else value
    
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.fillMaxHeight()
    ) {
        Text(
            label,
            color = if (enabled) Color.White.copy(alpha = 0.5f) else Color.Gray,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold
        )
        Spacer(Modifier.height(8.dp))
        
        Box(
            modifier = Modifier
                .weight(1f)
                .width(40.dp)
                .pointerInput(enabled) {
                    if (!enabled) return@pointerInput
                    detectVerticalDragGestures(
                        onDragStart = {
                            isDragging = true
                            dragValue = value // Start from current parent value
                        },
                        onDragEnd = {
                            isDragging = false
                            onValueChange(dragValue) // Commit final value
                        },
                        onVerticalDrag = { change, dragAmount ->
                            change.consume()
                            val heightPx = size.height.toFloat()
                            if (heightPx > 0) {
                                val range = max - min
                                val delta = (dragAmount / heightPx) * range
                                dragValue = (dragValue - delta).coerceIn(min, max)
                            }
                        }
                    )
                },
            contentAlignment = Alignment.Center
        ) {
            // Track background
            Box(
                modifier = Modifier
                    .width(6.dp)
                    .fillMaxHeight()
                    .background(Color(0xFF2A2A2E), RoundedCornerShape(3.dp))
            )
            
            // Normalized value (0.0 at min, 1.0 at max)
            val normalized = (displayValue - min) / (max - min)
            
            // Active track - fills from bottom up to thumb position
            Box(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .width(6.dp)
                    .fillMaxHeight(normalized.coerceAtLeast(0.01f))
                    .background(
                        Brush.verticalGradient(
                            listOf(tint.copy(alpha = 0.8f), tint)
                        ),
                        RoundedCornerShape(3.dp)
                    )
            )

            // Center line indicator (0dB)
            Box(
                modifier = Modifier
                    .align(Alignment.Center)
                    .width(12.dp)
                    .height(2.dp)
                    .background(Color.White.copy(alpha = 0.3f))
            )

            // Thumb
            val thumbY = (1f - normalized)
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .fillMaxHeight()
                    .wrapContentSize(Alignment.TopCenter)
                    .offset(y = (thumbY * 240).dp)
                    .size(22.dp)
                    .clip(CircleShape)
                    .background(if (enabled) Color.White else Color.DarkGray)
                    .border(2.dp, if (enabled) tint else Color.Gray, CircleShape)
            )
        }
        
        Spacer(Modifier.height(8.dp))
        val dbValue = displayValue / 1000f
        Text(
            text = "${if (dbValue >= 0) "+" else ""}${String.format("%.1f", dbValue)}",
            color = if (enabled) tint else Color.Gray,
            fontSize = 9.sp,
            fontWeight = FontWeight.Bold
        )
    }
}

@Composable
fun LiquidSleepTimer(
    viewModel: MainViewModel,
    themeViewModel: ThemeViewModel,
    onDismiss: () -> Unit
) {
    var selectedSeconds by remember { mutableIntStateOf(30 * 60) }
    var isTimerRunning by remember { mutableStateOf(viewModel.sleepTimerTimeLeft > 0) }
    var displayTimeLeft by remember { mutableLongStateOf(viewModel.sleepTimerTimeLeft) }

    LaunchedEffect(viewModel.sleepTimerTimeLeft) {
        displayTimeLeft = viewModel.sleepTimerTimeLeft
        isTimerRunning = viewModel.sleepTimerTimeLeft > 0
        if (!isTimerRunning && displayTimeLeft <= 0) {
            selectedSeconds = 30 * 60
        }
    }

    androidx.compose.ui.window.Dialog(
        onDismissRequest = onDismiss,
        properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = Color(0xFF0E0E12)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .statusBarsPadding()
                    .navigationBarsPadding()
            ) {
                // Header
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Default.ArrowBack, contentDescription = null, tint = Color.White)
                    }
                    Text(
                        "Sleep Timer",
                        style = MaterialTheme.typography.headlineMedium,
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.weight(1f)
                    )
                    if (isTimerRunning) {
                        TextButton(onClick = {
                            viewModel.setSleepTimer(0)
                            isTimerRunning = false
                        }) {
                            Text("Cancel", color = themeViewModel.primary)
                        }
                    }
                }

                Spacer(Modifier.height(24.dp))

                // Circular dial with drag interaction
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(320.dp),
                    contentAlignment = Alignment.Center
                ) {
                    // Interactive circular dial
                    Box(
                        modifier = Modifier.size(280.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Canvas(
                            modifier = Modifier
                                .fillMaxSize()
                                .pointerInput(Unit) {
                                    awaitEachGesture {
                                        awaitFirstDown(requireUnconsumed = false)
                                        do {
                                            val event = awaitPointerEvent()
                                            event.changes.forEach { change ->
                                                change.consume()
                                                val canvasCenter = size.width / 2f
                                                val dx = change.position.x - canvasCenter
                                                val dy = change.position.y - canvasCenter
                                                val distance = sqrt(dx * dx + dy * dy)
                                                val radius = canvasCenter * 0.9f

                                                if (distance <= radius * 1.2f) {
                                                    var angle = Math.toDegrees(atan2(dy.toDouble(), dx.toDouble())).toFloat()
                                                    angle = (angle + 90 + 360) % 360
                                                    val newSeconds = ((angle / 360f) * 7200f).toInt().coerceIn(0, 7200)
                                                    selectedSeconds = newSeconds
                                                }
                                            }
                                        } while (event.changes.any { it.pressed })
                                    }
                                }
                        ) {
                            val center = Offset(size.width / 2, size.height / 2)
                            val radius = size.width * 0.42f
                            val trackWidth = 12f

                            // Background track
                            drawCircle(
                                color = Color(0xFF1A1A1E),
                                radius = radius,
                                style = Stroke(width = trackWidth, cap = StrokeCap.Round)
                            )

                            // Tick marks
                            for (i in 0 until 12) {
                                val tickAngle = (i * 30f - 90f) * (PI / 180f).toFloat()
                                val innerR = radius - 20f
                                val outerR = radius - 8f
                                drawLine(
                                    color = Color.White.copy(alpha = 0.15f),
                                    start = Offset(center.x + cos(tickAngle) * innerR, center.y + sin(tickAngle) * innerR),
                                    end = Offset(center.x + cos(tickAngle) * outerR, center.y + sin(tickAngle) * outerR),
                                    strokeWidth = 2f,
                                    cap = StrokeCap.Round
                                )
                            }

                            // Active arc
                            val sweepAngle = (selectedSeconds.toFloat() / 7200f) * 360f
                            if (sweepAngle > 0f) {
                                drawArc(
                                    brush = Brush.sweepGradient(
                                        listOf(
                                            themeViewModel.primary,
                                            themeViewModel.secondary,
                                            themeViewModel.primary
                                        )
                                    ),
                                    startAngle = -90f,
                                    sweepAngle = sweepAngle,
                                    useCenter = false,
                                    style = Stroke(width = trackWidth, cap = StrokeCap.Round)
                                )
                            }

                            // Thumb dot
                            val thumbAngle = (-90f + sweepAngle) * (PI / 180f).toFloat()
                            drawCircle(
                                color = themeViewModel.primary,
                                radius = 10f,
                                center = Offset(
                                    center.x + cos(thumbAngle) * radius,
                                    center.y + sin(thumbAngle) * radius
                                )
                            )
                            // Thumb glow
                            drawCircle(
                                color = themeViewModel.primary.copy(alpha = 0.3f),
                                radius = 18f,
                                center = Offset(
                                    center.x + cos(thumbAngle) * radius,
                                    center.y + sin(thumbAngle) * radius
                                )
                            )
                        }

                        // MM:SS countdown display in center
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            if (isTimerRunning) {
                                val minutes = (displayTimeLeft / 1000) / 60
                                val seconds = (displayTimeLeft / 1000) % 60
                                Text(
                                    "%02d:%02d".format(minutes, seconds),
                                    style = MaterialTheme.typography.displayLarge,
                                    color = Color.White,
                                    fontWeight = FontWeight.Black,
                                    fontSize = 64.sp
                                )
                                Text(
                                    "remaining",
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = Color.White.copy(alpha = 0.4f)
                                )
                            } else {
                                val minutes = selectedSeconds / 60
                                val seconds = selectedSeconds % 60
                                Text(
                                    "%02d:%02d".format(minutes, seconds),
                                    style = MaterialTheme.typography.displayLarge,
                                    color = Color.White,
                                    fontWeight = FontWeight.Black,
                                    fontSize = 64.sp
                                )
                                Text(
                                    "minutes",
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = Color.White.copy(alpha = 0.4f)
                                )
                            }
                        }

                        // Min/Max labels
                        Text(
                            "0",
                            color = Color.White.copy(alpha = 0.3f),
                            fontSize = 12.sp,
                            modifier = Modifier.offset(y = 140.dp)
                        )
                        Text(
                            "2h",
                            color = Color.White.copy(alpha = 0.3f),
                            fontSize = 12.sp,
                            modifier = Modifier.offset(y = (-140).dp)
                        )
                    }
                }

                Spacer(Modifier.height(16.dp))

                // Quick time buttons - 2x3 grid
                if (!isTimerRunning) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 32.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            listOf(10, 20, 30).forEach { mins ->
                                QuickTimeButton(
                                    mins = mins,
                                    isSelected = selectedSeconds == mins * 60,
                                    modifier = Modifier.weight(1f),
                                    onClick = { selectedSeconds = mins * 60 },
                                    tint = themeViewModel.primary
                                )
                            }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            listOf(60, 90, 120).forEach { mins ->
                                QuickTimeButton(
                                    mins = mins,
                                    isSelected = selectedSeconds == mins * 60,
                                    modifier = Modifier.weight(1f),
                                    onClick = { selectedSeconds = mins * 60 },
                                    tint = themeViewModel.primary
                                )
                            }
                        }
                    }
                }

                Spacer(Modifier.weight(1f))

                Button(
                    onClick = {
                        if (isTimerRunning) {
                            viewModel.setSleepTimer(0)
                            isTimerRunning = false
                        } else {
                            viewModel.setSleepTimer(selectedSeconds / 60)
                            isTimerRunning = true
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 32.dp)
                        .height(56.dp),
                    shape = RoundedCornerShape(16.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color.Transparent)
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .background(
                                if (isTimerRunning) SolidColor(Color(0xFFFF5252).copy(alpha = 0.2f))
                                else Brush.horizontalGradient(listOf(themeViewModel.primary, themeViewModel.secondary)),
                                RoundedCornerShape(16.dp)
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                if (isTimerRunning) Icons.Default.Close else Icons.Default.Timer,
                                contentDescription = null,
                                tint = Color.White,
                                modifier = Modifier.size(22.dp)
                            )
                            Spacer(Modifier.width(8.dp))
                            Text(
                                if (isTimerRunning) "Cancel Timer" else "Start Timer",
                                color = Color.White,
                                fontWeight = FontWeight.Bold,
                                fontSize = 16.sp
                            )
                        }
                    }
                }

                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

@Composable
fun QuickTimeButton(
    mins: Int,
    isSelected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
    tint: Color
) {
    Surface(
        onClick = onClick,
        modifier = modifier.height(52.dp),
        shape = CircleShape,
        color = if (isSelected) tint else Color(0xFF1A1A1E),
        border = BorderStroke(1.dp, if (isSelected) tint else Color.White.copy(alpha = 0.1f))
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text(
                "$mins",
                color = if (isSelected) Color.White else Color.White.copy(alpha = 0.7f),
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                "mins",
                color = if (isSelected) Color.White.copy(alpha = 0.7f) else Color.White.copy(alpha = 0.3f),
                fontSize = 8.sp
            )
        }
    }
}

@Composable
fun LiquidDialog(
    title: String,
    onDismiss: () -> Unit,
    content: @Composable ColumnScope.() -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title, color = Color.White, fontWeight = FontWeight.Bold) },
        text = { Column { content() } },
        confirmButton = {},
        containerColor = Color(0xFF1A1A1E),
        titleContentColor = Color.White,
        shape = RoundedCornerShape(24.dp)
    )
}

fun formatTime(ms: Long): String {
    val totalSeconds = ms / 1000
    val minutes = totalSeconds / 60
    val seconds = totalSeconds % 60
    return "%d:%02d".format(minutes, seconds)
}
