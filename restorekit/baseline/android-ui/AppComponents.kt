package com.sonara.app.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException
import com.sonara.app.model.Track
import kotlin.math.abs

/* -------------------------------------------------------------------------- */
/*  Cover Art & Sleeve Shapes                                                 */
/* -------------------------------------------------------------------------- */

@Composable
fun SleeveShapes(pattern: Int, colors: List<Color>, modifier: Modifier = Modifier) {
    val base = if (colors.size > 0) colors[0] else Color(0xFF2F4B6E)
    val a = if (colors.size > 1) colors[1] else Color(0xFFEADBB8)
    val b = if (colors.size > 2) colors[2] else Color(0xFFD9A441)

    Canvas(modifier = modifier.fillMaxSize()) {
        val w = size.width
        val h = size.height
        drawRect(color = base)

        when (pattern % 6) {
            0 -> {
                drawCircle(color = a, radius = w * 0.24f, center = Offset(w * 0.5f, h * 0.56f))
                drawRect(color = b, topLeft = Offset(0f, h * 0.66f), size = Size(w, h * 0.34f))
            }
            1 -> {
                drawCircle(color = a, radius = w * 0.36f, center = Offset(w * 0.5f, h))
                drawCircle(color = b, radius = w * 0.22f, center = Offset(w * 0.5f, h))
                drawCircle(color = base, radius = w * 0.10f, center = Offset(w * 0.5f, h))
            }
            2 -> {
                for (i in 0..4) {
                    drawRect(color = a, topLeft = Offset(w * (0.10f + i * 0.18f), 0f), size = Size(w * 0.09f, h))
                }
                drawCircle(color = b, radius = w * 0.20f, center = Offset(w * 0.5f, h * 0.5f))
            }
            3 -> {
                drawArc(
                    color = a,
                    startAngle = 0f,
                    sweepAngle = 90f,
                    useCenter = true,
                    topLeft = Offset(-w * 0.72f, -h * 0.72f),
                    size = Size(w * 1.44f, h * 1.44f)
                )
                drawCircle(color = b, radius = w * 0.14f, center = Offset(w * 0.74f, h * 0.74f))
            }
            4 -> {
                drawRect(color = a, topLeft = Offset(0f, 0f), size = Size(w * 0.5f, h))
                drawCircle(color = b, radius = w * 0.24f, center = Offset(w * 0.5f, h * 0.5f))
            }
            else -> {
                for (row in 0..2) {
                    for (col in 0..2) {
                        val isEven = (row + col) % 2 == 0
                        drawCircle(
                            color = if (isEven) b else a,
                            radius = w * (if (isEven) 0.11f else 0.07f),
                            center = Offset(w * (0.22f + col * 0.28f), h * (0.22f + row * 0.28f))
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun CoverArt(
    track: Track?,
    modifier: Modifier = Modifier,
    sizeDp: Dp = 48.dp,
    round: Boolean = false,
    contentScale: ContentScale = ContentScale.Crop
) {
    var loadFailed by remember(track?.albumArtUri) { mutableStateOf(false) }
    val shape = if (round) CircleShape else RoundedCornerShape(8.dp)

    val imageModel = track?.albumArtUri
    if (imageModel != null && !loadFailed) {
        AsyncImage(
            model = imageModel,
            contentDescription = null,
            modifier = modifier
                .size(sizeDp)
                .clip(shape)
                .background(SonaraDesign.DarkRaised),
            contentScale = contentScale,
            onError = { loadFailed = true }
        )
    } else {
        val seed = SonaraDesign.hashString(track?.id?.toString() ?: track?.title ?: "sonara")
        val paletteIndex = abs(seed shr 3) % SonaraDesign.SleevePalettes.size
        val palette = SonaraDesign.SleevePalettes[paletteIndex]

        Box(
            modifier = modifier
                .size(sizeDp)
                .clip(shape)
                .background(palette[0])
        ) {
            SleeveShapes(pattern = seed % 6, colors = palette)
        }
    }
}

/* -------------------------------------------------------------------------- */
/*  Vinyl Record & Sleeve Stack                                               */
/* -------------------------------------------------------------------------- */

@Composable
fun RecordDisc(
    track: Track?,
    playing: Boolean,
    spin: Boolean = true,
    modifier: Modifier = Modifier,
    sizeDp: Dp = 100.dp
) {
    val infiniteTransition = rememberInfiniteTransition(label = "record_spin")
    val angle by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(8000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "angle"
    )

    val rotation = if (playing && spin) angle else 0f

    Box(
        modifier = modifier
            .size(sizeDp)
            .rotate(rotation)
            .clip(CircleShape)
            .background(Color(0xFF12110D)),
        contentAlignment = Alignment.Center
    ) {
        // Vinyl Grooves Texture Canvas
        Canvas(modifier = Modifier.fillMaxSize()) {
            val maxR = size.width / 2f

            // Concentric groove lines
            var r = maxR * 0.95f
            while (r > maxR * 0.35f) {
                drawCircle(
                    color = Color.White.copy(alpha = 0.07f),
                    radius = r,
                    style = Stroke(width = 1f)
                )
                r -= maxR * 0.04f
            }

            // Shine reflections
            drawArc(
                brush = Brush.sweepGradient(
                    listOf(
                        Color.Transparent,
                        Color.White.copy(alpha = 0.12f),
                        Color.Transparent,
                        Color.Transparent,
                        Color.White.copy(alpha = 0.08f),
                        Color.Transparent
                    )
                ),
                startAngle = 20f,
                sweepAngle = 360f,
                useCenter = true
            )
        }

        // Center Label
        Box(
            modifier = Modifier
                .fillMaxSize(0.38f)
                .clip(CircleShape)
                .border(1.dp, Color.Black.copy(alpha = 0.35f), CircleShape)
        ) {
            CoverArt(
                track = track,
                sizeDp = sizeDp * 0.38f,
                round = true
            )
        }

        // Center Hole
        Box(
            modifier = Modifier
                .fillMaxSize(0.06f)
                .clip(CircleShape)
                .background(SonaraDesign.RecordHole)
        )
    }
}

@Composable
fun SleeveStack(
    track: Track?,
    playing: Boolean,
    spin: Boolean = true,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null
) {
    BoxWithConstraints(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(1.25f)
            .then(if (onClick != null) Modifier.clickable { onClick() } else Modifier),
        contentAlignment = Alignment.CenterStart
    ) {
        val totalWidth = maxWidth
        val sleeveSize = totalWidth * 0.64f
        val recordSize = totalWidth * 0.60f

        // Record sliding out behind
        Box(
            modifier = Modifier
                .offset(x = totalWidth * 0.34f)
                .align(Alignment.CenterStart)
        ) {
            RecordDisc(
                track = track,
                playing = playing,
                spin = spin,
                sizeDp = recordSize
            )
        }

        // Sleeve in front
        Box(
            modifier = Modifier
                .size(sleeveSize)
                .clip(RoundedCornerShape(8.dp))
                .border(1.dp, Color.White.copy(alpha = 0.1f), RoundedCornerShape(8.dp))
                .align(Alignment.CenterStart)
        ) {
            CoverArt(
                track = track,
                sizeDp = sleeveSize
            )
        }
    }
}

/* -------------------------------------------------------------------------- */
/*  Page Banner                                                               */
/* -------------------------------------------------------------------------- */

@Composable
fun PageBanner(
    title: String,
    subtitle: String,
    tone: SonaraDesign.Tone,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(120.dp)
            .clip(RoundedCornerShape(24.dp))
            .background(tone.bg)
            .padding(24.dp),
        contentAlignment = Alignment.CenterStart
    ) {
        // Decorative background shapes
        SleeveShapes(
            pattern = 3,
            colors = listOf(tone.bg, tone.fg.copy(alpha = 0.25f), tone.fg.copy(alpha = 0.15f)),
            modifier = Modifier.align(Alignment.CenterEnd)
        )

        Column(modifier = Modifier.fillMaxWidth(0.7f)) {
            Text(
                text = title,
                color = tone.fg,
                fontSize = 26.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = (-0.5).sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            if (subtitle.length > 0) {
                Spacer(Modifier.height(4.dp))
                Text(
                    text = subtitle,
                    color = tone.fg.copy(alpha = 0.82f),
                    fontSize = 14.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

/* -------------------------------------------------------------------------- */
/*  DJ Button & Waveform                                                      */
/* -------------------------------------------------------------------------- */

@Composable
fun DjButton(
    active: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    idleLabel: String = "Start DJ",
    accentColor: Color = Color(0xFFD83A22)
) {
    Surface(
        onClick = onClick,
        modifier = modifier.height(38.dp),
        shape = RoundedCornerShape(999.dp),
        color = if (active) accentColor else Color.Transparent,
        border = BorderStroke(1.5.dp, if (active) accentColor else Color.White.copy(alpha = 0.8f))
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = if (active) Icons.Default.GraphicEq else Icons.Default.AutoAwesome,
                contentDescription = null,
                tint = if (active) Color.White else Color.White.copy(alpha = 0.8f),
                modifier = Modifier.size(16.dp)
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = if (active) "Stop DJ" else idleLabel,
                color = if (active) Color.White else Color.White.copy(alpha = 0.8f),
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold
            )
        }
    }
}

@Composable
fun WaveformView(
    seed: Int,
    active: Boolean,
    accentColor: Color,
    modifier: Modifier = Modifier
) {
    Canvas(modifier = modifier.size(width = 80.dp, height = 20.dp)) {
        val barCount = 24
        val barWidth = 2.dp.toPx()
        val gap = (size.width - barCount * barWidth) / (barCount - 1)
        val color = if (active) accentColor else Color.Gray.copy(alpha = 0.4f)

        var state = seed
        for (i in 0 until barCount) {
            state = (state * 1664525 + 1013904223) and 0x7FFFFFFF
            val rawH = 4.dp.toPx() + ((state ushr 24) % 15) * 1f
            val h = if (rawH > size.height) size.height else if (rawH < 2.dp.toPx()) 2.dp.toPx() else rawH

            drawRoundRect(
                color = color,
                topLeft = Offset(i * (barWidth + gap), (size.height - h) / 2f),
                size = Size(barWidth, h),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(1.dp.toPx())
            )
        }
    }
}

/* -------------------------------------------------------------------------- */
/*  Mini Player Deck & Navigation Dock                                        */
/* -------------------------------------------------------------------------- */

@Composable
fun LiquidNavigation(
    viewModel: MainViewModel,
    themeViewModel: ThemeViewModel,
    systemDark: Boolean,
    onAddTrack: (Track) -> Unit
) {
    val current = viewModel.currentTrack
    val isDark = themeViewModel.isDark(systemDark)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .navigationBarsPadding()
    ) {
        // Sticky Mini Player Deck when music is playing and full player isn't open
        if (current != null && !viewModel.showFullPlayer) {
            DeckPlayer(
                track = current,
                isPlaying = viewModel.isPlaying,
                viewModel = viewModel,
                themeViewModel = themeViewModel,
                isDark = isDark,
                onClick = { viewModel.showFullPlayer = true },
                onAddTrack = onAddTrack
            )
        }

        // Bottom Nav Dock
        NavDock(
            selectedTab = viewModel.selectedTab,
            themeViewModel = themeViewModel,
            isDark = isDark,
            onTabSelected = { index ->
                viewModel.selectedTab = index
                viewModel.currentFolder = null
            }
        )
    }
}

@Composable
fun DeckPlayer(
    track: Track,
    isPlaying: Boolean,
    viewModel: MainViewModel,
    themeViewModel: ThemeViewModel,
    isDark: Boolean,
    onClick: () -> Unit,
    onAddTrack: (Track) -> Unit
) {
    val accent = themeViewModel.getAccentColor(isDark)
    val rawProgress = if (viewModel.duration > 0) viewModel.currentPosition.toFloat() / viewModel.duration else 0f
    val progress = if (rawProgress < 0f) 0f else if (rawProgress > 1f) 1f else rawProgress

    Surface(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 6.dp)
            .height(68.dp),
        shape = RoundedCornerShape(24.dp),
        color = SonaraDesign.DeckBg,
        shadowElevation = 8.dp
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            Row(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Record Disc artwork
                RecordDisc(
                    track = track,
                    playing = isPlaying,
                    spin = themeViewModel.spinRecords,
                    sizeDp = 48.dp
                )

                Spacer(Modifier.width(12.dp))

                // Title & Artist
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = track.title,
                        color = SonaraDesign.DeckFg,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = track.artist,
                        color = SonaraDesign.DeckMuted,
                        fontSize = 12.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                // Play / Pause Button
                IconButton(
                    onClick = { viewModel.togglePlayback() },
                    modifier = Modifier
                        .size(42.dp)
                        .background(SonaraDesign.DeckFg, CircleShape)
                ) {
                    Icon(
                        imageVector = if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                        contentDescription = null,
                        tint = SonaraDesign.DeckBg,
                        modifier = Modifier.size(24.dp)
                    )
                }

                Spacer(Modifier.width(4.dp))

                // Next Track Button
                IconButton(
                    onClick = { viewModel.playNext() },
                    modifier = Modifier.size(36.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.SkipNext,
                        contentDescription = null,
                        tint = SonaraDesign.DeckFg,
                        modifier = Modifier.size(22.dp)
                    )
                }

                IconButton(onClick = { onAddTrack(track) }, modifier = Modifier.size(36.dp)) {
                    Icon(Icons.Default.Add, contentDescription = "Add to playlist", tint = SonaraDesign.DeckFg, modifier = Modifier.size(20.dp))
                }
            }

            // Progress line along bottom
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(3.dp)
                    .align(Alignment.BottomStart)
                    .background(SonaraDesign.DeckTrack)
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth(progress)
                        .fillMaxHeight()
                        .background(accent)
                )
            }
        }
    }
}

/* -------------------------------------------------------------------------- */
/*  Online / Offline Mode Bar & Auth Dialog                                   */
/* -------------------------------------------------------------------------- */

@Composable
fun OnlineOfflineBar(
    viewModel: MainViewModel,
    themeViewModel: ThemeViewModel,
    systemDark: Boolean,
    modifier: Modifier = Modifier,
    onOpenAuth: () -> Unit = {}
) {
    val isDark = themeViewModel.isDark(systemDark)
    val paper = if (isDark) SonaraDesign.DarkPaper else SonaraDesign.LightPaper
    val line = if (isDark) SonaraDesign.DarkLine else SonaraDesign.LightLine
    val text = if (isDark) SonaraDesign.DarkText else SonaraDesign.LightText
    val muted = if (isDark) SonaraDesign.DarkMuted else SonaraDesign.LightMuted
    val accent = themeViewModel.getAccentColor(isDark)

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 6.dp),
        shape = RoundedCornerShape(999.dp),
        color = paper,
        border = BorderStroke(1.dp, line)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            // Status Info
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.clickable { viewModel.toggleOnlineMode(!viewModel.isOnlineMode) }
            ) {
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(if (viewModel.isOnlineMode) Color(0xFF00E676) else accent)
                )
                Spacer(Modifier.width(8.dp))
                Column {
                    Text(
                        text = if (viewModel.isOnlineMode) "Sonara Cloud" else "Local Studio",
                        color = text,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = if (viewModel.isOnlineMode) "Connected to live server" else "Offline mode (Local storage)",
                        color = muted,
                        fontSize = 10.sp
                    )
                }
            }

            // Mode Switch Button & Auth Chip
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                if (viewModel.isOnlineLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp,
                        color = accent
                    )
                }

                if (viewModel.isOnlineMode && viewModel.userEmail != null) {
                    Surface(
                        onClick = onOpenAuth,
                        shape = RoundedCornerShape(999.dp),
                        color = paper,
                        border = BorderStroke(1.dp, line)
                    ) {
                        Text(
                            text = viewModel.userEmail?.substringBefore('@') ?: "User",
                            color = text,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
                        )
                    }
                }

                Surface(
                    onClick = { viewModel.toggleOnlineMode(!viewModel.isOnlineMode) },
                    shape = RoundedCornerShape(999.dp),
                    color = if (viewModel.isOnlineMode) accent else Color.Transparent,
                    border = BorderStroke(1.dp, if (viewModel.isOnlineMode) accent else line)
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = if (viewModel.isOnlineMode) Icons.Default.Cloud else Icons.Default.CloudOff,
                            contentDescription = null,
                            tint = if (viewModel.isOnlineMode) Color.White else muted,
                            modifier = Modifier.size(14.dp)
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            text = if (viewModel.isOnlineMode) "ONLINE" else "OFFLINE",
                            color = if (viewModel.isOnlineMode) Color.White else muted,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun SonaraAuthDialog(
    viewModel: MainViewModel,
    themeViewModel: ThemeViewModel,
    systemDark: Boolean,
    onDismiss: () -> Unit
) {
    var emailInput by remember { mutableStateOf(viewModel.userEmail ?: "") }
    var passwordInput by remember { mutableStateOf("") }
    var usernameInput by remember { mutableStateOf("") }
    var isRegisterMode by remember { mutableStateOf(false) }
    var isAuthLoading by remember { mutableStateOf(false) }
    var statusMessage by remember { mutableStateOf("") }

    val isDark = themeViewModel.isDark(systemDark)
    val paper = if (isDark) SonaraDesign.DarkPaper else SonaraDesign.LightPaper
    val text = if (isDark) SonaraDesign.DarkText else SonaraDesign.LightText
    val muted = if (isDark) SonaraDesign.DarkMuted else SonaraDesign.LightMuted
    val line = if (isDark) SonaraDesign.DarkLine else SonaraDesign.LightLine
    val accent = themeViewModel.getAccentColor(isDark)

    val context = LocalContext.current

    val googleSignInLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val task = GoogleSignIn.getSignedInAccountFromIntent(result.data)
        try {
            val account = task.getResult(ApiException::class.java)
            val email = account?.email
            val idToken = account?.idToken
            if (!email.isNullOrBlank()) {
                viewModel.firebaseGoogleSignIn(email, idToken) { success, msg ->
                    isAuthLoading = false
                    statusMessage = msg
                    if (success) onDismiss()
                }
            } else {
                isAuthLoading = false
                statusMessage = "Google Sign-In failed: Email not retrieved"
            }
        } catch (e: ApiException) {
            isAuthLoading = false
            if (e.statusCode == 12501) {
                statusMessage = "Google Sign-In canceled"
            } else if (e.statusCode == 10) {
                val account = GoogleSignIn.getLastSignedInAccount(context)
                if (account?.email != null) {
                    viewModel.firebaseGoogleSignIn(account.email!!, account.idToken) { success, msg ->
                        statusMessage = msg
                        if (success) onDismiss()
                    }
                } else {
                    statusMessage = "Google Sign-In Error Code 10 (DEVELOPER_ERROR): SHA-1 key fingerprint or Web Client ID missing in Google/Firebase Console for ${context.packageName}."
                }
            } else {
                val account = GoogleSignIn.getLastSignedInAccount(context)
                if (account?.email != null) {
                    viewModel.firebaseGoogleSignIn(account.email!!, account.idToken) { success, msg ->
                        statusMessage = msg
                        if (success) onDismiss()
                    }
                } else {
                    statusMessage = "Google Sign-In error (code ${e.statusCode})"
                }
            }
        } catch (e: Exception) {
            isAuthLoading = false
            statusMessage = "Google Sign-In error: ${e.localizedMessage ?: "Unknown error"}"
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = paper,
        title = {
            Text(
                text = if (viewModel.userEmail != null) "Sonara Account" else if (isRegisterMode) "Create Account" else "Welcome Back",
                color = text,
                fontWeight = FontWeight.Bold
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                if (viewModel.userEmail != null) {
                    Text(
                        text = "Signed in as ${viewModel.username ?: viewModel.userEmail}",
                        color = text,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = "Your library, playlists, and favorites are synced live with Sonara Cloud.",
                        color = muted,
                        fontSize = 13.sp
                    )
                    Spacer(Modifier.height(8.dp))
                    Button(
                        onClick = {
                            viewModel.setUserAuth(null, null)
                            statusMessage = "Signed out"
                            onDismiss()
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFF5252)),
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text("Sign Out", color = Color.White, fontWeight = FontWeight.Bold)
                    }
                } else {
                    if (!viewModel.hasAdmin) {
                        Button(
                            onClick = {
                                val emailToClaim = if (emailInput.isNotBlank()) emailInput.trim() else "admin@sonara.app"
                                viewModel.claimAdminAccount(emailToClaim) { _, msg ->
                                    statusMessage = msg
                                }
                            },
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFFB300)),
                            shape = RoundedCornerShape(12.dp)
                        ) {
                            Text("👑 Claim Admin Account (One-Time Setup)", color = Color.Black, fontWeight = FontWeight.Bold)
                        }
                    }

                    // Google Sign-In Button
                    Surface(
                        onClick = {
                            isAuthLoading = true
                            statusMessage = "Opening Google Sign-In..."
                            try {
                                val gsoBuilder = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                                    .requestEmail()

                                val webClientIdResId = context.resources.getIdentifier("default_web_client_id", "string", context.packageName)
                                if (webClientIdResId != 0) {
                                    val webClientId = context.getString(webClientIdResId)
                                    if (webClientId.isNotBlank() && webClientId != "YOUR_WEB_CLIENT_ID_HERE") {
                                        gsoBuilder.requestIdToken(webClientId)
                                    }
                                }

                                val gso = gsoBuilder.build()
                                val googleSignInClient = GoogleSignIn.getClient(context, gso)
                                googleSignInClient.signOut().addOnCompleteListener {
                                    val signInIntent = googleSignInClient.signInIntent
                                    googleSignInLauncher.launch(signInIntent)
                                }
                            } catch (e: Exception) {
                                isAuthLoading = false
                                statusMessage = "Could not launch Google Sign-In: ${e.localizedMessage}"
                            }
                        },
                        enabled = !isAuthLoading,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        color = if (isDark) Color(0xFF2A2A30) else Color(0xFFF0F0F5),
                        border = BorderStroke(1.dp, line)
                    ) {
                        Row(
                            modifier = Modifier.padding(vertical = 12.dp, horizontal = 16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(22.dp)
                                    .clip(CircleShape)
                                    .background(Color.White),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = "G",
                                    color = Color(0xFF4285F4),
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Black
                                )
                            }
                            Spacer(Modifier.width(12.dp))
                            Text(
                                text = if (isAuthLoading) "Connecting to Google..." else "Continue with Google",
                                color = text,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }

                    // Divider
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(modifier = Modifier.weight(1f).height(1.dp).background(line))
                        Text(
                            text = "  or use email  ",
                            color = muted,
                            fontSize = 12.sp
                        )
                        Box(modifier = Modifier.weight(1f).height(1.dp).background(line))
                    }

                    OutlinedTextField(
                        value = emailInput,
                        onValueChange = { emailInput = it },
                        label = { Text("Email", color = muted) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp)
                    )

                    OutlinedTextField(
                        value = passwordInput,
                        onValueChange = { passwordInput = it },
                        label = { Text("Password", color = muted) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp)
                    )

                    if (isRegisterMode) {
                        OutlinedTextField(
                            value = usernameInput,
                            onValueChange = { usernameInput = it },
                            label = { Text("Username", color = muted) },
                            supportingText = { Text("2-30 letters, numbers, dots, dashes, or underscores", color = muted, fontSize = 11.sp) },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp)
                        )
                    }

                    if (statusMessage.isNotBlank()) {
                        Text(statusMessage, color = accent, fontSize = 12.sp)
                    }

                    Button(
                        onClick = {
                            if (emailInput.isNotBlank() && passwordInput.length >= 6 && (!isRegisterMode || usernameInput.trim().length >= 2)) {
                                isAuthLoading = true
                                viewModel.firebaseSignIn(emailInput.trim(), passwordInput, isRegisterMode, usernameInput.trim()) { success, msg ->
                                    isAuthLoading = false
                                    statusMessage = msg
                                    if (success) onDismiss()
                                }
                            } else {
                                statusMessage = if (isRegisterMode) "Enter an email, a 6+ character password, and a username." else "Please enter valid email & password (6+ chars)"
                            }
                        },
                        enabled = !isAuthLoading,
                        colors = ButtonDefaults.buttonColors(containerColor = accent),
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        if (isAuthLoading) {
                            CircularProgressIndicator(modifier = Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp)
                        } else {
                            Text(if (isRegisterMode) "Create Account" else "Sign In", color = Color.White, fontWeight = FontWeight.Bold)
                        }
                    }

                    TextButton(
                        onClick = { isRegisterMode = !isRegisterMode },
                        modifier = Modifier.align(Alignment.CenterHorizontally)
                    ) {
                        Text(
                            text = if (isRegisterMode) "Already have an account? Sign in" else "New to Sonara? Create account",
                            color = muted,
                            fontSize = 12.sp
                        )
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Close", color = muted)
            }
        }
    )
}

@Composable
fun UsernamePrompt(
    viewModel: MainViewModel,
    themeViewModel: ThemeViewModel,
    systemDark: Boolean
) {
    val isDark = themeViewModel.isDark(systemDark)
    val paper = if (isDark) SonaraDesign.DarkPaper else SonaraDesign.LightPaper
    val text = if (isDark) SonaraDesign.DarkText else SonaraDesign.LightText
    val muted = if (isDark) SonaraDesign.DarkMuted else SonaraDesign.LightMuted
    val accent = themeViewModel.getAccentColor(isDark)
    var input by remember { mutableStateOf(viewModel.username ?: "") }

    AlertDialog(
        onDismissRequest = {},
        containerColor = paper,
        title = { Text("Choose your username", color = text, fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("This name is tied to your account and shared across Sonara web and Android.", color = muted, fontSize = 13.sp)
                OutlinedTextField(
                    value = input,
                    onValueChange = { input = it; viewModel.usernameError = null },
                    label = { Text("Username") },
                    singleLine = true,
                    isError = viewModel.usernameError != null,
                    supportingText = { Text(viewModel.usernameError ?: "2-30 characters; letters, numbers, dots, dashes, or underscores", color = muted, fontSize = 11.sp) },
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { viewModel.saveUsername(input) },
                enabled = input.trim().length >= 2,
                colors = ButtonDefaults.buttonColors(containerColor = accent)
            ) { Text("Continue", color = Color.White) }
        }
    )
}

@Composable
fun NavDock(
    selectedTab: Int,
    themeViewModel: ThemeViewModel,
    isDark: Boolean,
    onTabSelected: (Int) -> Unit
) {
    val bg = if (isDark) SonaraDesign.DarkBg else SonaraDesign.LightBg
    val line = if (isDark) SonaraDesign.DarkLine else SonaraDesign.LightLine
    val text = if (isDark) SonaraDesign.DarkText else SonaraDesign.LightText
    val muted = if (isDark) SonaraDesign.DarkMuted else SonaraDesign.LightMuted
    val accent = themeViewModel.getAccentColor(isDark)

    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = bg,
        border = BorderStroke(0.5.dp, line)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(58.dp)
                .padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically
        ) {
            val tabs = listOf(
                DockTab(0, Icons.Outlined.Home, Icons.Filled.Home, "Home"),
                DockTab(1, Icons.Outlined.LibraryMusic, Icons.Filled.LibraryMusic, "Library"),
                DockTab(2, Icons.Outlined.MusicNote, Icons.Filled.MusicNote, "All Music"),
                DockTab(3, Icons.Outlined.Palette, Icons.Filled.Palette, "Lab")
            )

            for (tab in tabs) {
                val isSelected = selectedTab == tab.index
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier
                        .clickable { onTabSelected(tab.index) }
                        .padding(horizontal = 12.dp, vertical = 6.dp)
                ) {
                    Icon(
                        imageVector = if (isSelected) tab.filledIcon else tab.outlinedIcon,
                        contentDescription = tab.label,
                        tint = if (isSelected) text else muted,
                        modifier = Modifier.size(22.dp)
                    )
                    Spacer(Modifier.height(3.dp))
                    if (isSelected) {
                        Box(
                            modifier = Modifier
                                .size(4.dp)
                                .clip(CircleShape)
                                .background(accent)
                        )
                    } else {
                        Text(
                            text = tab.label,
                            color = muted,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }
            }
        }
    }
}

private data class DockTab(
    val index: Int,
    val outlinedIcon: ImageVector,
    val filledIcon: ImageVector,
    val label: String
)
