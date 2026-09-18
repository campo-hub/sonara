package com.sonara.app.ui

import androidx.activity.compose.BackHandler
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
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.sonara.app.model.Track
import kotlin.math.*

/**
 * Full Player Screen - matches reference exactly
 * - "PLAYING FROM" centered with "Chill Collection"
 * - Equalizer and sleep timer icons
 * - Album art with neon ring border
 * - Waveform visualization around album art
 * - Track info, progress bar, controls
 * - "Auto-Awesome DJ Mode" button
 * - Bottom toolbar with search, playlist, more
 */
@Composable
fun LiquidPlayer(
    viewModel: MainViewModel,
    themeViewModel: ThemeViewModel
) {
    val track = viewModel.currentTrack ?: return
    val isFavorite = viewModel.favoriteTracks.value.contains(track.id)
    
    BackHandler { viewModel.showFullPlayer = false }
    
    // Waveform animation
    val infiniteTransition = rememberInfiniteTransition(label = "player")
    val waveRotation by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(6000, easing = LinearEasing)),
        label = "waveRotation"
    )
    
    // Dismiss drag state
    var dragOffset by remember { mutableFloatStateOf(0f) }
    val dismissProgress = (dragOffset / 400f).coerceIn(0f, 1f)

    Box(
        modifier = Modifier
            .fillMaxSize()
            .graphicsLayer {
                alpha = 1f - dismissProgress * 0.5f
                translationY = dragOffset
            }
            .pointerInput(Unit) {
                detectVerticalDragGestures(
                    onDragEnd = {
                        if (dragOffset > 150f) viewModel.showFullPlayer = false
                        dragOffset = 0f
                    },
                    onVerticalDrag = { _, amount ->
                        if (amount > 0 || dragOffset > 0) {
                            dragOffset = (dragOffset + amount).coerceAtLeast(0f)
                        }
                    }
                )
            }
    ) {
        // Solid black background
        Box(modifier = Modifier.fillMaxSize().background(Color.Black))
        
        // Subtle ambient glow
        Canvas(modifier = Modifier.fillMaxSize()) {
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(
                        themeViewModel.primary.copy(alpha = 0.1f),
                        Color.Transparent
                    ),
                    center = Offset(size.width / 2, size.height * 0.3f),
                    radius = size.maxDimension * 0.4f
                ),
                center = Offset(size.width / 2, size.height * 0.3f),
                radius = size.maxDimension * 0.4f
            )
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
        ) {
            // Top bar
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Drag handle
                Box(
                    modifier = Modifier
                        .width(40.dp)
                        .height(4.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(Color.White.copy(alpha = 0.2f))
                )
                
                // Playing from
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.weight(1f)
                ) {
                    Text(
                        "PLAYING FROM",
                        style = MaterialTheme.typography.labelSmall,
                        color = Color.White.copy(alpha = 0.4f),
                        letterSpacing = 2.sp
                    )
                    Text(
                        viewModel.currentFolder?.name ?: "All Tracks",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color.White,
                        fontWeight = FontWeight.SemiBold
                    )
                }
                
                // Icons
                Row {
                    IconButton(onClick = { viewModel.showEqualizer = true }) {
                        Icon(Icons.Default.Tune, contentDescription = null, tint = Color.White.copy(alpha = 0.7f), modifier = Modifier.size(22.dp))
                    }
                    IconButton(onClick = { viewModel.showSleepTimer = true }) {
                        Icon(
                            if (viewModel.sleepTimerTimeLeft > 0L) Icons.Default.Timer else Icons.Default.TimerOff,
                            contentDescription = null,
                            tint = if (viewModel.sleepTimerTimeLeft > 0L) themeViewModel.primary else Color.White.copy(alpha = 0.7f),
                            modifier = Modifier.size(22.dp)
                        )
                    }
                }
            }

            // Album art with neon ring and waveform
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                contentAlignment = Alignment.Center
            ) {
                Box(contentAlignment = Alignment.Center) {
                    // Glow behind
                    Box(
                        modifier = Modifier
                            .size(300.dp)
                            .blur(60.dp)
                            .background(
                                Brush.sweepGradient(
                                    listOf(
                                        themeViewModel.primary.copy(alpha = 0.3f),
                                        themeViewModel.secondary.copy(alpha = 0.2f),
                                        themeViewModel.primary.copy(alpha = 0.15f),
                                        themeViewModel.primary.copy(alpha = 0.3f)
                                    )
                                ),
                                CircleShape
                            )
                    )
                    
                    // Waveform visualization ring
                    Canvas(modifier = Modifier.size(280.dp)) {
                        val center = Offset(size.width / 2, size.height / 2)
                        val radius = 120f
                        
                        // Neon ring border
                        drawCircle(
                            color = themeViewModel.primary.copy(alpha = 0.5f),
                            radius = radius + 5f,
                            style = Stroke(width = 2f, cap = StrokeCap.Round)
                        )
                        drawCircle(
                            color = themeViewModel.secondary.copy(alpha = 0.3f),
                            radius = radius + 15f,
                            style = Stroke(width = 1f, cap = StrokeCap.Round)
                        )
                        
                        // Waveform bars
                        val barCount = 36
                        for (i in 0 until barCount) {
                            val angle = (i.toFloat() / barCount * 360f + waveRotation) * (PI / 180f).toFloat()
                            val innerR = radius - 5f
                            val barHeight = 10f + (sin(angle * 3 + waveRotation * 0.01f) * 8f + cos(angle * 5) * 5f)
                            val outerR = innerR - barHeight
                            
                            drawLine(
                                color = when {
                                    i % 3 == 0 -> themeViewModel.primary.copy(alpha = 0.6f)
                                    i % 3 == 1 -> themeViewModel.secondary.copy(alpha = 0.5f)
                                    else -> themeViewModel.primary.copy(alpha = 0.4f)
                                },
                                start = Offset(center.x + cos(angle) * innerR, center.y + sin(angle) * innerR),
                                end = Offset(center.x + cos(angle) * outerR, center.y + sin(angle) * outerR),
                                strokeWidth = 2f,
                                cap = StrokeCap.Round
                            )
                        }
                    }
                    
                    // Album art
                    AsyncImage(
                        model = track.albumArtUri,
                        contentDescription = null,
                        modifier = Modifier
                            .size(220.dp)
                            .clip(CircleShape),
                        contentScale = ContentScale.Crop
                    )
                }
            }

            // Track info
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 32.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    track.title,
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    track.artist,
                    style = MaterialTheme.typography.titleMedium,
                    color = Color.White.copy(alpha = 0.5f),
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 4.dp)
                )
            }

            // Progress bar with draggable seek
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 32.dp)
                    .padding(top = 24.dp)
            ) {
                val progress = if (viewModel.duration > 0) viewModel.currentPosition.toFloat() / viewModel.duration else 0f
                var isDragging by remember { mutableStateOf(false) }
                var dragProgress by remember { mutableFloatStateOf(progress) }
                val displayProgress = if (isDragging) dragProgress else progress
                
                // Seek bar with drag gesture
                androidx.compose.foundation.layout.BoxWithConstraints(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(24.dp)
                        .pointerInput(Unit) {
                            awaitEachGesture {
                                awaitFirstDown(requireUnconsumed = false)
                                isDragging = true
                                dragProgress = (currentEvent.changes.first().position.x / size.width).coerceIn(0f, 1f)
                                do {
                                    val event = awaitPointerEvent()
                                    event.changes.forEach { change ->
                                        change.consume()
                                        dragProgress = (change.position.x / size.width).coerceIn(0f, 1f)
                                    }
                                } while (event.changes.any { it.pressed })
                                isDragging = false
                                viewModel.seekTo(dragProgress * viewModel.duration)
                            }
                        }
                ) {
                    val maxWidth = this.maxWidth
                    
                    // Track background
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(4.dp)
                            .align(Alignment.Center)
                            .clip(RoundedCornerShape(2.dp))
                            .background(Color.White.copy(alpha = 0.1f))
                    )
                    
                    // Progress fill
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(displayProgress)
                            .height(4.dp)
                            .align(Alignment.CenterStart)
                            .background(
                                Brush.horizontalGradient(listOf(themeViewModel.primary, themeViewModel.secondary))
                            )
                    )
                    
                    // Draggable thumb - positioned using offset based on actual width
                    Box(
                        modifier = Modifier
                            .offset(x = maxWidth * displayProgress - 12.dp) // Center the 24dp thumb
                            .size(24.dp)
                            .align(Alignment.CenterStart)
                    ) {
                        // Glow effect
                        Box(
                            modifier = Modifier
                                .size(24.dp)
                                .shadow(8.dp, CircleShape)
                                .background(themeViewModel.primary.copy(alpha = 0.4f), CircleShape)
                        )
                        // Thumb
                        Box(
                            modifier = Modifier
                                .size(12.dp)
                                .align(Alignment.Center)
                                .clip(CircleShape)
                                .background(Color.White)
                        )
                    }
                }
                
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(formatTime(viewModel.currentPosition), style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = 0.4f))
                    Text(formatTime(viewModel.duration), style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = 0.4f))
                }
            }

            // Controls
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 32.dp)
                    .padding(top = 16.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = { viewModel.toggleFavorite(track.id) }) {
                    Icon(
                        if (isFavorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                        contentDescription = null,
                        tint = if (isFavorite) themeViewModel.primary else Color.White.copy(alpha = 0.6f),
                        modifier = Modifier.size(28.dp)
                    )
                }
                IconButton(onClick = { viewModel.playPrevious() }) {
                    Icon(Icons.Default.SkipPrevious, contentDescription = null, tint = Color.White, modifier = Modifier.size(40.dp))
                }
                // Play/Pause
                Box(
                    modifier = Modifier
                        .size(72.dp)
                        .clip(CircleShape)
                        .background(
                            Brush.sweepGradient(listOf(themeViewModel.primary, themeViewModel.secondary, themeViewModel.primary))
                        )
                        .clickable { viewModel.togglePlayback() },
                    contentAlignment = Alignment.Center
                ) {
                    Box(
                        modifier = Modifier
                            .size(64.dp)
                            .clip(CircleShape)
                            .background(Color.Black.copy(alpha = 0.3f)),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            if (viewModel.isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                            contentDescription = null,
                            tint = Color.White,
                            modifier = Modifier.size(36.dp)
                        )
                    }
                }
                IconButton(onClick = { viewModel.playNext() }) {
                    Icon(Icons.Default.SkipNext, contentDescription = null, tint = Color.White, modifier = Modifier.size(40.dp))
                }
                IconButton(onClick = { viewModel.toggleShuffle() }) {
                    Icon(
                        Icons.Default.Shuffle,
                        contentDescription = null,
                        tint = if (viewModel.isShuffle) themeViewModel.primary else Color.White.copy(alpha = 0.6f),
                        modifier = Modifier.size(26.dp)
                    )
                }
            }

            Spacer(Modifier.height(16.dp))

            // DJ Mode button - only show when in DJ mode
            if (viewModel.isDjMode) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 32.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(themeViewModel.primary.copy(alpha = 0.15f))
                        .clickable { viewModel.changeDJVibe() }
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.AutoAwesome, contentDescription = null, tint = themeViewModel.primary, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(8.dp))
                        Column {
                            Text("Change Vibe", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                            Text(
                                viewModel.currentThemeName,
                                color = themeViewModel.primary.copy(alpha = 0.8f),
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Medium
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
        }
    }
}
