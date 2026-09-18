package com.sonara.app.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import coil.compose.AsyncImage
import com.sonara.app.model.Folder
import com.sonara.app.model.Track

/**
 * MainActivity - Entry point
 */
class MainActivity : ComponentActivity() {
    private val viewModel: MainViewModel by viewModels()
    private val themeViewModel: ThemeViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            LiquidTheme(themeViewModel) {
                var showSplash by remember { mutableStateOf(true) }
                
                if (showSplash) {
                    SplashView(themeViewModel) {
                        showSplash = false
                    }
                } else {
                    PermissionWrapper(viewModel, themeViewModel) {
                        Box(modifier = Modifier.fillMaxSize()) {
                            // Ambient background
                            AmbientBackground(themeViewModel)
                            
                            // Main navigation
                            MainNavigation(viewModel, themeViewModel)
                            
                            // Full player overlay
                            AnimatedVisibility(
                                visible = viewModel.showFullPlayer,
                                enter = slideInVertically(
                                    initialOffsetY = { it },
                                    animationSpec = spring(dampingRatio = 0.8f, stiffness = Spring.StiffnessLow)
                                ) + fadeIn(),
                                exit = slideOutVertically(
                                    targetOffsetY = { it },
                                    animationSpec = spring(dampingRatio = 0.8f, stiffness = Spring.StiffnessLow)
                                ) + fadeOut()
                            ) {
                                LiquidPlayer(viewModel, themeViewModel)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun PermissionWrapper(
    viewModel: MainViewModel,
    themeViewModel: ThemeViewModel,
    content: @Composable () -> Unit
) {
    var permissionStatus by remember { mutableStateOf<Boolean?>(null) }
    
    val permissions = remember {
        mutableListOf(
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                Manifest.permission.READ_MEDIA_AUDIO
            } else {
                Manifest.permission.READ_EXTERNAL_STORAGE
            },
            Manifest.permission.RECORD_AUDIO
        )
    }

    val launcher = rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        val granted = results.values.all { it }
        permissionStatus = granted
        if (granted) viewModel.loadMusic()
    }

    LaunchedEffect(Unit) {
        val allGranted = permissions.all {
            ContextCompat.checkSelfPermission(viewModel.getApplication(), it) == 
            PackageManager.PERMISSION_GRANTED
        }
        if (allGranted) {
            permissionStatus = true
            viewModel.loadMusic()
        } else {
            launcher.launch(permissions.toTypedArray())
        }
    }

    when (permissionStatus) {
        true -> content()
        false -> PermissionScreen(themeViewModel) { launcher.launch(permissions.toTypedArray()) }
        null -> Box(modifier = Modifier.fillMaxSize().background(Color.Black))
    }
}

@Composable
fun PermissionScreen(themeViewModel: ThemeViewModel, onGrant: () -> Unit) {
    Box(modifier = Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(32.dp)) {
            Box(contentAlignment = Alignment.Center) {
                Box(modifier = Modifier.size(120.dp).background(themeViewModel.primary.copy(alpha = 0.1f), CircleShape))
                Icon(Icons.Default.LockOpen, contentDescription = null, tint = themeViewModel.primary, modifier = Modifier.size(56.dp))
            }
            Spacer(Modifier.height(40.dp))
            Text("Unlock your vibe", style = MaterialTheme.typography.displaySmall, color = Color.White, fontWeight = FontWeight.Black)
            Spacer(Modifier.height(16.dp))
            Text("Sonara needs access to your local studio to begin visual rendering.", color = Color.White.copy(alpha = 0.5f), textAlign = TextAlign.Center, lineHeight = 24.sp)
            Spacer(Modifier.height(48.dp))
            Button(
                onClick = onGrant,
                modifier = Modifier.fillMaxWidth().height(64.dp),
                shape = RoundedCornerShape(24.dp),
                colors = ButtonDefaults.buttonColors(containerColor = themeViewModel.primary)
            ) {
                Text("ENTER STUDIO", fontWeight = FontWeight.Black, letterSpacing = 2.sp)
            }
        }
    }
}

@Composable
fun AmbientBackground(themeViewModel: ThemeViewModel) {
    Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(themeViewModel.primary.copy(alpha = 0.06f), Color.Transparent),
                    center = Offset(size.width * 0.7f, size.height * 0.2f),
                    radius = size.maxDimension * 0.7f
                ),
                center = Offset(size.width * 0.7f, size.height * 0.2f),
                radius = size.maxDimension * 0.7f
            )
        }
    }
}

@Composable
fun MainNavigation(viewModel: MainViewModel, themeViewModel: ThemeViewModel) {
    var showCreatePlaylistDialog by remember { mutableStateOf(false) }
    var showAddToPlaylistDialog by remember { mutableStateOf<Track?>(null) }
    var showDeleteConfirmDialog by remember { mutableStateOf<Track?>(null) }
    var previousTab by remember { mutableIntStateOf(1) }

    // Dialogs
    if (viewModel.showEqualizer) LiquidEqualizer(viewModel, themeViewModel) { viewModel.showEqualizer = false }
    if (viewModel.showSleepTimer) LiquidSleepTimer(viewModel, themeViewModel) { viewModel.showSleepTimer = false }

    // Create playlist dialog
    if (showCreatePlaylistDialog) {
        LiquidDialog(
            title = "New Collection",
            onDismiss = { showCreatePlaylistDialog = false }
        ) {
            var playlistName by remember { mutableStateOf("") }
            OutlinedTextField(
                value = playlistName,
                onValueChange = { playlistName = it },
                placeholder = { Text("Name your vibe...", color = Color.White.copy(alpha = 0.3f)) },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = themeViewModel.primary,
                    unfocusedBorderColor = Color.White.copy(alpha = 0.1f),
                    cursorColor = themeViewModel.primary
                )
            )
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = {
                    viewModel.createPlaylist(playlistName)
                    showCreatePlaylistDialog = false
                },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = themeViewModel.primary),
                shape = RoundedCornerShape(12.dp)
            ) {
                Text("Create", color = Color.White)
            }
        }
    }

    // Song Options Bottom Sheet
    if (showAddToPlaylistDialog != null) {
        val track = showAddToPlaylistDialog!!
        SongOptionsSheet(
            track = track,
            viewModel = viewModel,
            themeViewModel = themeViewModel,
            onDismiss = { showAddToPlaylistDialog = null },
            onAddToPlaylist = { playlistName ->
                viewModel.addTrackToPlaylist(track.id, playlistName)
                showAddToPlaylistDialog = null
            },
            onCreateNewPlaylist = { name ->
                viewModel.createPlaylist(name)
                viewModel.addTrackToPlaylist(track.id, name)
                showAddToPlaylistDialog = null
            },
            onDelete = {
                showDeleteConfirmDialog = track
                showAddToPlaylistDialog = null
            }
        )
    }

    // Delete confirmation dialog
    if (showDeleteConfirmDialog != null) {
        val track = showDeleteConfirmDialog!!
        AlertDialog(
            onDismissRequest = { showDeleteConfirmDialog = null },
            containerColor = Color(0xFF1A1A1E),
            title = { Text("Delete Song", color = Color.White, fontWeight = FontWeight.Bold) },
            text = { Text("Are you sure you want to delete \"${track.title}\"?", color = Color.White.copy(alpha = 0.7f)) },
            confirmButton = {
                Button(
                    onClick = {
                        viewModel.deleteTrack(track)
                        showDeleteConfirmDialog = null
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFF5252))
                ) {
                    Text("Delete")
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirmDialog = null }) {
                    Text("Cancel", color = Color.White.copy(alpha = 0.6f))
                }
            }
        )
    }

    Scaffold(
        bottomBar = {
            LiquidNavigation(viewModel, themeViewModel) {}
        },
        containerColor = Color.Transparent
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(bottom = padding.calculateBottomPadding())) {
            AnimatedContent(
                targetState = Pair(viewModel.currentFolder != null, viewModel.selectedTab),
                transitionSpec = {
                    fadeIn(animationSpec = tween(400)) togetherWith fadeOut(animationSpec = tween(400))
                },
                label = "MainFlow"
            ) { (isDetail, tab) ->
                if (isDetail) {
                    LiquidFolderDetail(
                        viewModel = viewModel,
                        themeViewModel = themeViewModel,
                        onShowOptions = { showAddToPlaylistDialog = it },
                        onBack = {
                            viewModel.currentFolder = null
                            viewModel.selectedTab = previousTab
                        }
                    )
                } else {
                    LaunchedEffect(tab) {
                        previousTab = tab
                    }
                    when (tab) {
                        0 -> LiquidHome(viewModel, themeViewModel) { viewModel.currentFolder = it }
                        1 -> LiquidLibrary(viewModel, themeViewModel, { showCreatePlaylistDialog = true }) { viewModel.currentFolder = it }
                        2 -> LiquidAllMusic(viewModel, themeViewModel, { showAddToPlaylistDialog = it }) { track, list -> viewModel.playTrack(track, list) }
                        3 -> LiquidLab(themeViewModel) {}
                    }
                }
            }

            if (viewModel.currentFolder != null && !viewModel.showFullPlayer) {
                androidx.activity.compose.BackHandler {
                    viewModel.currentFolder = null
                    viewModel.selectedTab = previousTab
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SongOptionsSheet(
    track: Track,
    viewModel: MainViewModel,
    themeViewModel: ThemeViewModel,
    onDismiss: () -> Unit,
    onAddToPlaylist: (String) -> Unit,
    onCreateNewPlaylist: (String) -> Unit,
    onDelete: () -> Unit
) {
    val sheetState = rememberModalBottomSheetState()
    var showCreateNew by remember { mutableStateOf(false) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = Color(0xFF1A1A1E)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 32.dp)
        ) {
            // Track info header
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                AsyncImage(
                    model = track.albumArtUri,
                    contentDescription = null,
                    modifier = Modifier
                        .size(48.dp)
                        .clip(RoundedCornerShape(10.dp)),
                    contentScale = androidx.compose.ui.layout.ContentScale.Crop
                )
                Spacer(Modifier.width(12.dp))
                Column {
                    Text(
                        track.title,
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp,
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
            }

            Divider(
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
                color = Color.White.copy(alpha = 0.06f)
            )

            // Add to Playlist section
            Text(
                "Add to Playlist",
                color = Color.White.copy(alpha = 0.4f),
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 4.dp)
            )

            // Create new playlist option
            Surface(
                onClick = { showCreateNew = true },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 2.dp),
                shape = RoundedCornerShape(12.dp)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(
                        modifier = Modifier
                            .size(40.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(themeViewModel.primary.copy(alpha = 0.15f)),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(Icons.Default.Add, contentDescription = null, tint = themeViewModel.primary, modifier = Modifier.size(22.dp))
                    }
                    Spacer(Modifier.width(12.dp))
                    Text("Create New Playlist", color = Color.White, fontWeight = FontWeight.Medium, fontSize = 14.sp)
                }
            }

            // Existing playlists
            viewModel.userPlaylists.filter { it.name != "Favorites" }.take(5).forEach { playlist ->
                Surface(
                    onClick = { onAddToPlaylist(playlist.name) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 2.dp),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier
                                .size(40.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(Color.White.copy(alpha = 0.06f)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(Icons.Default.QueueMusic, contentDescription = null, tint = Color.White.copy(alpha = 0.5f), modifier = Modifier.size(20.dp))
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(playlist.name, color = Color.White, fontWeight = FontWeight.Medium, fontSize = 14.sp)
                            Text("${playlist.trackCount} tracks", color = Color.White.copy(alpha = 0.4f), fontSize = 12.sp)
                        }
                    }
                }
            }

            Divider(
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
                color = Color.White.copy(alpha = 0.06f)
            )

            // Delete option
            Surface(
                onClick = onDelete,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 2.dp),
                shape = RoundedCornerShape(12.dp)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(
                        modifier = Modifier
                            .size(40.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(Color(0xFFFF5252).copy(alpha = 0.15f)),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(Icons.Default.Delete, contentDescription = null, tint = Color(0xFFFF5252), modifier = Modifier.size(20.dp))
                    }
                    Spacer(Modifier.width(12.dp))
                    Text("Delete Song", color = Color(0xFFFF5252), fontWeight = FontWeight.Medium, fontSize = 14.sp)
                }
            }
        }
    }

    // Create new playlist dialog
    if (showCreateNew) {
        AlertDialog(
            onDismissRequest = { showCreateNew = false },
            containerColor = Color(0xFF1A1A1E),
            title = { Text("New Playlist", color = Color.White, fontWeight = FontWeight.Bold) },
            text = {
                var newName by remember { mutableStateOf("") }
                OutlinedTextField(
                    value = newName,
                    onValueChange = { newName = it },
                    placeholder = { Text("Playlist name", color = Color.White.copy(alpha = 0.3f)) },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = themeViewModel.primary,
                        unfocusedBorderColor = Color.White.copy(alpha = 0.1f),
                        cursorColor = themeViewModel.primary,
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White
                    ),
                    singleLine = true
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        // Get name from text field - need to restructure
                        // For now, just dismiss
                        showCreateNew = false
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = themeViewModel.primary)
                ) {
                    Text("Create")
                }
            },
            dismissButton = {
                TextButton(onClick = { showCreateNew = false }) {
                    Text("Cancel", color = Color.White.copy(alpha = 0.6f))
                }
            }
        )
    }
}
