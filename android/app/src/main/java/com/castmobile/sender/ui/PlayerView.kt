package com.sonara.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sonara.app.model.Track

@Composable
fun LiquidPlayer(
    viewModel: MainViewModel,
    themeViewModel: ThemeViewModel,
    systemDark: Boolean
) {
    val track = viewModel.currentTrack ?: return
    val isDark = themeViewModel.isDark(systemDark)
    val bg = if (isDark) SonaraDesign.DarkBg else SonaraDesign.LightBg
    val paper = if (isDark) SonaraDesign.DarkPaper else SonaraDesign.LightPaper
    val line = if (isDark) SonaraDesign.DarkLine else SonaraDesign.LightLine
    val text = if (isDark) SonaraDesign.DarkText else SonaraDesign.LightText
    val muted = if (isDark) SonaraDesign.DarkMuted else SonaraDesign.LightMuted
    val accent = themeViewModel.getAccentColor(isDark)

    val isFavorite = viewModel.favoriteTracks.value.contains(track.id)
    val upNext = viewModel.getUpNextTracks(5)

    BackHandler { viewModel.showFullPlayer = false }

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
            .background(bg)
    ) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding(),
            contentPadding = PaddingValues(bottom = 40.dp)
        ) {
            // ─── Top Navigation Bar ─────────────────────────────────────
            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(
                        onClick = { viewModel.showFullPlayer = false }
                    ) {
                        Icon(
                            imageVector = Icons.Default.KeyboardArrowDown,
                            contentDescription = "Close player",
                            tint = text,
                            modifier = Modifier.size(28.dp)
                        )
                    }

                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = "PLAYING FROM",
                            fontSize = 10.sp,
                            color = muted,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 1.5.sp
                        )
                        Text(
                            text = viewModel.contextLabel,
                            fontSize = 14.sp,
                            color = text,
                            fontWeight = FontWeight.Bold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }

                    Row {
                        IconButton(onClick = { viewModel.showEqualizer = true }) {
                            Icon(Icons.Default.Tune, contentDescription = null, tint = text, modifier = Modifier.size(20.dp))
                        }
                        IconButton(onClick = { viewModel.showSleepTimer = true }) {
                            Icon(
                                imageVector = if (viewModel.sleepTimerTimeLeft > 0L) Icons.Default.Timer else Icons.Default.TimerOff,
                                contentDescription = null,
                                tint = if (viewModel.sleepTimerTimeLeft > 0L) accent else text,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }
                }
            }

            // ─── Visual Sleeve Stack ────────────────────────────────────
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 28.dp, vertical = 16.dp)
                ) {
                    SleeveStack(
                        track = track,
                        playing = viewModel.isPlaying,
                        spin = themeViewModel.spinRecords,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }

            // ─── Track Info & Action Row ─────────────────────────────────
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 28.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = track.title,
                        color = text,
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = track.artist,
                        color = muted,
                        fontSize = 16.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )

                    Spacer(Modifier.height(16.dp))

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        IconButton(
                            onClick = { viewModel.toggleFavorite(track.id) },
                            modifier = Modifier.size(42.dp)
                        ) {
                            Icon(
                                imageVector = if (isFavorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                                contentDescription = null,
                                tint = if (isFavorite) accent else text,
                                modifier = Modifier.size(24.dp)
                            )
                        }

                        DjButton(
                            active = viewModel.isDjMode,
                            onClick = {
                                if (viewModel.isDjMode) viewModel.changeDJVibe() else viewModel.startDJ()
                            },
                            idleLabel = "Start DJ session",
                            accentColor = accent
                        )
                    }
                }
            }

            // ─── Seek Bar & Transport Controls ─────────────────────────
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 28.dp)
                        .padding(top = 24.dp)
                ) {
                    val rawProgress = if (viewModel.duration > 0) viewModel.currentPosition.toFloat() / viewModel.duration else 0f
                    val progress = if (rawProgress < 0f) 0f else if (rawProgress > 1f) 1f else rawProgress
                    var isDragging by remember { mutableStateOf(false) }
                    var dragProgress by remember { mutableFloatStateOf(progress) }
                    val displayProgress = if (isDragging) dragProgress else progress

                    // Draggable Seek Slider
                    BoxWithConstraints(
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

                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(4.dp)
                                .align(Alignment.Center)
                                .clip(RoundedCornerShape(2.dp))
                                .background(line)
                        )

                        Box(
                            modifier = Modifier
                                .fillMaxWidth(displayProgress)
                                .height(4.dp)
                                .align(Alignment.CenterStart)
                                .background(accent)
                        )

                        Box(
                            modifier = Modifier
                                .offset(x = maxWidth * displayProgress - 12.dp)
                                .size(24.dp)
                                .align(Alignment.CenterStart)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(14.dp)
                                    .align(Alignment.Center)
                                    .clip(CircleShape)
                                    .background(text)
                            )
                        }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(formatPlayerTime(viewModel.currentPosition), fontSize = 12.sp, color = muted)
                        Text(formatPlayerTime(viewModel.duration), fontSize = 12.sp, color = muted)
                    }

                    Spacer(Modifier.height(16.dp))

                    // Transport Controls
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceEvenly,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        // Shuffle
                        IconButton(onClick = { viewModel.toggleShuffle() }) {
                            Icon(
                                imageVector = Icons.Default.Shuffle,
                                contentDescription = null,
                                tint = if (viewModel.isShuffle) accent else muted,
                                modifier = Modifier.size(22.dp)
                            )
                        }

                        // Previous
                        IconButton(onClick = { viewModel.playPrevious() }) {
                            Icon(
                                imageVector = Icons.Default.SkipPrevious,
                                contentDescription = null,
                                tint = text,
                                modifier = Modifier.size(32.dp)
                            )
                        }

                        // Play/Pause FAB
                        IconButton(
                            onClick = { viewModel.togglePlayback() },
                            modifier = Modifier
                                .size(60.dp)
                                .background(text, CircleShape)
                        ) {
                            Icon(
                                imageVector = if (viewModel.isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                                contentDescription = null,
                                tint = bg,
                                modifier = Modifier.size(32.dp)
                            )
                        }

                        // Next
                        IconButton(onClick = { viewModel.playNext() }) {
                            Icon(
                                imageVector = Icons.Default.SkipNext,
                                contentDescription = null,
                                tint = text,
                                modifier = Modifier.size(32.dp)
                            )
                        }

                        // Repeat
                        IconButton(onClick = { viewModel.toggleRepeat() }) {
                            val repeatActive = viewModel.repeatMode != PlaybackRepeatMode.NONE
                            Icon(
                                imageVector = if (viewModel.repeatMode == PlaybackRepeatMode.ONE) Icons.Default.RepeatOne else Icons.Default.Repeat,
                                contentDescription = null,
                                tint = if (repeatActive) accent else muted,
                                modifier = Modifier.size(22.dp)
                            )
                        }
                    }
                }
            }

            // ─── Up Next Queue Section ──────────────────────────────────
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 28.dp)
                        .padding(top = 32.dp)
                ) {
                    Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(line))
                    Spacer(Modifier.height(16.dp))

                    Text(
                        text = "Up next",
                        color = text,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold
                    )

                    Spacer(Modifier.height(12.dp))

                    if (upNext.size == 0) {
                        Text(
                            text = "Nothing queued after this track.",
                            color = muted,
                            fontSize = 13.sp
                        )
                    } else {
                        for (i in 0..upNext.size - 1) {
                            val itemPair = upNext[i]
                            val itemTrack = itemPair.first
                            val queueIdx = itemPair.second

                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { viewModel.jumpToQueueIndex(queueIdx) }
                                    .padding(vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                CoverArt(
                                    track = itemTrack,
                                    sizeDp = 40.dp
                                )
                                Spacer(Modifier.width(12.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = itemTrack.title,
                                        color = text,
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.Bold,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    Text(
                                        text = itemTrack.artist,
                                        color = muted,
                                        fontSize = 12.sp,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                                Text(
                                    text = formatPlayerTime(itemTrack.duration),
                                    color = muted,
                                    fontSize = 12.sp
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun formatPlayerTime(ms: Long): String {
    val totalSeconds = if (ms / 1000 < 0) 0 else ms / 1000
    val minutes = totalSeconds / 60
    val seconds = totalSeconds % 60
    return "$minutes:${if (seconds < 10) "0$seconds" else "$seconds"}"
}
