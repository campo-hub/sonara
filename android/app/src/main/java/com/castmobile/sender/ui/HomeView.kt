package com.sonara.app.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.sonara.app.model.Folder
import com.sonara.app.model.Track
import java.util.Calendar
import kotlin.math.*

@Composable
fun LiquidHome(
    viewModel: MainViewModel,
    themeViewModel: ThemeViewModel,
    onFolderClick: (Folder) -> Unit
) {
    val calendar = Calendar.getInstance()
    val hour = calendar.get(Calendar.HOUR_OF_DAY)
    val timeGreeting = when (hour) {
        in 5..11 -> "Good Morning"
        in 12..16 -> "Good Afternoon"
        else -> "Good Evening"
    }

    val greetings = remember {
        listOf(
            "$timeGreeting",
            "Welcome back",
            "Ready for music?",
            "What's the mood?",
            "Pick your vibe",
            "Sonara is ready",
            "Let's hear it",
            "Music for you",
            "Your studio awaits",
            "Dive into sound",
            "How you doing",
            "Feel the vibe"
        )
    }
    val randomGreeting = remember { greetings.random() }

    val isDjActive = viewModel.isDjMode

    val infiniteTransition = rememberInfiniteTransition(label = "home")

    val djPulse by infiniteTransition.animateFloat(
        initialValue = 0.92f,
        targetValue = 1.08f,
        animationSpec = infiniteRepeatable(tween(1800), RepeatMode.Reverse),
        label = "djPulse"
    )

    val wavePhase by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            if (isDjActive) tween(1800, easing = LinearEasing) else tween(3500, easing = LinearEasing)
        ),
        label = "wavePhase"
    )

    val glowAlpha by infiniteTransition.animateFloat(
        initialValue = if (isDjActive) 0.6f else 0.35f,
        targetValue = if (isDjActive) 0.9f else 0.5f,
        animationSpec = infiniteRepeatable(tween(1200), RepeatMode.Reverse),
        label = "glowAlpha"
    )

    val sparklePhase by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(600, easing = LinearEasing)),
        label = "sparkle"
    )

    val bassIntensity = viewModel.bassIntensity
    val midIntensity = viewModel.midIntensity
    val trebleIntensity = viewModel.trebleIntensity

    val soundscapes = remember(viewModel.userPlaylists, viewModel.folders) {
        (viewModel.userPlaylists + viewModel.folders).distinctBy { it.name }
    }

    val cardIcons = listOf("☁️", "💪", "🧘", "🌍", "🎷", "🍃", "🌙", "🚗")

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 180.dp)
    ) {
        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp)
                    .padding(top = 50.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "$randomGreeting, ${themeViewModel.userName}",
                        style = MaterialTheme.typography.titleMedium,
                        color = themeViewModel.primary,
                        fontWeight = FontWeight.Bold
                    )
                }

                Spacer(Modifier.height(16.dp))

                Text(
                    buildAnnotatedString {
                        append("What do you\nwant ")
                        withStyle(SpanStyle(brush = Brush.linearGradient(listOf(themeViewModel.primary, themeViewModel.secondary)))) {
                            append("to hear?")
                        }
                    },
                    style = MaterialTheme.typography.displayMedium,
                    fontWeight = FontWeight.Black,
                    color = Color.White,
                    lineHeight = 48.sp
                )

                Spacer(Modifier.height(8.dp))

                Text(
                    "Let Sonara set the vibe",
                    style = MaterialTheme.typography.bodyLarge,
                    color = Color.White.copy(alpha = 0.5f)
                )
            }
        }

        // DJ Button section - centerpiece
        item {
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(240.dp),
                    contentAlignment = Alignment.Center
                ) {
                // Outer reactive glow
                Canvas(modifier = Modifier.size(260.dp)) {
                    val center = Offset(size.width / 2, size.height / 2)
                    val baseGlow = if (isDjActive) 130f else 110f
                    val bassExpansion = if (isDjActive) bassIntensity * 30f else 0f
                    val glowRadius = baseGlow + bassExpansion

                    drawCircle(
                        brush = Brush.radialGradient(
                            colors = listOf(
                                themeViewModel.primary.copy(alpha = glowAlpha * (0.7f + midIntensity * 0.3f)),
                                themeViewModel.secondary.copy(alpha = glowAlpha * 0.4f),
                                Color.Transparent
                            ),
                            center = center,
                            radius = glowRadius
                        ),
                        center = center,
                        radius = glowRadius
                    )

                    // Treble sparkle dots
                    if (isDjActive && trebleIntensity > 0.3f) {
                        for (i in 0 until 12) {
                            val sparkleAngle = (i.toFloat() / 12 * 360f + sparklePhase) * (PI / 180f).toFloat()
                            val sparkleR = 100f + trebleIntensity * 18f
                            val sparkleX = center.x + cos(sparkleAngle) * sparkleR
                            val sparkleY = center.y + sin(sparkleAngle) * sparkleR

                            drawCircle(
                                color = Color.White.copy(alpha = trebleIntensity * 0.7f),
                                radius = 2f + trebleIntensity * 3f,
                                center = Offset(sparkleX, sparkleY)
                            )
                        }
                    }
                }

                // Rings and waveform
                Canvas(modifier = Modifier.size(220.dp)) {
                    val center = Offset(size.width / 2, size.height / 2)
                    val ringAlpha = if (isDjActive) 0.7f + midIntensity * 0.3f else 0.7f

                    // Multiple concentric rings for depth
                    for (r in listOf(80f, 100f, 120f)) {
                        drawCircle(
                            color = themeViewModel.primary.copy(alpha = ringAlpha * (0.4f - (r-80f)/200f)),
                            radius = r,
                            style = Stroke(width = 1.dp.toPx(), cap = StrokeCap.Round)
                        )
                    }

                    // Main outer ring - primary color
                    drawCircle(
                        color = themeViewModel.primary.copy(alpha = ringAlpha),
                        radius = 100f,
                        style = Stroke(width = if (isDjActive) 4f else 3.5f, cap = StrokeCap.Round)
                    )

                    // Inner ring - secondary color
                    drawCircle(
                        color = themeViewModel.secondary.copy(alpha = ringAlpha * 0.85f),
                        radius = 82f,
                        style = Stroke(width = if (isDjActive) 3f else 2.5f, cap = StrokeCap.Round)
                    )

                    // Spinning waveform lines
                    val lineCount = if (isDjActive) 24 else 18
                    for (i in 0 until lineCount) {
                        val angle = (i.toFloat() / lineCount * 360f + wavePhase) * (PI / 180f).toFloat()
                        val innerR = if (isDjActive) 22f else 24f
                        val bassBoost = if (isDjActive) bassIntensity * 12f else 0f
                        val outerR = (if (isDjActive) 48f else 50f) + sin(angle * 3) * (10f + bassBoost)

                        val lineAlpha = if (isDjActive) 0.7f + midIntensity * 0.3f else 0.6f
                        val lineWidth = if (isDjActive) 3f + bassIntensity * 1.5f else 3f

                        drawLine(
                            color = Color.White.copy(alpha = lineAlpha),
                            start = Offset(center.x + cos(angle) * innerR, center.y + sin(angle) * innerR),
                            end = Offset(center.x + cos(angle) * outerR, center.y + sin(angle) * outerR),
                            strokeWidth = lineWidth,
                            cap = StrokeCap.Round
                        )
                    }

                    // Spinning dot
                    if (isDjActive) {
                        val dotAngle = wavePhase * 2 * (PI / 180f).toFloat()
                        val dotR = 70f
                        drawCircle(
                            color = themeViewModel.primary,
                            radius = 5f,
                            center = Offset(center.x + cos(dotAngle) * dotR, center.y + sin(dotAngle) * dotR)
                        )
                    }
                }

                // Center content
                if (isDjActive) {
                    Box(
                        modifier = Modifier.size(100.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            Icons.Default.GraphicEq,
                            contentDescription = null,
                            tint = Color.White.copy(alpha = 0.8f),
                            modifier = Modifier.size(44.dp)
                        )
                    }
                } else {
                    Surface(
                        onClick = { viewModel.startDJ() },
                        modifier = Modifier.scale(djPulse),
                        shape = CircleShape,
                        color = Color.Black.copy(alpha = 0.6f),
                        border = BorderStroke(2.dp, themeViewModel.primary.copy(alpha = 0.4f))
                    ) {
                        Box(
                            modifier = Modifier.size(120.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Icon(
                                    Icons.Default.GraphicEq,
                                    contentDescription = null,
                                    tint = themeViewModel.primary,
                                    modifier = Modifier.size(36.dp)
                                )
                                Spacer(Modifier.height(6.dp))
                                Text(
                                    "DJ",
                                    style = MaterialTheme.typography.titleLarge,
                                    fontWeight = FontWeight.Black,
                                    color = Color.White
                                )
                            }
                        }
                    }
                }

                // Status text - show current theme when DJ is active
                if (isDjActive) {
                    Text(
                        viewModel.currentThemeName,
                        style = MaterialTheme.typography.bodySmall,
                        color = themeViewModel.primary.copy(alpha = 0.8f),
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .offset(y = (-12).dp)
                    )
                }
            }

            if (!isDjActive) {
                Text(
                    "Tap to create a vibe",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color.White.copy(alpha = 0.4f),
                    modifier = Modifier.padding(top = 8.dp),
                    textAlign = TextAlign.Center
                )
            }
        }
    }

    // Recently Played Section
    val recentTracks = viewModel.recentlyPlayedTracks
    if (recentTracks.isNotEmpty()) {
        item {
            Column(modifier = Modifier.padding(start = 24.dp, end = 24.dp, top = 8.dp, bottom = 16.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            "Recently Played",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                            color = Color.White
                        )
                        Text(
                            "See all",
                            color = themeViewModel.primary,
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.clickable { viewModel.selectedTab = 2 }
                        )
                    }
                    
                    Spacer(Modifier.height(16.dp))
                    
                    recentTracks.take(2).forEach { track ->
                        RecentlyPlayedItem(track, viewModel, themeViewModel)
                        Spacer(Modifier.height(12.dp))
                    }
                }
            }
        }

        // Soundscapes section header
        item {
            Column(modifier = Modifier.padding(top = 4.dp)) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 24.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text(
                            "Soundscapes",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                            color = Color.White
                        )
                        Text(
                            "Curated vibes for your mood",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color.White.copy(alpha = 0.4f)
                        )
                    }
                    Text(
                        "See all",
                        color = themeViewModel.primary,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.clickable { viewModel.selectedTab = 1 }
                    )
                }

                Spacer(Modifier.height(16.dp))
            }
        }

        item {
            Column(
                modifier = Modifier.padding(horizontal = 24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                val items = soundscapes.take(8)

                if (items.size >= 2) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        SoundscapeCard(items[0], cardIcons[0], Modifier.weight(1f), themeViewModel) { onFolderClick(items[0]) }
                        SoundscapeCard(items[1], cardIcons[1], Modifier.weight(1f), themeViewModel) { onFolderClick(items[1]) }
                    }
                }
                if (items.size >= 4) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        SoundscapeCard(items[2], cardIcons[2], Modifier.weight(1f), themeViewModel) { onFolderClick(items[2]) }
                        SoundscapeCard(items[3], cardIcons[3], Modifier.weight(1f), themeViewModel) { onFolderClick(items[3]) }
                    }
                }
                if (items.size >= 6) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        SoundscapeCard(items[4], cardIcons[4], Modifier.weight(1f), themeViewModel) { onFolderClick(items[4]) }
                        SoundscapeCard(items[5], cardIcons[5], Modifier.weight(1f), themeViewModel) { onFolderClick(items[5]) }
                    }
                }
                if (items.size >= 8) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        SoundscapeCard(items[6], cardIcons[6], Modifier.weight(1f), themeViewModel) { onFolderClick(items[6]) }
                        SoundscapeCard(items[7], cardIcons[7], Modifier.weight(1f), themeViewModel) { onFolderClick(items[7]) }
                    }
                }
            }
        }
    }
}

@Composable
fun RecentlyPlayedItem(track: Track, viewModel: MainViewModel, themeViewModel: ThemeViewModel) {
    Surface(
        onClick = { viewModel.playTrack(track, listOf(track)) },
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = Color(0xFF1A1A1E),
        border = BorderStroke(1.dp, Color.White.copy(alpha = 0.06f))
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            AsyncImage(
                model = track.albumArtUri,
                contentDescription = null,
                modifier = Modifier
                    .size(52.dp)
                    .clip(RoundedCornerShape(10.dp)),
                contentScale = ContentScale.Crop
            )
            
            Spacer(Modifier.width(16.dp))
            
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    track.title,
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    track.artist,
                    color = Color.White.copy(alpha = 0.5f),
                    fontSize = 13.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(Color.White.copy(alpha = 0.08f))
                    .border(1.dp, Color.White.copy(alpha = 0.1f), CircleShape),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Default.PlayArrow,
                    contentDescription = "Play",
                    tint = themeViewModel.primary,
                    modifier = Modifier.size(24.dp)
                )
            }
        }
    }
}

@Composable
fun SoundscapeCard(
    folder: Folder,
    iconEmoji: String = "🎵",
    modifier: Modifier = Modifier,
    themeViewModel: ThemeViewModel,
    onClick: () -> Unit
) {
    Surface(
        onClick = onClick,
        modifier = modifier.height(140.dp),
        shape = RoundedCornerShape(16.dp),
        color = Color(0xFF1A1A1E),
        border = BorderStroke(1.dp, Color.White.copy(alpha = 0.08f))
    ) {
        Box {
            AsyncImage(
                model = folder.coverArtUri,
                contentDescription = null,
                modifier = Modifier
                    .fillMaxSize()
                    .blur(8.dp)
                    .clip(RoundedCornerShape(16.dp)),
                contentScale = ContentScale.Crop,
                alpha = 0.6f
            )

            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            listOf(
                                Color.Black.copy(alpha = 0.2f),
                                Color.Black.copy(alpha = 0.85f)
                            )
                        )
                    )
            )

            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(14.dp),
                verticalArrangement = Arrangement.SpaceBetween
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.Top
                ) {
                    Box(
                        modifier = Modifier
                            .size(40.dp)
                            .clip(CircleShape)
                            .background(Color.Black.copy(alpha = 0.4f))
                            .border(1.dp, Color.White.copy(alpha = 0.15f), CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(iconEmoji, fontSize = 18.sp)
                    }

                    Box(
                        modifier = Modifier
                            .size(36.dp)
                            .clip(CircleShape)
                            .background(themeViewModel.primary.copy(alpha = 0.3f))
                            .clickable { onClick() },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            Icons.Default.PlayArrow,
                            contentDescription = "Play",
                            tint = Color.White,
                            modifier = Modifier.size(20.dp)
                        )
                    }
                }

                Column {
                    Text(
                        folder.name,
                        color = Color.White,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        "${folder.trackCount} tracks",
                        color = Color.White.copy(alpha = 0.6f),
                        fontSize = 12.sp
                    )
                }
            }
        }
    }
}
