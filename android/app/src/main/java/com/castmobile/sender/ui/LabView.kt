package com.sonara.app.ui

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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

private data class ThemeOption(val mode: String, val label: String, val desc: String)

@Composable
fun LiquidLab(
    viewModel: MainViewModel,
    themeViewModel: ThemeViewModel,
    systemDark: Boolean
) {
    val isDark = themeViewModel.isDark(systemDark)
    val bg = if (isDark) SonaraDesign.DarkBg else SonaraDesign.LightBg
    val paper = if (isDark) SonaraDesign.DarkPaper else SonaraDesign.LightPaper
    val line = if (isDark) SonaraDesign.DarkLine else SonaraDesign.LightLine
    val text = if (isDark) SonaraDesign.DarkText else SonaraDesign.LightText
    val muted = if (isDark) SonaraDesign.DarkMuted else SonaraDesign.LightMuted
    val accent = themeViewModel.getAccentColor(isDark)

    var selectedTab by remember { mutableIntStateOf(0) }
    var userNameInput by remember { mutableStateOf(themeViewModel.userName) }
    var apiUrlInput by remember { mutableStateOf(viewModel.apiBaseUrl) }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(bg),
        contentPadding = PaddingValues(bottom = 180.dp)
    ) {
        item {
            Box(modifier = Modifier.padding(horizontal = 20.dp, vertical = 20.dp)) {
                PageBanner(
                    title = "Appearance Lab",
                    subtitle = "Make Sonara look and feel the way you like.",
                    tone = SonaraDesign.SoundscapeTones[4]
                )
            }
        }

        // ─── Tabs ──────────────────────────────────────────────────────
        val labTabs = if (viewModel.isAdmin) listOf("Themes", "Colors", "Settings", "👑 Billing") else listOf("Themes", "Colors", "Settings")
        item {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .padding(bottom = 20.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                labTabs.forEachIndexed { index, label ->
                    val selected = selectedTab == index
                    Column(
                        modifier = Modifier
                            .clickable { selectedTab = index }
                            .padding(bottom = 8.dp)
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
                                    .width(32.dp)
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
                // ─── Themes Tab ───────────────────────────────────────
                item {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 20.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        val themes = listOf(
                            ThemeOption("light", "Paper", "Warm daylight, ink black type"),
                            ThemeOption("dark", "Night", "A dim listening room"),
                            ThemeOption("system", "System", "Follows your device setting")
                        )

                        for (idx in 0..themes.size - 1) {
                            val themeItem = themes[idx]
                            val mode = themeItem.mode
                            val label = themeItem.label
                            val desc = themeItem.desc
                            val isSelected = themeViewModel.themeMode == mode

                            Surface(
                                onClick = { themeViewModel.updateThemeMode(mode) },
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(20.dp),
                                color = paper,
                                border = BorderStroke(if (isSelected) 2.dp else 1.dp, if (isSelected) accent else line)
                            ) {
                                Row(
                                    modifier = Modifier.padding(16.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .size(54.dp)
                                            .clip(RoundedCornerShape(12.dp))
                                            .background(
                                                when (mode) {
                                                    "light" -> SonaraDesign.LightBg
                                                    "dark" -> SonaraDesign.DarkBg
                                                    else -> Color(0xFF2A2720)
                                                }
                                            ),
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Icon(
                                            imageVector = when (mode) {
                                                "light" -> Icons.Default.WbSunny
                                                "dark" -> Icons.Default.NightsStay
                                                else -> Icons.Default.PhoneAndroid
                                            },
                                            contentDescription = null,
                                            tint = when (mode) {
                                                "light" -> SonaraDesign.LightText
                                                else -> SonaraDesign.DarkText
                                            },
                                            modifier = Modifier.size(24.dp)
                                        )
                                    }

                                    Spacer(Modifier.width(16.dp))

                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = label,
                                            color = text,
                                            fontSize = 16.sp,
                                            fontWeight = FontWeight.Bold
                                        )
                                        Text(
                                            text = desc,
                                            color = muted,
                                            fontSize = 13.sp
                                        )
                                    }

                                    if (isSelected) {
                                        Icon(
                                            imageVector = Icons.Default.Check,
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
            }

            1 -> {
                // ─── Colors Tab ───────────────────────────────────────
                item {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 20.dp)
                    ) {
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(20.dp),
                            color = paper,
                            border = BorderStroke(1.dp, line)
                        ) {
                            Column(modifier = Modifier.padding(20.dp)) {
                                Text(
                                    text = "Accent signal color",
                                    color = text,
                                    fontSize = 17.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                Text(
                                    text = "A single signal color for progress, hearts, and active tabs.",
                                    color = muted,
                                    fontSize = 13.sp
                                )

                                Spacer(Modifier.height(16.dp))

                                // Swatches Grid
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                                ) {
                                    for (idx in 0..SonaraDesign.Accents.size - 1) {
                                        val option = SonaraDesign.Accents[idx]
                                        val isSelected = themeViewModel.accentSelection == option.id
                                        val swatchColor = if (isDark) option.dark else option.light

                                        Box(
                                            modifier = Modifier
                                                .size(42.dp)
                                                .clip(CircleShape)
                                                .background(swatchColor)
                                                .border(
                                                    if (isSelected) 3.dp else 1.dp,
                                                    if (isSelected) text else Color.Black.copy(alpha = 0.2f),
                                                    CircleShape
                                                )
                                                .clickable { themeViewModel.updateAccent(option.id) },
                                            contentAlignment = Alignment.Center
                                        ) {
                                            if (isSelected) {
                                                Icon(
                                                    imageVector = Icons.Default.Check,
                                                    contentDescription = null,
                                                    tint = Color.White,
                                                    modifier = Modifier.size(18.dp)
                                                )
                                            }
                                        }
                                    }
                                }

                                Spacer(Modifier.height(16.dp))

                                val selectedOption = SonaraDesign.Accents.find { it.id == themeViewModel.accentSelection }
                                Text(
                                    text = "Active: ${selectedOption?.name ?: "Custom"}",
                                    color = muted,
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Medium
                                )

                                Spacer(Modifier.height(12.dp))

                                TextButton(
                                    onClick = { themeViewModel.updateAccent("poppy") }
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.Refresh,
                                        contentDescription = null,
                                        tint = accent,
                                        modifier = Modifier.size(16.dp)
                                    )
                                    Spacer(Modifier.width(6.dp))
                                    Text("Reset color", color = accent, fontSize = 13.sp)
                                }
                            }
                        }

                        Spacer(Modifier.height(20.dp))

                        // Preview Box
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(20.dp),
                            color = paper,
                            border = BorderStroke(1.dp, line)
                        ) {
                            Column(modifier = Modifier.padding(20.dp)) {
                                Text(
                                    text = "Preview",
                                    color = text,
                                    fontSize = 16.sp,
                                    fontWeight = FontWeight.Bold
                                )

                                Spacer(Modifier.height(16.dp))

                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(16.dp)
                                ) {
                                    Button(
                                        onClick = { },
                                        colors = ButtonDefaults.buttonColors(containerColor = text),
                                        shape = RoundedCornerShape(999.dp)
                                    ) {
                                        Text("Primary Button", color = bg)
                                    }

                                    IconButton(onClick = { }) {
                                        Icon(
                                            imageVector = Icons.Default.Favorite,
                                            contentDescription = null,
                                            tint = accent,
                                            modifier = Modifier.size(24.dp)
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }

            2 -> {
                // ─── Settings Tab ─────────────────────────────────────
                item {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 20.dp)
                    ) {
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(20.dp),
                            color = paper,
                            border = BorderStroke(1.dp, line)
                        ) {
                            Column(modifier = Modifier.padding(20.dp)) {
                                // User Name Setting
                                Text("Listener name", color = text, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                                Spacer(Modifier.height(4.dp))
                                Text("Shown in greetings and player headers", color = muted, fontSize = 12.sp)
                                Spacer(Modifier.height(10.dp))

                                OutlinedTextField(
                                    value = userNameInput,
                                    onValueChange = {
                                        userNameInput = it
                                        themeViewModel.updateUserName(it)
                                    },
                                    singleLine = true,
                                    modifier = Modifier.fillMaxWidth(),
                                    shape = RoundedCornerShape(12.dp)
                                )

                                Spacer(Modifier.height(20.dp))
                                Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(line))
                                Spacer(Modifier.height(16.dp))

                                // Render Backend URL Setting
                                Text("Render Cloud API", color = text, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                                Spacer(Modifier.height(4.dp))
                                Text("Connects the Android app to the live Render web backend", color = muted, fontSize = 12.sp)
                                Spacer(Modifier.height(10.dp))

                                OutlinedTextField(
                                    value = apiUrlInput,
                                    onValueChange = { apiUrlInput = it },
                                    singleLine = true,
                                    modifier = Modifier.fillMaxWidth(),
                                    shape = RoundedCornerShape(12.dp),
                                    placeholder = { Text("https://sonara-xgmr.onrender.com/api", color = muted) }
                                )

                                Spacer(Modifier.height(10.dp))

                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Button(
                                        onClick = {
                                            viewModel.updateApiBaseUrl(apiUrlInput)
                                            if (!viewModel.isOnlineMode) {
                                                viewModel.toggleOnlineMode(true)
                                            }
                                        },
                                        colors = ButtonDefaults.buttonColors(containerColor = accent),
                                        shape = RoundedCornerShape(12.dp)
                                    ) {
                                        Text("Save & Connect", color = Color.White, fontWeight = FontWeight.Bold)
                                    }

                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Box(
                                            modifier = Modifier
                                                .size(8.dp)
                                                .clip(CircleShape)
                                                .background(
                                                    if (viewModel.isOnlineMode && viewModel.onlineError == null) Color(0xFF00E676)
                                                    else Color(0xFFFF5252)
                                                )
                                        )
                                        Spacer(Modifier.width(6.dp))
                                        Text(
                                            text = if (viewModel.isOnlineMode) {
                                                if (viewModel.isOnlineLoading) "Connecting..."
                                                else if (viewModel.onlineError != null) "Error"
                                                else "Online"
                                            } else "Offline",
                                            color = muted,
                                            fontSize = 12.sp
                                        )
                                    }
                                }

                                Spacer(Modifier.height(20.dp))
                                Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(line))
                                Spacer(Modifier.height(16.dp))

                                // Toggles
                                SettingToggle(
                                    title = "Show waveforms",
                                    subtitle = "Draws small waveforms along track lists.",
                                    checked = themeViewModel.showWaveforms,
                                    onCheckedChange = { themeViewModel.toggleWaveforms(it) },
                                    accent = accent,
                                    text = text,
                                    muted = muted
                                )

                                Spacer(Modifier.height(16.dp))
                                Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(line))
                                Spacer(Modifier.height(16.dp))

                                SettingToggle(
                                    title = "Spinning records",
                                    subtitle = "Vinyl records turn while music plays.",
                                    checked = themeViewModel.spinRecords,
                                    onCheckedChange = { themeViewModel.toggleSpinRecords(it) },
                                    accent = accent,
                                    text = text,
                                    muted = muted
                                )

                                Spacer(Modifier.height(16.dp))
                                Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(line))
                                Spacer(Modifier.height(16.dp))

                                SettingToggle(
                                    title = "Compact rows",
                                    subtitle = "Fits more tracks on screen at once.",
                                    checked = themeViewModel.compactRows,
                                    onCheckedChange = { themeViewModel.toggleCompactRows(it) },
                                    accent = accent,
                                    text = text,
                                    muted = muted
                                )

                                Spacer(Modifier.height(24.dp))

                                Button(
                                    onClick = { themeViewModel.resetAppearance() },
                                    modifier = Modifier.fillMaxWidth(),
                                    colors = ButtonDefaults.buttonColors(containerColor = paper),
                                    border = BorderStroke(1.5.dp, text),
                                    shape = RoundedCornerShape(999.dp)
                                ) {
                                    Icon(Icons.Default.Refresh, contentDescription = null, tint = text, modifier = Modifier.size(18.dp))
                                    Spacer(Modifier.width(8.dp))
                                    Text("Reset all appearance options", color = text, fontWeight = FontWeight.Bold)
                                }
                            }
                        }
                    }
                }
            }

            3 -> {
                // ─── Admin Billing Tab ───────────────────────────────
                item {
                    LaunchedEffect(Unit) {
                        viewModel.loadAdminStats()
                    }

                    val statsJson = viewModel.adminStatsJson
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 20.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(20.dp),
                            color = paper,
                            border = BorderStroke(1.dp, line)
                        ) {
                            Column(modifier = Modifier.padding(20.dp)) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text("👑 Cloudflare R2 Billing", color = text, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                                        Text("Calculates storage used per user vs 10 GB free limit", color = muted, fontSize = 12.sp)
                                    }
                                    Button(
                                        onClick = { viewModel.loadAdminStats() },
                                        colors = ButtonDefaults.buttonColors(containerColor = accent),
                                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                                        shape = RoundedCornerShape(12.dp)
                                    ) {
                                        Text("Refresh", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                    }
                                }

                                Spacer(Modifier.height(16.dp))

                                if (statsJson == null) {
                                    Text("Loading storage metrics...", color = muted, fontSize = 13.sp)
                                } else {
                                    try {
                                        val root = JSONObject(statsJson)
                                        val summary = root.getJSONObject("summary")
                                        val totalMB = summary.optDouble("totalStorageMB", 0.0)
                                        val totalGB = summary.optDouble("totalStorageGB", 0.0)
                                        val billableGB = summary.optDouble("billableGB", 0.0)
                                        val estCost = summary.optDouble("totalEstimatedMonthlyCostUSD", 0.0)
                                        val totalUsers = summary.optInt("totalUsers", 0)
                                        val totalTracks = summary.optInt("totalTracks", 0)
                                        val pct = ((totalGB / 10.0) * 100).toInt().coerceIn(0, 100)

                                        // Usage Summary Cards
                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                                        ) {
                                            Surface(
                                                modifier = Modifier.weight(1f),
                                                shape = RoundedCornerShape(14.dp),
                                                color = bg,
                                                border = BorderStroke(1.dp, line)
                                            ) {
                                                Column(modifier = Modifier.padding(12.dp)) {
                                                    Text("TOTAL STORAGE", color = muted, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                                                    Text("${totalMB.toInt()} MB", color = text, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                                                    Text("$pct% of 10GB free limit", color = if (pct > 80) Color(0xFFFFB300) else muted, fontSize = 11.sp)
                                                }
                                            }

                                            Surface(
                                                modifier = Modifier.weight(1f),
                                                shape = RoundedCornerShape(14.dp),
                                                color = bg,
                                                border = BorderStroke(1.dp, line)
                                            ) {
                                                Column(modifier = Modifier.padding(12.dp)) {
                                                    Text("EST. MONTHLY COST", color = muted, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                                                    Text("$${String.format(Locale.US, "%.2f", estCost)}/mo", color = accent, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                                                    Text("${billableGB.toFloat()} GB overage", color = muted, fontSize = 11.sp)
                                                }
                                            }
                                        }

                                        Spacer(Modifier.height(16.dp))

                                        // Capacity Bar
                                        Text("R2 Free Storage Quota (10 GB)", color = text, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                                        Spacer(Modifier.height(6.dp))
                                        Box(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .height(8.dp)
                                                .clip(RoundedCornerShape(4.dp))
                                                .background(line)
                                        ) {
                                            Box(
                                                modifier = Modifier
                                                    .fillMaxWidth(pct / 100f)
                                                    .fillMaxHeight()
                                                    .background(if (pct > 90) Color(0xFFFF5252) else if (pct > 70) Color(0xFFFFB300) else Color(0xFF00E676))
                                            )
                                        }

                                        Spacer(Modifier.height(20.dp))
                                        Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(line))
                                        Spacer(Modifier.height(16.dp))

                                        // Per-User Breakdown List
                                        Text("User Storage Breakdown ($totalUsers Uploaders, $totalTracks Tracks)", color = text, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                                        Spacer(Modifier.height(12.dp))

                                        val breakdown = root.optJSONArray("userBreakdown")
                                        if (breakdown != null) {
                                            val len = breakdown.length()
                                            for (i in 0 until len) {
                                                val u = breakdown.getJSONObject(i)
                                                val name = u.optString("displayName", "User")
                                                val email = u.optString("email", "N/A")
                                                val tracksCount = u.optInt("trackCount", 0)
                                                val userMB = u.optDouble("totalMB", 0.0)
                                                val userCost = u.optDouble("estimatedMonthlyCostUSD", 0.0)
                                                val sharePct = u.optDouble("sharePercentage", 0.0)

                                                Row(
                                                    modifier = Modifier
                                                        .fillMaxWidth()
                                                        .padding(vertical = 6.dp),
                                                    verticalAlignment = Alignment.CenterVertically
                                                ) {
                                                    Column(modifier = Modifier.weight(1f)) {
                                                        Text(name, color = text, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                                                        Text("$email • $tracksCount tracks", color = muted, fontSize = 11.sp)
                                                    }
                                                    Column(horizontalAlignment = Alignment.End) {
                                                        Text("${userMB.toInt()} MB (${String.format(Locale.US, "%.1f", sharePct)}%)", color = text, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                                                        Text("$${String.format(Locale.US, "%.4f", userCost)}/mo", color = accent, fontSize = 11.sp)
                                                    }
                                                }
                                                if (i < len - 1) {
                                                    Spacer(Modifier.height(4.dp))
                                                }
                                            }
                                        }
                                    } catch (e: Exception) {
                                        Text("Error parsing metrics: ${e.message}", color = Color(0xFFFF5252), fontSize = 12.sp)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SettingToggle(
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    accent: Color,
    text: Color,
    muted: Color
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, color = text, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            Text(subtitle, color = muted, fontSize = 12.sp)
        }
        Spacer(Modifier.width(16.dp))
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = Color.White,
                checkedTrackColor = accent
            )
        )
    }
}
