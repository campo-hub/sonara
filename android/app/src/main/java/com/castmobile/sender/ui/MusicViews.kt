package com.sonara.app.ui

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.sonara.app.model.Folder
import com.sonara.app.model.Track

/**
 * All Music Screen - matches reference exactly
 * - "All Music" header with track count
 * - Search bar with filter icon
 * - Sort chips: Name, Date Added, Size
 * - Track list with waveform viz
 */
@Composable
fun LiquidAllMusic(
    viewModel: MainViewModel,
    themeViewModel: ThemeViewModel,
    onAddTrack: (Track) -> Unit,
    onTrackClick: (Track, List<Track>) -> Unit
) {
    var searchQuery by remember { mutableStateOf("") }
    val filteredTracks = viewModel.sortedTracks.filter {
        it.title.contains(searchQuery, ignoreCase = true) ||
        it.artist.contains(searchQuery, ignoreCase = true)
    }

    Column(modifier = Modifier.fillMaxSize()) {
        // Header
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .padding(top = 60.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "All Music",
                    style = MaterialTheme.typography.headlineLarge,
                    fontWeight = FontWeight.Bold,
                    color = Color.White
                )
                Text(
                    "${filteredTracks.size} tracks",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color.White.copy(alpha = 0.4f)
                )
            }
            
            Spacer(Modifier.height(20.dp))
            
            // Search bar
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(14.dp),
                color = Color(0xFF1A1A1E),
                border = BorderStroke(1.dp, Color.White.copy(alpha = 0.06f))
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        Icons.Default.Search,
                        contentDescription = null,
                        tint = Color.White.copy(alpha = 0.3f),
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(Modifier.width(12.dp))
                    BasicTextField(
                        value = searchQuery,
                        onValueChange = { searchQuery = it },
                        modifier = Modifier.weight(1f),
                        textStyle = TextStyle(color = Color.White, fontSize = 15.sp),
                        cursorBrush = SolidColor(themeViewModel.primary),
                        singleLine = true,
                        decorationBox = { innerTextField ->
                            if (searchQuery.isEmpty()) {
                                Text("Search songs, artists, albums...", color = Color.White.copy(alpha = 0.3f), fontSize = 15.sp)
                            }
                            innerTextField()
                        }
                    )
                    // Filter icon
                    Icon(
                        Icons.Default.FilterList,
                        contentDescription = null,
                        tint = Color.White.copy(alpha = 0.3f),
                        modifier = Modifier.size(20.dp)
                    )
                }
            }
            
            Spacer(Modifier.height(16.dp))
            
            // Sort chips
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("Name", "Date Added", "Size").forEach { type ->
                    val selected = viewModel.sortType == type
                    Surface(
                        onClick = { viewModel.sortType = type },
                        shape = RoundedCornerShape(10.dp),
                        color = if (selected) themeViewModel.primary.copy(alpha = 0.15f) else Color(0xFF1A1A1E),
                        border = BorderStroke(1.dp, if (selected) themeViewModel.primary.copy(alpha = 0.4f) else Color.White.copy(alpha = 0.06f))
                    ) {
                        Text(
                            type,
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                            color = if (selected) themeViewModel.primary else Color.White.copy(alpha = 0.5f),
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium
                        )
                    }
                }
            }
        }

        Spacer(Modifier.height(16.dp))

        // Track list
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 160.dp)
        ) {
            items(filteredTracks) { track ->
                TrackListItem(
                    track = track,
                    viewModel = viewModel,
                    themeViewModel = themeViewModel,
                    onShowOptions = { onAddTrack(track) },
                    onClick = { onTrackClick(track, filteredTracks) }
                )
            }
        }
    }
}

@Composable
fun TrackListItem(
    track: Track,
    viewModel: MainViewModel,
    themeViewModel: ThemeViewModel,
    onShowOptions: (Track) -> Unit,
    onClick: () -> Unit
) {
    val isPlaying = viewModel.currentTrack?.id == track.id && viewModel.isPlaying

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 24.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        AsyncImage(
            model = track.albumArtUri,
            contentDescription = null,
            modifier = Modifier
                .size(50.dp)
                .clip(RoundedCornerShape(12.dp)),
            contentScale = ContentScale.Crop
        )

        Spacer(Modifier.width(14.dp))

        Column(modifier = Modifier.weight(1f)) {
            Text(
                track.title,
                color = if (isPlaying) themeViewModel.primary else Color.White,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                track.artist,
                color = Color.White.copy(alpha = 0.4f),
                fontSize = 12.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }

        Canvas(modifier = Modifier.width(60.dp).height(24.dp)) {
            val barCount = 20
            val barWidth = 2f
            val gap = (size.width - barCount * barWidth) / (barCount - 1)

            for (i in 0 until barCount) {
                val height = (4f + (Math.sin(i * 0.8) * 8f + Math.random() * 4f)).toFloat().coerceIn(2f, size.height)
                drawLine(
                    color = themeViewModel.primary.copy(alpha = 0.4f),
                    start = Offset(i * (barWidth + gap), (size.height - height) / 2),
                    end = Offset(i * (barWidth + gap), (size.height + height) / 2),
                    strokeWidth = barWidth,
                    cap = androidx.compose.ui.graphics.StrokeCap.Round
                )
            }
        }

        Spacer(Modifier.width(12.dp))

        Text(
            formatTime(track.duration),
            style = MaterialTheme.typography.bodySmall,
            color = Color.White.copy(alpha = 0.3f)
        )

        IconButton(onClick = { onShowOptions(track) }, modifier = Modifier.size(32.dp)) {
            Icon(
                Icons.Default.MoreVert,
                contentDescription = null,
                tint = Color.White.copy(alpha = 0.3f),
                modifier = Modifier.size(18.dp)
            )
        }
    }
}

/**
 * Library Screen - matches reference exactly
 * - "My Library" header
 * - Tab: Folders, Playlists, Artists
 * - Recent Folders horizontal cards
 * - Playlists horizontal cards
 * - Artists section
 */
@Composable
fun LiquidLibrary(
    viewModel: MainViewModel,
    themeViewModel: ThemeViewModel,
    onCreatePlaylist: () -> Unit,
    onFolderClick: (Folder) -> Unit
) {
    var selectedTab by remember { mutableIntStateOf(0) }

    Column(modifier = Modifier.fillMaxSize()) {
        // Header
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .padding(top = 60.dp)
        ) {
            Text(
                "My Library",
                style = MaterialTheme.typography.headlineLarge,
                fontWeight = FontWeight.Bold,
                color = Color.White
            )
            
            Spacer(Modifier.height(20.dp))
            
            // Tab selector
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                color = Color(0xFF1A1A1E)
            ) {
                Row(modifier = Modifier.padding(4.dp)) {
                    listOf("Folders", "Playlists", "Artists").forEachIndexed { index, label ->
                        val selected = selectedTab == index
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .height(36.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(
                                    if (selected) themeViewModel.primary else Color.Transparent
                                )
                                .clickable { selectedTab = index },
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                label,
                                color = if (selected) Color.White else Color.White.copy(alpha = 0.4f),
                                fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                                fontSize = 13.sp
                            )
                        }
                    }
                }
            }
        }

        Spacer(Modifier.height(24.dp))

        when (selectedTab) {
            0 -> FoldersTab(viewModel, onFolderClick)
            1 -> PlaylistsTab(viewModel, themeViewModel, onCreatePlaylist, onFolderClick)
            2 -> ArtistsTab(viewModel, themeViewModel, onFolderClick)
        }
    }
}

@Composable
fun FoldersTab(viewModel: MainViewModel, onFolderClick: (Folder) -> Unit) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 160.dp)
    ) {
        // Section header
        item {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("All Folders", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                Text("${viewModel.folders.size} folders", color = Color.White.copy(alpha = 0.4f), fontSize = 13.sp)
            }
        }
        
        // All Folders list - vertical only
        items(viewModel.folders) { folder ->
            LibraryListItem(folder) { onFolderClick(folder) }
        }
    }
}

@Composable
fun PlaylistsTab(viewModel: MainViewModel, themeViewModel: ThemeViewModel, onCreatePlaylist: () -> Unit, onFolderClick: (Folder) -> Unit) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 160.dp)
    ) {
        // Create playlist button
        item {
            Surface(
                onClick = onCreatePlaylist,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp, vertical = 12.dp)
                    .height(56.dp),
                shape = RoundedCornerShape(14.dp),
                color = Color(0xFF1A1A1E),
                border = BorderStroke(1.dp, Color.White.copy(alpha = 0.06f))
            ) {
                Row(
                    modifier = Modifier.fillMaxSize(),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Default.Add, contentDescription = null, tint = Color.White.copy(alpha = 0.5f))
                    Spacer(Modifier.width(8.dp))
                    Text("Create New Playlist", color = Color.White.copy(alpha = 0.5f), fontSize = 14.sp)
                }
            }
        }
        
        // Section header
        item {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Your Playlists", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                Text("${viewModel.userPlaylists.size} playlists", color = Color.White.copy(alpha = 0.4f), fontSize = 13.sp)
            }
        }
        
        // Playlists list - vertical only
        items(viewModel.userPlaylists) { folder ->
            LibraryListItem(folder) { onFolderClick(folder) }
        }
    }
}

@Composable
fun ArtistsTab(viewModel: MainViewModel, themeViewModel: ThemeViewModel, onFolderClick: (Folder) -> Unit) {
    var artistSearch by remember { mutableStateOf("") }
    val filteredArtists = viewModel.artistFolders.filter {
        it.name.contains(artistSearch, ignoreCase = true)
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 160.dp)
    ) {
        item {
            Column(modifier = Modifier.padding(horizontal = 24.dp, vertical = 12.dp)) {
                Text("Artists", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                Spacer(Modifier.height(12.dp))

                // Artist search bar
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    color = Color(0xFF1A1A1E),
                    border = BorderStroke(1.dp, Color.White.copy(alpha = 0.06f))
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Default.Search,
                            contentDescription = null,
                            tint = Color.White.copy(alpha = 0.3f),
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(Modifier.width(10.dp))
                        BasicTextField(
                            value = artistSearch,
                            onValueChange = { artistSearch = it },
                            modifier = Modifier.weight(1f),
                            textStyle = TextStyle(color = Color.White, fontSize = 14.sp),
                            cursorBrush = SolidColor(themeViewModel.primary),
                            singleLine = true,
                            decorationBox = { innerTextField ->
                                if (artistSearch.isEmpty()) {
                                    Text("Search artists...", color = Color.White.copy(alpha = 0.3f), fontSize = 14.sp)
                                }
                                innerTextField()
                            }
                        )
                        if (artistSearch.isNotEmpty()) {
                            IconButton(
                                onClick = { artistSearch = "" },
                                modifier = Modifier.size(20.dp)
                            ) {
                                Icon(
                                    Icons.Default.Close,
                                    contentDescription = "Clear",
                                    tint = Color.White.copy(alpha = 0.3f),
                                    modifier = Modifier.size(16.dp)
                                )
                            }
                        }
                    }
                }

                Spacer(Modifier.height(16.dp))
            }
        }

        items(filteredArtists) { folder ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onFolderClick(folder) }
                    .padding(horizontal = 24.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                AsyncImage(
                    model = folder.coverArtUri,
                    contentDescription = null,
                    modifier = Modifier
                        .size(50.dp)
                        .clip(CircleShape),
                    contentScale = ContentScale.Crop
                )
                Spacer(Modifier.width(14.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(folder.name, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                    Text("${folder.trackCount} tracks", color = Color.White.copy(alpha = 0.4f), fontSize = 12.sp)
                }
                Icon(Icons.Default.ChevronRight, contentDescription = null, tint = Color.White.copy(alpha = 0.15f), modifier = Modifier.size(20.dp))
            }
        }

        if (filteredArtists.isEmpty() && artistSearch.isNotEmpty()) {
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(48.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        "No artists found",
                        color = Color.White.copy(alpha = 0.3f),
                        fontSize = 14.sp
                    )
                }
            }
        }
    }
}

@Composable
fun LibraryHorizontalCard(folder: Folder, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        modifier = Modifier
            .width(130.dp)
            .height(150.dp),
        shape = RoundedCornerShape(16.dp),
        color = Color(0xFF1A1A1E),
        border = BorderStroke(1.dp, Color.White.copy(alpha = 0.06f))
    ) {
        Box {
            AsyncImage(
                model = folder.coverArtUri,
                contentDescription = null,
                modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(16.dp)),
                contentScale = ContentScale.Crop,
                alpha = 0.7f
            )
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.9f))))
            )
            Column(
                modifier = Modifier.fillMaxSize().padding(12.dp),
                verticalArrangement = Arrangement.Bottom
            ) {
                Text(folder.name, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text("${folder.trackCount} tracks", color = Color.White.copy(alpha = 0.5f), fontSize = 11.sp)
            }
        }
    }
}

@Composable
fun LibraryListItem(folder: Folder, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 24.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        AsyncImage(
            model = folder.coverArtUri,
            contentDescription = null,
            modifier = Modifier.size(52.dp).clip(RoundedCornerShape(12.dp)),
            contentScale = ContentScale.Crop
        )
        Spacer(Modifier.width(14.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(folder.name, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("${folder.trackCount} tracks", color = Color.White.copy(alpha = 0.4f), fontSize = 12.sp)
        }
        Icon(Icons.Default.ChevronRight, contentDescription = null, tint = Color.White.copy(alpha = 0.15f), modifier = Modifier.size(20.dp))
    }
}

@Composable
fun LiquidFolderDetail(
    viewModel: MainViewModel,
    themeViewModel: ThemeViewModel,
    onShowOptions: (Track) -> Unit,
    onBack: () -> Unit
) {
    val folder = viewModel.currentFolder ?: return
    val totalDuration = folder.tracks.sumOf { it.duration }

    LazyColumn(modifier = Modifier.fillMaxSize()) {
        // Hero image
        item {
            Box(modifier = Modifier.fillMaxWidth().height(320.dp)) {
                AsyncImage(
                    model = folder.coverArtUri,
                    contentDescription = null,
                    modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(0.dp)),
                    contentScale = ContentScale.Crop
                )
                // Gradient overlay
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black)))
                )
                // Back button
                IconButton(
                    onClick = onBack,
                    modifier = Modifier.padding(16.dp).statusBarsPadding()
                ) {
                    Icon(Icons.Default.ArrowBack, contentDescription = null, tint = Color.White)
                }
            }
        }
        
        // Folder info
        item {
            Column(
                modifier = Modifier.padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    folder.name,
                    style = MaterialTheme.typography.headlineLarge,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                    textAlign = TextAlign.Center,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    "${folder.trackCount} tracks \u00b7 ${formatDuration(totalDuration)}",
                    color = Color.White.copy(alpha = 0.5f),
                    style = MaterialTheme.typography.bodyMedium
                )
                
                Spacer(Modifier.height(20.dp))
                
                // Play buttons
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Button(
                        onClick = { folder.tracks.firstOrNull()?.let { viewModel.playTrack(it, folder.tracks) } },
                        modifier = Modifier.weight(1f).height(52.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = themeViewModel.primary),
                        shape = RoundedCornerShape(14.dp)
                    ) {
                        Icon(Icons.Default.PlayArrow, contentDescription = null, tint = Color.White)
                        Spacer(Modifier.width(8.dp))
                        Text("Play All", color = Color.White, fontWeight = FontWeight.Bold)
                    }
                    OutlinedButton(
                        onClick = { viewModel.toggleShuffle(); folder.tracks.firstOrNull()?.let { viewModel.playTrack(it, folder.tracks) } },
                        modifier = Modifier.weight(1f).height(52.dp),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White),
                        shape = RoundedCornerShape(14.dp),
                        border = BorderStroke(1.dp, Color.White.copy(alpha = 0.15f))
                    ) {
                        Icon(Icons.Default.Shuffle, contentDescription = null, tint = Color.White)
                        Spacer(Modifier.width(8.dp))
                        Text("Shuffle", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
        
        // Track list
        items(folder.tracksIndexed()) { (index, track) ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { viewModel.playTrack(track, folder.tracks) }
                    .padding(horizontal = 24.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "${index + 1}",
                    color = Color.White.copy(alpha = 0.3f),
                    fontSize = 14.sp,
                    modifier = Modifier.width(24.dp)
                )
                AsyncImage(
                    model = track.albumArtUri,
                    contentDescription = null,
                    modifier = Modifier.size(44.dp).clip(RoundedCornerShape(10.dp)),
                    contentScale = ContentScale.Crop
                )
                Spacer(Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(track.title, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(track.artist, color = Color.White.copy(alpha = 0.4f), fontSize = 12.sp, maxLines = 1)
                }
                Text(formatTime(track.duration), color = Color.White.copy(alpha = 0.3f), fontSize = 12.sp)
                IconButton(onClick = { onShowOptions(track) }, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Default.MoreVert, contentDescription = null, tint = Color.White.copy(alpha = 0.3f), modifier = Modifier.size(16.dp))
                }
            }
        }
        
        item { Spacer(Modifier.height(120.dp)) }
    }
}

fun Folder.tracksIndexed(): List<Pair<Int, Track>> = tracks.mapIndexed { index, track -> Pair(index, track) }

fun formatDuration(ms: Long): String {
    val seconds = ms / 1000
    val minutes = seconds / 60
    val hours = minutes / 60
    return if (hours > 0) "${hours}h ${minutes % 60}m" else "${minutes}m"
}
