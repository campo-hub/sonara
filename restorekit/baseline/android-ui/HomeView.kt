package com.sonara.app.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.LocalContext
import com.sonara.app.model.Folder
import com.sonara.app.model.Track
import java.util.Calendar

private fun mixSeedValue(value: String): Int {
    var hash = 2166136261L
    for (char in value) {
        hash = (hash xor char.code.toLong()) * 16777619L and 0x7fffffffL
    }
    return (hash and 0x7fffffffL).toInt()
}

private fun buildDailyMixTracks(tracks: List<Track>, userId: String, dateKey: String, limit: Int = 5): List<Track> {
    if (tracks.isEmpty()) return emptyList()
    val safeLimit = maxOf(1, minOf(limit, tracks.size))
    val seed = "$dateKey:$userId:daily"
    return tracks
        .map { track -> track to mixSeedValue("$seed:${track.id}:${track.title}:${track.artist}") }
        .sortedBy { it.second }
        .map { it.first }
        .take(safeLimit)
}

private fun pickFeaturedTrack(tracks: List<Track>, recentIds: Set<Long>, history: List<String>): Track? {
    val playable = tracks.filter { it.remoteId != null }
    if (playable.isEmpty()) return null
    val exclusionCount = minOf(10, playable.size / 2)
    val blocked = history.takeLast(exclusionCount).toSet()
    val eligible = playable.filter { it.id !in recentIds && it.remoteId !in blocked }
    return (eligible.ifEmpty { playable.filter { it.remoteId != history.lastOrNull() }.ifEmpty { playable } }).randomOrNull()
}

@Composable
fun LiquidHome(
    viewModel: MainViewModel,
    themeViewModel: ThemeViewModel,
    systemDark: Boolean,
    onUpload: () -> Unit,
    onSignOut: () -> Unit,
    onFolderClick: (Folder) -> Unit
) {
    var showAuthDialog by remember { mutableStateOf(false) }

    if (showAuthDialog) {
        SonaraAuthDialog(
            viewModel = viewModel,
            themeViewModel = themeViewModel,
            systemDark = systemDark,
            onDismiss = { showAuthDialog = false }
        )
    }

    OfflineHomeView(
        viewModel = viewModel,
        themeViewModel = themeViewModel,
        systemDark = systemDark,
        onUpload = onUpload,
        onOpenAuth = { showAuthDialog = true },
        onSignOut = onSignOut,
        onFolderClick = onFolderClick
    )
}

@Composable
private fun OnlineTransitionScreen(
    themeViewModel: ThemeViewModel,
    systemDark: Boolean
) {
    val isDark = themeViewModel.isDark(systemDark)
    val bg = themeViewModel.surfaceTint
    val text = if (isDark) SonaraDesign.DarkText else SonaraDesign.LightText
    val muted = if (isDark) SonaraDesign.DarkMuted else SonaraDesign.LightMuted
    val accent = themeViewModel.getAccentColor(isDark)

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(modifier = Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
            modifier = Modifier.padding(32.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(80.dp)
                    .clip(CircleShape)
                    .background(accent.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(
                    modifier = Modifier.size(44.dp),
                    color = accent,
                    strokeWidth = 3.dp
                )
            }

            Spacer(Modifier.height(24.dp))

            Text(
                text = "SONARA CLOUD",
                color = text,
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 2.sp
            )

            Spacer(Modifier.height(8.dp))

            Text(
                text = "Connecting to live cloud studio...",
                color = muted,
                fontSize = 14.sp,
                textAlign = TextAlign.Center
            )
        }
    }
}

@Composable
private fun OnlineHomeView(
    viewModel: MainViewModel,
    themeViewModel: ThemeViewModel,
    systemDark: Boolean,
    onOpenAuth: () -> Unit,
    onFolderClick: (Folder) -> Unit
) {
    val isDark = themeViewModel.isDark(systemDark)
    val bg = themeViewModel.surfaceTint
    val paper = if (isDark) SonaraDesign.DarkPaper else SonaraDesign.LightPaper
    val line = if (isDark) SonaraDesign.DarkLine else SonaraDesign.LightLine
    val text = if (isDark) SonaraDesign.DarkText else SonaraDesign.LightText
    val muted = if (isDark) SonaraDesign.DarkMuted else SonaraDesign.LightMuted
    val accent = themeViewModel.getAccentColor(isDark)

    var searchQuery by remember { mutableStateOf("") }
    val onlineTracks = viewModel.remoteTracks.ifEmpty { viewModel.allTracks }
    val filteredTracks = if (searchQuery.isBlank()) onlineTracks else onlineTracks.filter {
        it.title.contains(searchQuery, ignoreCase = true) ||
        it.artist.contains(searchQuery, ignoreCase = true) ||
        it.album.contains(searchQuery, ignoreCase = true)
    }

    val current = viewModel.currentTrack
    val isPlaying = viewModel.isPlaying

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(bg),
        contentPadding = PaddingValues(bottom = 180.dp)
    ) {
        // ─── Online Header Bar ────────────────────────────────────────
        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .padding(top = 48.dp, bottom = 16.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.Top
                ) {
                    Row(modifier = Modifier.weight(1f).padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .clip(CircleShape)
                                .background(Color(0xFF00E676))
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            text = "SONARA CLOUD",
                            color = text,
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 1.sp
                        )
                    }

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        // User Auth Chip
                        Surface(
                            onClick = onOpenAuth,
                            shape = RoundedCornerShape(999.dp),
                            color = paper,
                            border = BorderStroke(1.dp, line)
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Person,
                                    contentDescription = null,
                                    tint = accent,
                                    modifier = Modifier.size(14.dp)
                                )
                                Spacer(Modifier.width(6.dp))
                                Text(
                                    text = viewModel.userEmail?.substringBefore('@') ?: "Sign In",
                                    color = text,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }

                        // Switch back to Offline Mode
                        Surface(
                            onClick = { viewModel.toggleOnlineMode(false) },
                            shape = RoundedCornerShape(999.dp),
                            color = paper,
                            border = BorderStroke(1.dp, line)
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    imageVector = Icons.Default.CloudOff,
                                    contentDescription = null,
                                    tint = muted,
                                    modifier = Modifier.size(14.dp)
                                )
                                Spacer(Modifier.width(6.dp))
                                Text(
                                    text = "OFFLINE",
                                    color = muted,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                    }
                }

                Spacer(Modifier.height(16.dp))

                // Search Bar in Online Mode
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    placeholder = { Text("Search cloud music catalog...", color = muted, fontSize = 14.sp) },
                    leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, tint = muted) },
                    trailingIcon = {
                        if (searchQuery.isNotEmpty()) {
                            IconButton(onClick = { searchQuery = "" }) {
                                Icon(Icons.Default.Close, contentDescription = null, tint = muted)
                            }
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedContainerColor = paper,
                        unfocusedContainerColor = paper,
                        focusedBorderColor = accent,
                        unfocusedBorderColor = line
                    ),
                    singleLine = true
                )
            }
        }

        // ─── Online Error State or Cloud Catalog ──────────────────────
        val onlineErr = viewModel.onlineError
        if (onlineErr != null && onlineTracks.isEmpty()) {
            item {
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 24.dp),
                    shape = RoundedCornerShape(24.dp),
                    color = paper,
                    border = BorderStroke(1.dp, Color(0xFFFF5252).copy(alpha = 0.4f))
                ) {
                    Column(
                        modifier = Modifier.padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(
                            imageVector = Icons.Default.CloudOff,
                            contentDescription = null,
                            tint = Color(0xFFFF5252),
                            modifier = Modifier.size(48.dp)
                        )
                        Spacer(Modifier.height(12.dp))
                        Text(
                            text = "Cloud Catalog Unreachable",
                            color = text,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Spacer(Modifier.height(6.dp))
                        Text(
                            text = onlineErr,
                            color = muted,
                            fontSize = 12.sp,
                            textAlign = TextAlign.Center
                        )
                        Spacer(Modifier.height(16.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Button(
                                onClick = { viewModel.loadOnlineCatalog() },
                                colors = ButtonDefaults.buttonColors(containerColor = accent),
                                shape = RoundedCornerShape(12.dp)
                            ) {
                                Text("Retry Connection", color = Color.White, fontWeight = FontWeight.Bold)
                            }
                            OutlinedButton(
                                onClick = { viewModel.toggleOnlineMode(false) },
                                shape = RoundedCornerShape(12.dp)
                            ) {
                                Text("Switch to Offline", color = text)
                            }
                        }
                    }
                }
            }
        } else {
            // ─── Cloud Soundscapes / Folders ───────────────────────────
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp)
                        .padding(bottom = 12.dp)
                ) {
                    Text(
                        text = "Cloud Playlists & Vibes",
                        color = text,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = "${onlineTracks.size} tracks available on Sonara Cloud",
                        color = muted,
                        fontSize = 12.sp
                    )
                }
            }

            item {
                LazyRow(
                    contentPadding = PaddingValues(horizontal = 20.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    items(viewModel.folders) { folder ->
                        Surface(
                            modifier = Modifier
                                .width(150.dp)
                                .height(100.dp)
                                .clickable { onFolderClick(folder) },
                            shape = RoundedCornerShape(16.dp),
                            color = paper,
                            border = BorderStroke(1.dp, line)
                        ) {
                            Column(
                                modifier = Modifier
                                    .fillMaxSize()
                                    .padding(14.dp),
                                verticalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(
                                    text = folder.name,
                                    color = text,
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.Bold,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                Text(
                                    text = "${folder.trackCount} tracks",
                                    color = muted,
                                    fontSize = 12.sp
                                )
                            }
                        }
                    }
                }
            }

            // ─── Cloud Catalog Song List ──────────────────────────────
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp)
                        .padding(top = 24.dp, bottom = 12.dp)
                ) {
                    Text(
                        text = "Cloud Catalog",
                        color = text,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }

            itemsIndexed(filteredTracks) { index, track ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 6.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .clickable {
                            viewModel.playFromList(filteredTracks, index, "Cloud Catalog")
                        }
                        .padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    CoverArt(track = track, sizeDp = 44.dp)
                    Spacer(Modifier.width(12.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = track.title,
                            color = if (current?.id == track.id) accent else text,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            text = track.artist,
                            color = muted,
                            fontSize = 12.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                    IconButton(
                        onClick = {
                            if (current?.id == track.id) {
                                viewModel.togglePlayback()
                            } else {
                                viewModel.playFromList(filteredTracks, index, "Cloud Catalog")
                            }
                        }
                    ) {
                        Icon(
                            imageVector = if (isPlaying && current?.id == track.id) Icons.Default.Pause else Icons.Default.PlayArrow,
                            contentDescription = null,
                            tint = accent,
                            modifier = Modifier.size(22.dp)
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun OfflineHomeView(
    viewModel: MainViewModel,
    themeViewModel: ThemeViewModel,
    systemDark: Boolean,
    onUpload: () -> Unit,
    onOpenAuth: () -> Unit,
    onSignOut: () -> Unit,
    onFolderClick: (Folder) -> Unit
) {
    val isDark = themeViewModel.isDark(systemDark)
    val bg = if (isDark) SonaraDesign.DarkBg else SonaraDesign.LightBg
    val paper = if (isDark) SonaraDesign.DarkPaper else SonaraDesign.LightPaper
    val line = if (isDark) SonaraDesign.DarkLine else SonaraDesign.LightLine
    val text = if (isDark) SonaraDesign.DarkText else SonaraDesign.LightText
    val muted = if (isDark) SonaraDesign.DarkMuted else SonaraDesign.LightMuted
    val accent = themeViewModel.getAccentColor(isDark)

    val calendar = Calendar.getInstance()
    val hour = calendar.get(Calendar.HOUR_OF_DAY)
    val timeGreeting = if (hour < 12) "Good morning" else if (hour < 18) "Good afternoon" else "Good evening"

    val current = viewModel.currentTrack
    val allTracks = viewModel.allTracks
    val recentTracks = viewModel.recentlyPlayedTracks
    val recentIds = remember(recentTracks) { recentTracks.map { it.id }.toSet() }
    val context = LocalContext.current
    var featuredTrack by remember { mutableStateOf<Track?>(null) }
    LaunchedEffect(allTracks) {
        if (featuredTrack == null && allTracks.isNotEmpty()) {
            val historyPrefs = context.getSharedPreferences("sonara_featured_history", android.content.Context.MODE_PRIVATE)
            val history = historyPrefs.getStringSet("ids", emptySet())?.toList() ?: emptyList()
            val next = pickFeaturedTrack(allTracks, recentIds, history)
            featuredTrack = next
            next?.remoteId?.let { id ->
                val updated = (history + id).takeLast(10).toSet()
                historyPrefs.edit().putStringSet("ids", updated).apply()
            }
        }
    }
    val dailyMix = remember(allTracks, viewModel.userEmail) {
        val dateKey = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date())
        buildDailyMixTracks(allTracks, viewModel.userEmail ?: viewModel.username ?: "guest", dateKey, 5)
    }
    val isPlaying = viewModel.isPlaying
    val spotlightTrack = if (isPlaying && current != null) current else featuredTrack
    val discoverTracks = remember(allTracks, recentIds) {
        allTracks.filterNot { it.id in recentIds }.take(5)
    }

    val soundscapes = remember(viewModel.userPlaylists, viewModel.folders) {
        val list = mutableListOf<SoundscapeItem>()
        val favs = viewModel.userPlaylists.find { it.name == "Favorites" }
        list.add(SoundscapeItem("favorites", "Favorites", "Yours", favs?.tracks ?: emptyList()))
        
        for (folder in viewModel.userPlaylists) {
            if (folder.name != "Favorites") {
                list.add(SoundscapeItem(folder.name, folder.name, "Playlist", folder.tracks))
            }
        }
        for (folder in viewModel.folders) {
            if (list.none { it.id == folder.name }) {
                list.add(SoundscapeItem(folder.name, folder.name, "Library", folder.tracks))
            }
        }
        list
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(bg),
        contentPadding = PaddingValues(bottom = 180.dp)
    ) {
        // ─── Hero Header ──────────────────────────────────────────────
        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .padding(top = 48.dp, bottom = 20.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .clip(CircleShape)
                                .background(accent)
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            text = if (viewModel.userEmail == null) timeGreeting else "$timeGreeting, ${viewModel.username ?: viewModel.userEmail?.substringBefore('@')}",
                            color = muted,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Medium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }

                    IconButton(onClick = onUpload, modifier = Modifier.size(34.dp)) {
                        Icon(Icons.Default.FileUpload, contentDescription = "Add music", tint = accent, modifier = Modifier.size(20.dp))
                    }
                    Surface(
                        onClick = if (viewModel.userEmail == null) onOpenAuth else ({}),
                        modifier = Modifier.widthIn(min = 66.dp, max = 112.dp),
                        shape = RoundedCornerShape(999.dp),
                        color = paper,
                        border = BorderStroke(1.dp, line)
                    ) {
                        Text(
                            text = viewModel.username ?: viewModel.userEmail?.substringBefore('@') ?: "Sign in",
                            color = text,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp).fillMaxWidth()
                        )
                    }
                    if (viewModel.userEmail != null) {
                        IconButton(onClick = onSignOut, modifier = Modifier.size(34.dp)) {
                            Icon(Icons.Default.Logout, contentDescription = "Sign out", tint = muted, modifier = Modifier.size(19.dp))
                        }
                    }
                }

                Spacer(Modifier.height(8.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "SONARA",
                        color = muted,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 2.sp
                    )
                    Surface(
                        onClick = { viewModel.toggleOnlineMode(!viewModel.isOnlineMode) },
                        modifier = Modifier.width(112.dp),
                        shape = RoundedCornerShape(999.dp),
                        color = if (viewModel.isOnlineMode) accent else paper,
                        border = BorderStroke(1.dp, if (viewModel.isOnlineMode) accent else line)
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp).fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center
                        ) {
                            Icon(Icons.Default.Cloud, contentDescription = null, tint = if (viewModel.isOnlineMode) Color.White else accent, modifier = Modifier.size(14.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(if (viewModel.isOnlineMode) "Online" else "Go online", color = if (viewModel.isOnlineMode) Color.White else accent, fontSize = 11.sp, fontWeight = FontWeight.Bold, maxLines = 1)
                        }
                    }
                }
            }
        }

        // ─── Feature Spotlight & Recently Played Grid ─────────────────
        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // Spotlight Feature Card
                val spotlightTone = if (spotlightTrack != null) {
                    val seed = SonaraDesign.hashString(spotlightTrack.id.toString())
                    val index = ((seed ushr 3) and 0x7FFFFFFF) % SonaraDesign.SoundscapeTones.size
                    SonaraDesign.SoundscapeTones[index]
                } else SonaraDesign.SoundscapeTones[1]

                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(24.dp),
                    color = spotlightTone.bg
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(20.dp)
                    ) {
                        SleeveStack(
                            track = spotlightTrack,
                            playing = isPlaying && current?.id == spotlightTrack?.id,
                            spin = themeViewModel.spinRecords,
                            onClick = { viewModel.showFullPlayer = true },
                            modifier = Modifier.fillMaxWidth()
                        )

                        Spacer(Modifier.height(16.dp))

                        if (spotlightTrack != null) {
                            Text(
                                text = if (isPlaying && current?.id == spotlightTrack.id) "NOW SPINNING" else "READY ON THE DECK",
                                color = spotlightTone.fg.copy(alpha = 0.75f),
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                letterSpacing = 1.5.sp
                            )
                            Text(
                                text = spotlightTrack.title,
                                color = spotlightTone.fg,
                                fontSize = 20.sp,
                                fontWeight = FontWeight.Bold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text(
                                text = spotlightTrack.artist,
                                color = spotlightTone.fg.copy(alpha = 0.8f),
                                fontSize = 14.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }

                        Spacer(Modifier.height(16.dp))

                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            IconButton(
                                onClick = {
                                    if (spotlightTrack != null) {
                                        if (current?.id == spotlightTrack.id) {
                                            viewModel.togglePlayback()
                                        } else {
                                            val targetIdx = allTracks.indexOfFirst { it.id == spotlightTrack.id }
                                            viewModel.playFromList(allTracks, if (targetIdx >= 0) targetIdx else 0, "All Music")
                                        }
                                    }
                                },
                                modifier = Modifier
                                    .size(48.dp)
                                    .background(spotlightTone.fg, CircleShape)
                            ) {
                                Icon(
                                    imageVector = if (isPlaying && current?.id == spotlightTrack?.id) Icons.Default.Pause else Icons.Default.PlayArrow,
                                    contentDescription = null,
                                    tint = spotlightTone.bg,
                                    modifier = Modifier.size(24.dp)
                                )
                            }

                            DjButton(
                                active = viewModel.isDjMode,
                                onClick = {
                                    if (viewModel.isDjMode) viewModel.changeDJVibe() else viewModel.startDJ()
                                },
                                accentColor = accent
                            )
                        }
                    }
                }

                // Recently Played Mini Card
                if (recentTracks.isNotEmpty()) {
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(24.dp),
                        color = paper,
                        border = BorderStroke(1.dp, line)
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "RECENTLY PLAYED",
                                    color = muted,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                    letterSpacing = 1.2.sp
                                )
                                Text(
                                    text = "View all",
                                    color = accent,
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Medium,
                                    modifier = Modifier.clickable { viewModel.selectedTab = 2 }
                                )
                            }

                            Spacer(Modifier.height(12.dp))

                            recentTracks.take(4).forEach { track ->
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable {
                                            val idx = allTracks.indexOfFirst { it.id == track.id }
                                            viewModel.playFromList(allTracks, if (idx >= 0) idx else 0, "Recently Played")
                                        }
                                        .padding(vertical = 6.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    CoverArt(
                                        track = track,
                                        sizeDp = 40.dp
                                    )
                                    Spacer(Modifier.width(12.dp))
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = track.title,
                                            color = text,
                                            fontSize = 14.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                        Text(
                                            text = track.artist,
                                            color = muted,
                                            fontSize = 12.sp,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }
                                    Text(
                                        text = formatTime(track.duration),
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

        // ─── Daily Mix + Discover ───────────────────────────────────────
        if (dailyMix.isNotEmpty()) {
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp)
                        .padding(top = 24.dp, bottom = 8.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Daily recommended mix",
                            color = text,
                            fontSize = 20.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = (-0.3).sp
                        )
                        Text(
                            text = "Refresh",
                            color = accent,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium,
                            modifier = Modifier.clickable { }
                        )
                    }
                    Spacer(Modifier.height(12.dp))
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        dailyMix.forEach { track ->
                            Surface(
                                modifier = Modifier
                                    .weight(1f)
                                    .clickable { val idx = allTracks.indexOfFirst { it.id == track.id }; viewModel.playFromList(dailyMix, if (idx >= 0) idx else 0, "Daily Mix") },
                                shape = RoundedCornerShape(20.dp),
                                color = paper,
                                border = BorderStroke(1.dp, line)
                            ) {
                                Column(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(12.dp),
                                    horizontalAlignment = Alignment.CenterHorizontally
                                ) {
                                    CoverArt(track = track, sizeDp = 58.dp)
                                    Spacer(Modifier.height(10.dp))
                                    Text(
                                        text = track.title,
                                        color = text,
                                        fontSize = 13.sp,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        fontWeight = FontWeight.SemiBold
                                    )
                                    Text(
                                        text = track.artist,
                                        color = muted,
                                        fontSize = 11.sp,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }

        if (discoverTracks.isNotEmpty()) {
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp)
                        .padding(top = 24.dp, bottom = 8.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Discover",
                            color = text,
                            fontSize = 20.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = (-0.3).sp
                        )
                        Text(
                            text = "Surprise me",
                            color = accent,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium,
                            modifier = Modifier.clickable { featuredTrack?.let { track -> val idx = allTracks.indexOfFirst { it.id == track.id }; viewModel.playFromList(allTracks, if (idx >= 0) idx else 0, "Discover") } }
                        )
                    }
                    Spacer(Modifier.height(12.dp))
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        discoverTracks.forEach { track ->
                            Surface(
                                modifier = Modifier
                                    .weight(1f)
                                    .clickable { val idx = allTracks.indexOfFirst { it.id == track.id }; viewModel.playFromList(allTracks, if (idx >= 0) idx else 0, "Discover") },
                                shape = RoundedCornerShape(20.dp),
                                color = paper,
                                border = BorderStroke(1.dp, line)
                            ) {
                                Column(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(12.dp),
                                    horizontalAlignment = Alignment.CenterHorizontally
                                ) {
                                    CoverArt(track = track, sizeDp = 54.dp)
                                    Spacer(Modifier.height(10.dp))
                                    Text(
                                        text = track.title,
                                        color = text,
                                        fontSize = 13.sp,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        fontWeight = FontWeight.SemiBold
                                    )
                                    Text(
                                        text = track.artist,
                                        color = muted,
                                        fontSize = 11.sp,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }

        // ─── Soundscapes Section ───────────────────────────────────────
        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 32.dp, bottom = 12.dp)
                    .padding(horizontal = 20.dp)
            ) {
                Text(
                    text = "Soundscapes",
                    color = text,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = (-0.3).sp
                )
                Text(
                    text = "Curated vibes for your mood",
                    color = muted,
                    fontSize = 13.sp
                )
            }
        }

        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                soundscapes.chunked(2).forEach { pair ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        for (idx in pair.indices) {
                            val scape = pair[idx]
                            val seed = SonaraDesign.hashString(scape.id)
                            val toneIndex = ((seed ushr 3) and 0x7FFFFFFF) % SonaraDesign.SoundscapeTones.size
                            val tone = SonaraDesign.SoundscapeTones[toneIndex]

                            Surface(
                                modifier = Modifier
                                    .weight(1f)
                                    .height(140.dp),
                                shape = RoundedCornerShape(20.dp),
                                color = tone.bg
                            ) {
                                Box(
                                    modifier = Modifier
                                        .fillMaxSize()
                                        .clickable {
                                            if (scape.id == "favorites") {
                                                viewModel.selectedTab = 1
                                            } else {
                                                val folder = viewModel.userPlaylists.find { it.name == scape.id }
                                                    ?: viewModel.folders.find { it.name == scape.id }
                                                if (folder != null) onFolderClick(folder)
                                            }
                                        }
                                        .padding(16.dp)
                                ) {
                                    Column(
                                        modifier = Modifier.fillMaxSize(),
                                        verticalArrangement = Arrangement.SpaceBetween
                                    ) {
                                        Column(modifier = Modifier.fillMaxWidth()) {
                                            Surface(
                                                shape = RoundedCornerShape(999.dp),
                                                color = tone.fg.copy(alpha = 0.15f),
                                                border = BorderStroke(1.dp, tone.fg.copy(alpha = 0.4f))
                                            ) {
                                                Text(
                                                    text = scape.kind,
                                                    color = tone.fg,
                                                    fontSize = 11.sp,
                                                    fontWeight = FontWeight.SemiBold,
                                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 2.dp)
                                                )
                                            }
                                            Spacer(Modifier.height(6.dp))
                                            Text(
                                                text = scape.name,
                                                color = tone.fg,
                                                fontSize = 18.sp,
                                                fontWeight = FontWeight.Bold,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis
                                            )
                                        }

                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                            verticalAlignment = Alignment.CenterVertically
                                        ) {
                                            Text(
                                                text = "${scape.tracks.size} tracks",
                                                color = tone.fg.copy(alpha = 0.8f),
                                                fontSize = 12.sp
                                            )

                                            IconButton(
                                                onClick = {
                                                    if (scape.tracks.isNotEmpty()) {
                                                        viewModel.startPlayback(scape.tracks, 0, scape.name)
                                                    }
                                                },
                                                modifier = Modifier
                                                    .size(40.dp)
                                                    .background(tone.fg, CircleShape)
                                            ) {
                                                Icon(
                                                    imageVector = Icons.Default.PlayArrow,
                                                    contentDescription = null,
                                                    tint = tone.bg,
                                                    modifier = Modifier.size(20.dp)
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        if (pair.size == 1) {
                            Spacer(Modifier.weight(1f))
                        }
                    }
                }
            }
        }

        // ─── Jump Back In Section ──────────────────────────────────────
        item {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 32.dp, bottom = 12.dp)
                    .padding(horizontal = 20.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        text = "Jump back in",
                        color = text,
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = (-0.3).sp
                    )
                    Text(
                        text = "Recently added to your library",
                        color = muted,
                        fontSize = 13.sp
                    )
                }
                Text(
                    text = "See everything",
                    color = accent,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.clickable { viewModel.selectedTab = 2 }
                )
            }
        }

        item {
            LazyRow(
                contentPadding = PaddingValues(horizontal = 20.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                val sortedRecent = allTracks.sortedByDescending { it.dateAdded }.take(10)
                itemsIndexed(sortedRecent) { index, track ->
                    Column(
                        modifier = Modifier
                            .width(140.dp)
                            .clickable {
                                viewModel.playFromList(sortedRecent, index, "Recently Added")
                            }
                    ) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .aspectRatio(1f)
                        ) {
                            CoverArt(
                                track = track,
                                sizeDp = 140.dp
                            )
                            IconButton(
                                onClick = { viewModel.playFromList(sortedRecent, index, "Recently Added") },
                                modifier = Modifier
                                    .align(Alignment.BottomEnd)
                                    .padding(8.dp)
                                    .size(36.dp)
                                    .background(SonaraDesign.DarkInk, CircleShape)
                            ) {
                                Icon(
                                    imageVector = if (isPlaying && current?.id == track.id) Icons.Default.Pause else Icons.Default.PlayArrow,
                                    contentDescription = null,
                                    tint = SonaraDesign.DarkOnInk,
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                        }

                        Spacer(Modifier.height(8.dp))

                        Text(
                            text = track.title,
                            color = text,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            text = track.artist,
                            color = muted,
                            fontSize = 12.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }
            }
        }
    }
}

private data class SoundscapeItem(
    val id: String,
    val name: String,
    val kind: String,
    val tracks: List<Track>
)

private fun formatTime(ms: Long): String {
    val totalSeconds = if (ms / 1000 < 0) 0 else ms / 1000
    val minutes = totalSeconds / 60
    val seconds = totalSeconds % 60
    return "$minutes:${if (seconds < 10) "0$seconds" else "$seconds"}"
}
