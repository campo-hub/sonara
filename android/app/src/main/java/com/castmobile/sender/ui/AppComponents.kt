package com.sonara.app.ui

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.sonara.app.model.Track

@Composable
fun LiquidNavigation(
    viewModel: MainViewModel,
    themeViewModel: ThemeViewModel,
    onCreatePlaylist: () -> Unit
) {
    val isPlaying = viewModel.currentTrack != null

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .navigationBarsPadding()
    ) {
        if (isPlaying && !viewModel.showFullPlayer) {
            LiquidMiniPlayer(
                track = viewModel.currentTrack!!,
                isPlaying = viewModel.isPlaying,
                viewModel = viewModel,
                themeViewModel = themeViewModel,
                onToggle = { viewModel.togglePlayback() },
                onClick = { viewModel.showFullPlayer = true }
            )
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(
                    Brush.verticalGradient(
                        listOf(
                            Color(0xFF0E0E12).copy(alpha = 0.95f),
                            Color(0xFF0E0E12)
                        )
                    )
                )
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
                    .padding(horizontal = 24.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically
            ) {
                val destinations = listOf(
                    DockDestination(0, Icons.Outlined.Home, Icons.Filled.Home, "Home"),
                    DockDestination(1, Icons.Outlined.LibraryMusic, Icons.Filled.LibraryMusic, "Library"),
                    DockDestination(2, Icons.Outlined.Search, Icons.Filled.Search, "All Music"),
                    DockDestination(3, Icons.Outlined.Palette, Icons.Filled.Palette, "Lab")
                )

                destinations.forEach { dest ->
                    LiquidDockItem(
                        selected = viewModel.selectedTab == dest.index && viewModel.currentFolder == null,
                        icon = if (viewModel.selectedTab == dest.index && viewModel.currentFolder == null) dest.filledIcon else dest.outlinedIcon,
                        label = dest.label,
                        primaryColor = themeViewModel.primary,
                        onClick = {
                            viewModel.selectedTab = dest.index
                            viewModel.currentFolder = null
                        }
                    )
                }
            }
        }
    }
}

data class DockDestination(
    val index: Int,
    val outlinedIcon: ImageVector,
    val filledIcon: ImageVector,
    val label: String
)

@Composable
fun LiquidDockItem(
    selected: Boolean,
    icon: ImageVector,
    label: String,
    primaryColor: Color,
    onClick: () -> Unit
) {
    val alpha by animateFloatAsState(
        if (selected) 1f else 0.5f,
        label = "dockAlpha"
    )

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 4.dp)
    ) {
        Icon(
            imageVector = icon,
            contentDescription = label,
            modifier = Modifier.size(24.dp).alpha(alpha),
            tint = if (selected) primaryColor else Color.White.copy(alpha = 0.6f)
        )

        Spacer(Modifier.height(4.dp))

        if (selected) {
            Box(
                modifier = Modifier
                    .size(4.dp)
                    .background(primaryColor, CircleShape)
            )
        } else {
            Text(
                label,
                style = MaterialTheme.typography.labelSmall,
                color = Color.White.copy(alpha = 0.4f),
                fontSize = 10.sp
            )
        }
    }
}

@Composable
fun LiquidMiniPlayer(
    track: Track,
    isPlaying: Boolean,
    viewModel: MainViewModel,
    themeViewModel: ThemeViewModel,
    onToggle: () -> Unit,
    onClick: () -> Unit
) {
    val progress = if (viewModel.duration > 0) viewModel.currentPosition.toFloat() / viewModel.duration else 0f
    var isDragging by remember { mutableStateOf(false) }
    var dragProgress by remember { mutableFloatStateOf(progress) }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .clip(RoundedCornerShape(28.dp))
            .background(
                Brush.horizontalGradient(
                    listOf(
                        themeViewModel.primary.copy(alpha = 0.35f),
                        themeViewModel.secondary.copy(alpha = 0.25f),
                        themeViewModel.primary.copy(alpha = 0.35f)
                    )
                )
            )
            .padding(1.5.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(26.dp))
                .background(Color(0xFF141418).copy(alpha = 0.95f))
                .clickable(onClick = onClick)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                AsyncImage(
                    model = track.albumArtUri,
                    contentDescription = null,
                    modifier = Modifier
                        .size(48.dp)
                        .clip(RoundedCornerShape(14.dp)),
                    contentScale = ContentScale.Crop
                )

                Spacer(Modifier.width(12.dp))

                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        track.title,
                        color = Color.White,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        track.artist,
                        color = Color.White.copy(alpha = 0.5f),
                        fontSize = 12.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                Box(
                    modifier = Modifier
                        .size(44.dp)
                        .clip(CircleShape)
                        .background(
                            Brush.sweepGradient(
                                listOf(
                                    themeViewModel.primary,
                                    themeViewModel.secondary,
                                    themeViewModel.primary
                                )
                            )
                        )
                        .padding(2.dp)
                        .clip(CircleShape)
                        .background(Color(0xFF141418))
                        .clickable(onClick = onToggle),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(22.dp)
                    )
                }

                Spacer(Modifier.width(8.dp))

                Icon(
                    Icons.Default.GraphicEq,
                    contentDescription = null,
                    tint = themeViewModel.primary.copy(alpha = 0.7f),
                    modifier = Modifier.size(20.dp)
                )
            }

            // Draggable progress bar
            val displayProgress = if (isDragging) dragProgress else progress

            BoxWithConstraints(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .padding(bottom = 10.dp)
                    .height(20.dp)
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
                        .height(3.dp)
                        .align(Alignment.Center)
                        .clip(RoundedCornerShape(2.dp))
                        .background(Color.White.copy(alpha = 0.08f))
                )

                // Progress fill
                Box(
                    modifier = Modifier
                        .fillMaxWidth(displayProgress)
                        .height(3.dp)
                        .align(Alignment.CenterStart)
                        .background(
                            Brush.horizontalGradient(
                                listOf(themeViewModel.primary, themeViewModel.secondary)
                            )
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
        }
    }
}

@Composable
fun LiquidTheme(
    themeViewModel: ThemeViewModel,
    content: @Composable () -> Unit
) {
    val colorScheme = darkColorScheme(
        primary = themeViewModel.primary,
        secondary = themeViewModel.secondary,
        tertiary = themeViewModel.secondary,
        background = Color.Black,
        surface = Color(0xFF0E0E12),
        onPrimary = Color.White,
        onSecondary = Color.White,
        onBackground = Color.White,
        onSurface = Color.White
    )

    MaterialTheme(
        colorScheme = colorScheme,
        content = content
    )
}
