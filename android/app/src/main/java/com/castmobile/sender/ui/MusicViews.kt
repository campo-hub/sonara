package com.sonara.app.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sonara.app.model.Folder
import com.sonara.app.model.Track
import kotlin.math.abs

/* -------------------------------------------------------------------------- */
/*  All Music View                                                            */
/* -------------------------------------------------------------------------- */

@Composable
fun LiquidAllMusic(
    viewModel: MainViewModel,
    themeViewModel: ThemeViewModel,
    systemDark: Boolean,
    onAddTrack: (Track) -> Unit,
    onTrackClick: (Track, List<Track>) -> Unit
) {
    val isDark = themeViewModel.isDark(systemDark)
    val bg = if (isDark) SonaraDesign.DarkBg else SonaraDesign.LightBg
    val paper = if (isDark) SonaraDesign.DarkPaper else SonaraDesign.LightPaper
    val line = if (isDark) SonaraDesign.DarkLine else SonaraDesign.LightLine
    val text = if (isDark) SonaraDesign.DarkText else SonaraDesign.LightText
    val muted = if (isDark) SonaraDesign.DarkMuted else SonaraDesign.LightMuted
    val accent = themeViewModel.getAccentColor(isDark)

    var searchQuery by remember { mutableStateOf("") }
    val allTracks = viewModel.sortedTracks
    val filteredTracks = allTracks.filter {
        it.title.contains(searchQuery, ignoreCase = true) ||
        it.artist.contains(searchQuery, ignoreCase = true) ||
        it.album.contains(searchQuery, ignoreCase = true)
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(bg),
        contentPadding = PaddingValues(bottom = 180.dp)
    ) {
        // Banner Header
        item {
            Box(modifier = Modifier.padding(horizontal = 20.dp, vertical = 20.dp)) {
                PageBanner(
                    title = "All Music",
                    subtitle = if (searchQuery.length > 0) "${filteredTracks.size} results for \"$searchQuery\"" else "${allTracks.size} tracks",
                    tone = SonaraDesign.SoundscapeTones[2]
                )
            }
        }

        // Search & Sort Bar
        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .padding(bottom = 16.dp)
            ) {
                // Search Input
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(999.dp),
                    color = paper,
                    border = BorderStroke(1.dp, line)
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.Search,
                            contentDescription = null,
                            tint = muted,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(Modifier.width(10.dp))
                        BasicTextField(
                            value = searchQuery,
                            onValueChange = { searchQuery = it },
                            modifier = Modifier.weight(1f),
                            textStyle = TextStyle(color = text, fontSize = 14.sp),
                            cursorBrush = SolidColor(accent),
                            singleLine = true,
                            decorationBox = { innerTextField ->
                                if (searchQuery.isEmpty()) {
                                    Text("Search your library", color = muted, fontSize = 14.sp)
                                }
                                innerTextField()
                            }
                        )
                        if (searchQuery.length > 0) {
                            IconButton(
                                onClick = { searchQuery = "" },
                                modifier = Modifier.size(20.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Close,
                                    contentDescription = "Clear",
                                    tint = muted,
                                    modifier = Modifier.size(16.dp)
                                )
                            }
                        }
                    }
                }

                Spacer(Modifier.height(14.dp))

                // Sort Chips
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Sort by", color = muted, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                    listOf("Name", "Artist", "Date", "Size").forEach { type ->
                        val selected = viewModel.sortType == type
                        Text(
                            text = type,
                            color = if (selected) text else muted,
                            fontSize = 13.sp,
                            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                            modifier = Modifier
                                .clickable { viewModel.sortType = type }
                                .padding(vertical = 4.dp)
                        )
                    }
                }
            }
        }

        // Tracklist
        itemsIndexed(filteredTracks) { index, track ->
            TrackRow(
                trackIndex = index + 1,
                track = track,
                isCurrent = viewModel.currentTrack?.id == track.id,
                isPlaying = viewModel.isPlaying && viewModel.currentTrack?.id == track.id,
                isLiked = viewModel.favoriteTracks.value.contains(track.id),
                showWaveform = themeViewModel.showWaveforms,
                compact = themeViewModel.compactRows,
                accentColor = accent,
                textColor = text,
                mutedColor = muted,
                lineColor = line,
                onPlay = { viewModel.playFromList(filteredTracks, index, "All Music") },
                onToggleLike = { viewModel.toggleFavorite(track.id) },
                onShowOptions = { onAddTrack(track) }
            )
        }
    }
}

/* -------------------------------------------------------------------------- */
/*  Library View                                                              */
/* -------------------------------------------------------------------------- */

@Composable
fun LiquidLibrary(
    viewModel: MainViewModel,
    themeViewModel: ThemeViewModel,
    systemDark: Boolean,
    onCreatePlaylist: () -> Unit,
    onFolderClick: (Folder) -> Unit
) {
    val isDark = themeViewModel.isDark(systemDark)
    val bg = if (isDark) SonaraDesign.DarkBg else SonaraDesign.LightBg
    val paper = if (isDark) SonaraDesign.DarkPaper else SonaraDesign.LightPaper
    val line = if (isDark) SonaraDesign.DarkLine else SonaraDesign.LightLine
    val text = if (isDark) SonaraDesign.DarkText else SonaraDesign.LightText
    val muted = if (isDark) SonaraDesign.DarkMuted else SonaraDesign.LightMuted
    val accent = themeViewModel.getAccentColor(isDark)

    var selectedTab by remember { mutableIntStateOf(0) }

    val libraryTracks = remember(viewModel.allTracks) {
        viewModel.allTracks.sortedByDescending { it.dateAdded }
    }
    val albumPairs = remember(viewModel.folders) { viewModel.folders.chunked(2) }
    val artistPairs = remember(viewModel.artistFolders) { viewModel.artistFolders.chunked(2) }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(bg),
        contentPadding = PaddingValues(bottom = 180.dp)
    ) {
        // Banner Header
        item {
            Box(modifier = Modifier.padding(horizontal = 20.dp, vertical = 20.dp)) {
                PageBanner(
                    title = "Library",
                    subtitle = "Everything you have saved, in one place.",
                    tone = SonaraDesign.SoundscapeTones[1]
                )
            }
        }

        // Section Tabs
        item {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .padding(bottom = 20.dp),
                horizontalArrangement = Arrangement.spacedBy(20.dp)
            ) {
                listOf("Songs", "Albums", "Artists", "Playlists").forEachIndexed { index, label ->
                    val selected = selectedTab == index
                    Column(
                        modifier = Modifier
                            .clickable { selectedTab = index }
                            .padding(bottom = 6.dp)
                    ) {
                        Text(
                            text = label,
                            color = if (selected) text else muted,
                            fontSize = 18.sp,
                            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium
                        )
                        Spacer(Modifier.height(4.dp))
                        if (selected) {
                            Box(
                                modifier = Modifier
                                    .width(28.dp)
                                    .height(3.dp)
                                    .clip(RoundedCornerShape(2.dp))
                                    .background(accent)
                            )
                        }
                    }
                }
            }
        }

        when (selectedTab) {
            0 -> {
                // Songs Tab
                itemsIndexed(libraryTracks, key = { _, track -> track.id }) { index, track ->
                    TrackRow(
                        trackIndex = index + 1,
                        track = track,
                        isCurrent = viewModel.currentTrack?.id == track.id,
                        isPlaying = viewModel.isPlaying && viewModel.currentTrack?.id == track.id,
                        isLiked = viewModel.favoriteTracks.value.contains(track.id),
                        showWaveform = themeViewModel.showWaveforms,
                        compact = themeViewModel.compactRows,
                        accentColor = accent,
                        textColor = text,
                        mutedColor = muted,
                        lineColor = line,
                        onPlay = { viewModel.playFromList(libraryTracks, index, "Library") },
                        onToggleLike = { viewModel.toggleFavorite(track.id) },
                        onShowOptions = { }
                    )
                }
            }

            1 -> {
                // Albums Tab
                itemsIndexed(albumPairs, key = { pIdx: Int, pair: List<Folder> -> pair.firstOrNull()?.name ?: pIdx.toString() }) { _, pair: List<Folder> ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 20.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        for (folder in pair) {
                            AlbumCard(
                                folder = folder,
                                modifier = Modifier.weight(1f),
                                textColor = text,
                                mutedColor = muted,
                                accentColor = accent,
                                spin = themeViewModel.spinRecords,
                                onClick = { onFolderClick(folder) },
                                onPlay = { viewModel.startPlayback(folder.tracks, 0, folder.name) }
                            )
                        }
                        if (pair.size == 1) {
                            Spacer(Modifier.weight(1f))
                        }
                    }
                }
            }

            2 -> {
                // Artists Tab
                itemsIndexed(artistPairs, key = { pIdx: Int, pair: List<Folder> -> pair.firstOrNull()?.name ?: pIdx.toString() }) { _, pair: List<Folder> ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 20.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        for (folder in pair) {
                            ArtistCard(
                                folder = folder,
                                modifier = Modifier.weight(1f),
                                textColor = text,
                                mutedColor = muted,
                                accentColor = accent,
                                onClick = { onFolderClick(folder) },
                                onPlay = { viewModel.startPlayback(folder.tracks, 0, folder.name) }
                            )
                        }
                        if (pair.size == 1) {
                            Spacer(Modifier.weight(1f))
                        }
                    }
                }
            }

            3 -> {
                // Playlists Tab
                item(key = "create_playlist_btn") {
                    Box(modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp)) {
                        Surface(
                            onClick = onCreatePlaylist,
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(16.dp),
                            color = paper,
                            border = BorderStroke(1.dp, line)
                        ) {
                            Row(
                                modifier = Modifier.padding(16.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(Icons.Default.Add, contentDescription = null, tint = accent, modifier = Modifier.size(22.dp))
                                Spacer(Modifier.width(12.dp))
                                Text("Create New Playlist", color = text, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }

                itemsIndexed(viewModel.userPlaylists, key = { _: Int, folder: Folder -> folder.name }) { _, folder: Folder ->
                    Box(modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp)) {
                        Surface(
                            onClick = { onFolderClick(folder) },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(16.dp),
                            color = paper,
                            border = BorderStroke(1.dp, line)
                        ) {
                            Row(
                                modifier = Modifier.padding(14.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                CoverArt(
                                    track = folder.tracks.firstOrNull(),
                                    sizeDp = 48.dp
                                )
                                Spacer(Modifier.width(14.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(folder.name, color = text, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                                    Text("${folder.tracks.size} tracks", color = muted, fontSize = 12.sp)
                                }
                                IconButton(
                                    onClick = { if (folder.tracks.size > 0) viewModel.startPlayback(folder.tracks, 0, folder.name) }
                                ) {
                                    Icon(Icons.Default.PlayArrow, contentDescription = null, tint = accent, modifier = Modifier.size(24.dp))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/* -------------------------------------------------------------------------- */
/*  Reusable Track Row & Cards                                                */
/* -------------------------------------------------------------------------- */

@Composable
fun TrackRow(
    trackIndex: Int,
    track: Track,
    isCurrent: Boolean,
    isPlaying: Boolean,
    isLiked: Boolean,
    showWaveform: Boolean,
    compact: Boolean,
    accentColor: Color,
    textColor: Color,
    mutedColor: Color,
    lineColor: Color,
    onPlay: () -> Unit,
    onToggleLike: () -> Unit,
    onShowOptions: () -> Unit
) {
    val rowHeight = if (compact) 52.dp else 66.dp

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(rowHeight)
            .clickable { onPlay() }
            .padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Track Index Number or EQ
        Box(
            modifier = Modifier.width(32.dp),
            contentAlignment = Alignment.Center
        ) {
            if (isCurrent && isPlaying) {
                Icon(
                    imageVector = Icons.Default.GraphicEq,
                    contentDescription = null,
                    tint = accentColor,
                    modifier = Modifier.size(18.dp)
                )
            } else {
                Text(
                    text = if (trackIndex < 10) "0$trackIndex" else "$trackIndex",
                    color = if (isCurrent) accentColor else mutedColor,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium
                )
            }
        }

        Spacer(Modifier.width(8.dp))

        // Cover Art
        CoverArt(
            track = track,
            sizeDp = if (compact) 36.dp else 46.dp
        )

        Spacer(Modifier.width(12.dp))

        // Title & Artist
        Column(modifier = Modifier.weight(1.5f)) {
            Text(
                text = track.title,
                color = if (isCurrent) accentColor else textColor,
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = track.artist,
                color = mutedColor,
                fontSize = 12.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }

        // Dotted leader & Waveform preview
        if (showWaveform) {
            Spacer(Modifier.width(8.dp))
            WaveformView(
                seed = abs(SonaraDesign.hashString(track.id.toString())),
                active = isCurrent,
                accentColor = accentColor,
                modifier = Modifier.width(60.dp)
            )
        }

        Spacer(Modifier.width(8.dp))

        // Track duration
        Text(
            text = formatTrackTime(track.duration),
            color = mutedColor,
            fontSize = 12.sp
        )

        Spacer(Modifier.width(4.dp))

        // Heart Icon
        IconButton(
            onClick = onToggleLike,
            modifier = Modifier.size(36.dp)
        ) {
            Icon(
                imageVector = if (isLiked) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                contentDescription = null,
                tint = if (isLiked) accentColor else mutedColor,
                modifier = Modifier.size(18.dp)
            )
        }
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(0.5.dp)
            .padding(horizontal = 20.dp)
            .background(lineColor.copy(alpha = 0.5f))
    )
}

@Composable
fun AlbumCard(
    folder: Folder,
    modifier: Modifier = Modifier,
    textColor: Color,
    mutedColor: Color,
    accentColor: Color,
    spin: Boolean,
    onClick: () -> Unit,
    onPlay: () -> Unit
) {
    Column(
        modifier = modifier.clickable { onClick() }
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(1f)
        ) {
            SleeveStack(
                track = folder.tracks.firstOrNull(),
                playing = false,
                spin = spin,
                onClick = onClick,
                modifier = Modifier.fillMaxSize()
            )

            IconButton(
                onClick = onPlay,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(8.dp)
                    .size(38.dp)
                    .background(SonaraDesign.DarkInk, CircleShape)
            ) {
                Icon(
                    imageVector = Icons.Default.PlayArrow,
                    contentDescription = null,
                    tint = SonaraDesign.DarkOnInk,
                    modifier = Modifier.size(22.dp)
                )
            }
        }

        Spacer(Modifier.height(8.dp))

        Text(
            text = folder.name,
            color = textColor,
            fontSize = 14.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Text(
            text = "${folder.tracks.size} tracks",
            color = mutedColor,
            fontSize = 12.sp
        )
    }
}

@Composable
fun ArtistCard(
    folder: Folder,
    modifier: Modifier = Modifier,
    textColor: Color,
    mutedColor: Color,
    accentColor: Color,
    onClick: () -> Unit,
    onPlay: () -> Unit
) {
    Column(
        modifier = modifier.clickable { onClick() },
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            modifier = Modifier
                .size(120.dp)
                .clip(CircleShape)
        ) {
            CoverArt(
                track = folder.tracks.firstOrNull(),
                sizeDp = 120.dp,
                round = true
            )
            IconButton(
                onClick = onPlay,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(4.dp)
                    .size(34.dp)
                    .background(SonaraDesign.DarkInk, CircleShape)
            ) {
                Icon(
                    imageVector = Icons.Default.PlayArrow,
                    contentDescription = null,
                    tint = SonaraDesign.DarkOnInk,
                    modifier = Modifier.size(18.dp)
                )
            }
        }

        Spacer(Modifier.height(8.dp))

        Text(
            text = folder.name,
            color = textColor,
            fontSize = 14.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Text(
            text = "${folder.tracks.size} tracks",
            color = mutedColor,
            fontSize = 12.sp
        )
    }
}

@Composable
fun LiquidFolderDetail(
    viewModel: MainViewModel,
    themeViewModel: ThemeViewModel,
    systemDark: Boolean,
    onShowOptions: (Track) -> Unit,
    onBack: () -> Unit
) {
    val folder = viewModel.currentFolder ?: return
    val isDark = themeViewModel.isDark(systemDark)
    val bg = if (isDark) SonaraDesign.DarkBg else SonaraDesign.LightBg
    val paper = if (isDark) SonaraDesign.DarkPaper else SonaraDesign.LightPaper
    val line = if (isDark) SonaraDesign.DarkLine else SonaraDesign.LightLine
    val text = if (isDark) SonaraDesign.DarkText else SonaraDesign.LightText
    val muted = if (isDark) SonaraDesign.DarkMuted else SonaraDesign.LightMuted
    val accent = themeViewModel.getAccentColor(isDark)

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(bg),
        contentPadding = PaddingValues(bottom = 180.dp)
    ) {
        item {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp)
            ) {
                IconButton(
                    onClick = onBack,
                    modifier = Modifier.size(40.dp)
                ) {
                    Icon(Icons.Default.ArrowBack, contentDescription = null, tint = text)
                }
            }
        }

        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                SleeveStack(
                    track = folder.tracks.firstOrNull(),
                    playing = false,
                    spin = themeViewModel.spinRecords,
                    modifier = Modifier
                        .fillMaxWidth(0.8f)
                        .padding(bottom = 20.dp)
                )

                Text(
                    text = folder.name,
                    color = text,
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = "${folder.tracks.size} tracks",
                    color = muted,
                    fontSize = 14.sp
                )

                Spacer(Modifier.height(20.dp))

                Row(
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Button(
                        onClick = { viewModel.startPlayback(folder.tracks, 0, folder.name, false) },
                        colors = ButtonDefaults.buttonColors(containerColor = text),
                        shape = RoundedCornerShape(999.dp)
                    ) {
                        Icon(Icons.Default.PlayArrow, contentDescription = null, tint = bg, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Play", color = bg, fontWeight = FontWeight.Bold)
                    }

                    Button(
                        onClick = { viewModel.startPlayback(folder.tracks, 0, folder.name, true) },
                        colors = ButtonDefaults.buttonColors(containerColor = paper),
                        border = BorderStroke(1.5.dp, line),
                        shape = RoundedCornerShape(999.dp)
                    ) {
                        Icon(Icons.Default.Shuffle, contentDescription = null, tint = text, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Shuffle", color = text, fontWeight = FontWeight.Bold)
                    }
                }

                Spacer(Modifier.height(24.dp))
            }
        }

        itemsIndexed(folder.tracks) { index, track ->
            TrackRow(
                trackIndex = index + 1,
                track = track,
                isCurrent = viewModel.currentTrack?.id == track.id,
                isPlaying = viewModel.isPlaying && viewModel.currentTrack?.id == track.id,
                isLiked = viewModel.favoriteTracks.value.contains(track.id),
                showWaveform = themeViewModel.showWaveforms,
                compact = themeViewModel.compactRows,
                accentColor = accent,
                textColor = text,
                mutedColor = muted,
                lineColor = line,
                onPlay = { viewModel.playFromList(folder.tracks, index, folder.name) },
                onToggleLike = { viewModel.toggleFavorite(track.id) },
                onShowOptions = { onShowOptions(track) }
            )
        }
    }
}

private fun formatTrackTime(ms: Long): String {
    val totalSeconds = if (ms / 1000 < 0) 0 else ms / 1000
    val minutes = totalSeconds / 60
    val seconds = totalSeconds % 60
    return "$minutes:${if (seconds < 10) "0$seconds" else "$seconds"}"
}
