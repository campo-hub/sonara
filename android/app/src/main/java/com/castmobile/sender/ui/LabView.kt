package com.castmobile.sender.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.*

@Composable
fun LiquidLab(
    themeViewModel: ThemeViewModel,
    onCreatePreset: (String) -> Unit
) {
    var selectedTab by remember { mutableIntStateOf(1) }
    var colorMode by remember { mutableStateOf("Primary") }
    var userNameInput by remember { mutableStateOf(themeViewModel.userName) }
    var showNameSaved by remember { mutableStateOf(false) }

    // Preset dialog state
    var showSavePresetDialog by remember { mutableStateOf(false) }
    var showRenamePresetDialog by remember { mutableStateOf(false) }
    var presetNameInput by remember { mutableStateOf("") }
    var presetToRename by remember { mutableStateOf<ThemePreset?>(null) }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 160.dp)
    ) {
        // Header
        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp)
                    .padding(top = 60.dp)
            ) {
                Text(
                    "Appearance Lab",
                    style = MaterialTheme.typography.headlineLarge,
                    fontWeight = FontWeight.Bold,
                    color = Color.White
                )
            }
        }

        // Tab selector
        item {
            Spacer(Modifier.height(20.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp)
            ) {
                listOf("Themes", "Colors", "Settings").forEachIndexed { index, label ->
                    val selected = selectedTab == index
                    Surface(
                        onClick = { selectedTab = index },
                        shape = RoundedCornerShape(10.dp),
                        color = if (selected) themeViewModel.primary else Color(0xFF1A1A1E),
                        border = BorderStroke(1.dp, if (selected) themeViewModel.primary else Color.White.copy(alpha = 0.06f))
                    ) {
                        Text(
                            label,
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                            color = if (selected) Color.White else Color.White.copy(alpha = 0.5f),
                            fontSize = 13.sp,
                            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium
                        )
                    }
                    Spacer(Modifier.width(8.dp))
                }
            }
        }

        when (selectedTab) {
            0 -> {
                // Themes tab - built-in themes
                item {
                    Spacer(Modifier.height(24.dp))
                    Column(
                        modifier = Modifier.padding(horizontal = 24.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            LiquidIdentities.take(3).forEach { identity ->
                                ThemeCard(identity, themeViewModel, Modifier.weight(1f))
                            }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            LiquidIdentities.drop(3).take(3).forEach { identity ->
                                ThemeCard(identity, themeViewModel, Modifier.weight(1f))
                            }
                        }
                    }
                }

                // Custom presets section
                item {
                    Spacer(Modifier.height(32.dp))
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 24.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            "My Presets",
                            style = MaterialTheme.typography.titleMedium,
                            color = Color.White,
                            fontWeight = FontWeight.Bold
                        )
                        Surface(
                            onClick = { showSavePresetDialog = true },
                            shape = RoundedCornerShape(8.dp),
                            color = themeViewModel.primary
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    Icons.Default.Add,
                                    contentDescription = null,
                                    tint = Color.White,
                                    modifier = Modifier.size(16.dp)
                                )
                                Spacer(Modifier.width(4.dp))
                                Text("Save Current", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }

                if (themeViewModel.customPresets.isEmpty()) {
                    item {
                        Spacer(Modifier.height(16.dp))
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 24.dp)
                                .height(80.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                "No custom presets yet",
                                color = Color.White.copy(alpha = 0.3f),
                                fontSize = 14.sp
                            )
                        }
                    }
                } else {
                    itemsIndexed(themeViewModel.customPresets) { index, preset ->
                        CustomPresetItem(
                            preset = preset,
                            isCurrent = themeViewModel.primary == preset.primary &&
                                    themeViewModel.secondary == preset.secondary,
                            onApply = { themeViewModel.applyPreset(preset) },
                            onRename = {
                                presetToRename = preset
                                presetNameInput = preset.name
                                showRenamePresetDialog = true
                            },
                            onDelete = { themeViewModel.deleteCustomPreset(preset.name) }
                        )
                    }
                }
            }
            1 -> {
                // Colors tab - unified picker with mode selector
                item {
                    Spacer(Modifier.height(24.dp))

                    // Mode selector tabs
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 24.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        listOf("Primary", "Secondary", "Text").forEach { mode ->
                            val selected = colorMode == mode
                            val modeColor = when (mode) {
                                "Primary" -> themeViewModel.primary
                                "Secondary" -> themeViewModel.secondary
                                else -> themeViewModel.textColor
                            }
                            Surface(
                                onClick = { colorMode = mode },
                                shape = RoundedCornerShape(10.dp),
                                color = if (selected) modeColor else Color(0xFF1A1A1E),
                                border = BorderStroke(1.dp, if (selected) modeColor else Color.White.copy(alpha = 0.06f))
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .size(12.dp)
                                            .clip(CircleShape)
                                            .background(modeColor)
                                    )
                                    Spacer(Modifier.width(6.dp))
                                    Text(
                                        mode,
                                        color = if (selected) Color.White else Color.White.copy(alpha = 0.5f),
                                        fontSize = 13.sp,
                                        fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium
                                    )
                                }
                            }
                        }
                    }
                }

                // Color wheel for selected mode
                item {
                    Spacer(Modifier.height(20.dp))
                    val currentColor = when (colorMode) {
                        "Primary" -> themeViewModel.primary
                        "Secondary" -> themeViewModel.secondary
                        else -> themeViewModel.textColor
                    }
                    val onColorChanged: (Color) -> Unit = when (colorMode) {
                        "Primary" -> { color -> themeViewModel.updatePrimary(color) }
                        "Secondary" -> { color -> themeViewModel.updateSecondary(color) }
                        else -> { color -> themeViewModel.updateTextColor(color) }
                    }

                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 24.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        DraggableColorWheel(
                            currentColor = currentColor,
                            onColorChanged = onColorChanged
                        )
                    }
                }

                // Current color display
                item {
                    Spacer(Modifier.height(16.dp))
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 24.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        ColorSwatch("Primary", themeViewModel.primary, Modifier.weight(1f))
                        ColorSwatch("Secondary", themeViewModel.secondary, Modifier.weight(1f))
                        ColorSwatch("Text", themeViewModel.textColor, Modifier.weight(1f))
                    }
                }
            }
            2 -> {
                // Settings tab
                item {
                    Spacer(Modifier.height(24.dp))

                    Column(modifier = Modifier.padding(horizontal = 24.dp)) {
                        Text("Your Name", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        Spacer(Modifier.height(8.dp))
                        Text("This will be shown in the greeting", color = Color.White.copy(alpha = 0.5f), fontSize = 12.sp)
                        Spacer(Modifier.height(12.dp))

                        OutlinedTextField(
                            value = userNameInput,
                            onValueChange = { userNameInput = it },
                            placeholder = { Text("Enter your name", color = Color.White.copy(alpha = 0.3f)) },
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

                        Spacer(Modifier.height(12.dp))

                        Button(
                            onClick = {
                                themeViewModel.updateUserName(userNameInput)
                                showNameSaved = true
                            },
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(containerColor = themeViewModel.primary),
                            shape = RoundedCornerShape(12.dp)
                        ) {
                            Text("Save Name", color = Color.White, fontWeight = FontWeight.Bold)
                        }

                        if (showNameSaved) {
                            Spacer(Modifier.height(8.dp))
                            Text("Name saved!", color = Color(0xFF00E676), fontSize = 12.sp)
                        }
                    }

                    Spacer(Modifier.height(32.dp))

                    Column(modifier = Modifier.padding(horizontal = 24.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text("Visualizer", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                                Text("Show audio visualizer on player", color = Color.White.copy(alpha = 0.5f), fontSize = 12.sp)
                            }
                            Switch(
                                checked = themeViewModel.isVisualizerEnabled,
                                onCheckedChange = { themeViewModel.toggleVisualizer(it) },
                                colors = SwitchDefaults.colors(
                                    checkedThumbColor = Color.White,
                                    checkedTrackColor = themeViewModel.primary,
                                    uncheckedThumbColor = Color.Gray,
                                    uncheckedTrackColor = Color(0xFF1A1A1E)
                                )
                            )
                        }
                    }
                }
            }
        }
    }

    // Save preset dialog
    if (showSavePresetDialog) {
        AlertDialog(
            onDismissRequest = { showSavePresetDialog = false },
            containerColor = Color(0xFF1A1A1E),
            title = { Text("Save Preset", color = Color.White, fontWeight = FontWeight.Bold) },
            text = {
                OutlinedTextField(
                    value = presetNameInput,
                    onValueChange = { presetNameInput = it },
                    placeholder = { Text("Preset name", color = Color.White.copy(alpha = 0.3f)) },
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
                        if (presetNameInput.isNotBlank()) {
                            themeViewModel.saveCustomPreset(presetNameInput.trim())
                            onCreatePreset(presetNameInput.trim())
                            presetNameInput = ""
                            showSavePresetDialog = false
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = themeViewModel.primary)
                ) {
                    Text("Save")
                }
            },
            dismissButton = {
                TextButton(onClick = { showSavePresetDialog = false }) {
                    Text("Cancel", color = Color.White.copy(alpha = 0.6f))
                }
            }
        )
    }

    // Rename preset dialog
    if (showRenamePresetDialog && presetToRename != null) {
        AlertDialog(
            onDismissRequest = { showRenamePresetDialog = false },
            containerColor = Color(0xFF1A1A1E),
            title = { Text("Rename Preset", color = Color.White, fontWeight = FontWeight.Bold) },
            text = {
                OutlinedTextField(
                    value = presetNameInput,
                    onValueChange = { presetNameInput = it },
                    placeholder = { Text("New name", color = Color.White.copy(alpha = 0.3f)) },
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
                        if (presetNameInput.isNotBlank() && presetToRename != null) {
                            themeViewModel.renameCustomPreset(presetToRename!!.name, presetNameInput.trim())
                            presetToRename = null
                            presetNameInput = ""
                            showRenamePresetDialog = false
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = themeViewModel.primary)
                ) {
                    Text("Rename")
                }
            },
            dismissButton = {
                TextButton(onClick = { showRenamePresetDialog = false }) {
                    Text("Cancel", color = Color.White.copy(alpha = 0.6f))
                }
            }
        )
    }
}

@Composable
fun ColorSwatch(label: String, color: Color, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            modifier = Modifier
                .size(48.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(color)
                .border(1.dp, Color.White.copy(alpha = 0.1f), RoundedCornerShape(12.dp))
        )
        Spacer(Modifier.height(6.dp))
        Text(label, color = Color.White.copy(alpha = 0.5f), fontSize = 11.sp)
    }
}

@Composable
fun CustomPresetItem(
    preset: ThemePreset,
    isCurrent: Boolean,
    onApply: () -> Unit,
    onRename: () -> Unit,
    onDelete: () -> Unit
) {
    Surface(
        onClick = onApply,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp, vertical = 4.dp),
        shape = RoundedCornerShape(12.dp),
        color = Color(0xFF1A1A1E),
        border = BorderStroke(1.dp, if (isCurrent) preset.primary else Color.White.copy(alpha = 0.06f))
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Color dots
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .clip(CircleShape)
                    .background(preset.primary)
            )
            Spacer(Modifier.width(4.dp))
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .clip(CircleShape)
                    .background(preset.secondary)
            )

            Spacer(Modifier.width(12.dp))

            Text(
                preset.name,
                color = Color.White,
                fontWeight = FontWeight.Bold,
                fontSize = 14.sp,
                modifier = Modifier.weight(1f)
            )

            if (isCurrent) {
                Icon(
                    Icons.Default.Check,
                    contentDescription = null,
                    tint = preset.primary,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(Modifier.width(8.dp))
            }

            // Menu button
            Box {
                var showMenu by remember { mutableStateOf(false) }
                IconButton(onClick = { showMenu = true }) {
                    Icon(
                        Icons.Default.MoreVert,
                        contentDescription = "Options",
                        tint = Color.White.copy(alpha = 0.5f),
                        modifier = Modifier.size(20.dp)
                    )
                }
                DropdownMenu(
                    expanded = showMenu,
                    onDismissRequest = { showMenu = false }
                ) {
                    DropdownMenuItem(
                        text = { Text("Rename") },
                        onClick = {
                            showMenu = false
                            onRename()
                        },
                        leadingIcon = { Icon(Icons.Default.Edit, null, tint = Color.White) }
                    )
                    DropdownMenuItem(
                        text = { Text("Delete", color = Color(0xFFFF5252)) },
                        onClick = {
                            showMenu = false
                            onDelete()
                        },
                        leadingIcon = { Icon(Icons.Default.Delete, null, tint = Color(0xFFFF5252)) }
                    )
                }
            }
        }
    }
}

@Composable
fun ThemeCard(
    identity: LiquidIdentity,
    themeViewModel: ThemeViewModel,
    modifier: Modifier = Modifier
) {
    val isSelected = themeViewModel.primary == identity.primary
    Surface(
        onClick = { themeViewModel.applyIdentity(identity) },
        modifier = modifier.height(100.dp),
        shape = RoundedCornerShape(16.dp),
        color = Color(0xFF1A1A1E),
        border = BorderStroke(2.dp, if (isSelected) themeViewModel.primary else Color.Transparent)
    ) {
        Column(
            modifier = Modifier.padding(8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .background(identity.primary)
            )
            Spacer(Modifier.height(6.dp))
            Text(
                identity.name,
                color = Color.White,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold
            )
        }
    }
}

@Composable
fun DraggableColorWheel(
    currentColor: Color,
    onColorChanged: (Color) -> Unit
) {
    val hsv = remember(currentColor) {
        val hsvArr = FloatArray(3)
        android.graphics.Color.colorToHSV(currentColor.toArgb(), hsvArr)
        hsvArr
    }

    var hue by remember { mutableFloatStateOf(hsv[0]) }
    var saturation by remember { mutableFloatStateOf(hsv[1]) }
    var brightness by remember { mutableFloatStateOf(hsv[2]) }

    LaunchedEffect(currentColor) {
        val newHsv = FloatArray(3)
        android.graphics.Color.colorToHSV(currentColor.toArgb(), newHsv)
        if (abs(newHsv[0] - hue) > 1f || abs(newHsv[1] - saturation) > 0.01f || abs(newHsv[2] - brightness) > 0.01f) {
            hue = newHsv[0]
            saturation = newHsv[1]
            brightness = newHsv[2]
        }
    }

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.fillMaxWidth()
    ) {
        Box(
            modifier = Modifier.size(260.dp),
            contentAlignment = Alignment.Center
        ) {
            Canvas(
                modifier = Modifier
                    .fillMaxSize()
                    .pointerInput(Unit) {
                        awaitEachGesture {
                            awaitFirstDown(requireUnconsumed = false)
                            do {
                                val event = awaitPointerEvent()
                                event.changes.forEach { change ->
                                    change.consume()
                                    val canvasCenter = size.width / 2f
                                    val dx = change.position.x - canvasCenter
                                    val dy = change.position.y - canvasCenter
                                    val distance = sqrt(dx * dx + dy * dy)

                                    if (distance <= canvasCenter) {
                                        val angle = Math.toDegrees(atan2(dy.toDouble(), dx.toDouble())).toFloat()
                                        hue = (angle + 360) % 360
                                        saturation = (distance / canvasCenter).coerceIn(0f, 1f)
                                        onColorChanged(Color.hsv(hue, saturation, brightness))
                                    }
                                }
                            } while (event.changes.any { it.pressed })
                        }
                    }
            ) {
                val canvasCenter = size.width / 2f

                drawArc(
                    brush = Brush.sweepGradient(
                        listOf(
                            Color.Red,
                            Color.Yellow,
                            Color.Green,
                            Color.Cyan,
                            Color.Blue,
                            Color.Magenta,
                            Color.Red
                        )
                    ),
                    startAngle = 0f,
                    sweepAngle = 360f,
                    useCenter = true
                )

                drawCircle(
                    brush = Brush.radialGradient(
                        0f to Color.White.copy(alpha = 0.9f),
                        1f to Color.Transparent
                    )
                )

                val angle = Math.toRadians(hue.toDouble())
                val selectorRadius = saturation * canvasCenter
                val selectorX = canvasCenter + selectorRadius * cos(angle).toFloat()
                val selectorY = canvasCenter + selectorRadius * sin(angle).toFloat()

                drawCircle(
                    color = Color.White,
                    radius = 14.dp.toPx(),
                    center = Offset(selectorX, selectorY),
                    style = Stroke(width = 3.dp.toPx())
                )
                drawCircle(
                    color = Color.hsv(hue, saturation, brightness),
                    radius = 10.dp.toPx(),
                    center = Offset(selectorX, selectorY)
                )
            }
        }

        Spacer(Modifier.height(16.dp))

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 32.dp)
        ) {
            Text("Brightness", color = Color.White.copy(alpha = 0.5f), fontSize = 12.sp)
            Spacer(Modifier.height(8.dp))

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(40.dp)
                    .clip(RoundedCornerShape(20.dp))
                    .background(
                        Brush.horizontalGradient(
                            listOf(Color.Black, Color.hsv(hue, saturation, 1f))
                        )
                    )
                    .pointerInput(Unit) {
                        awaitEachGesture {
                            awaitFirstDown(requireUnconsumed = false)
                            do {
                                val event = awaitPointerEvent()
                                event.changes.forEach { change ->
                                    change.consume()
                                    brightness = (change.position.x / size.width).coerceIn(0.05f, 1f)
                                    onColorChanged(Color.hsv(hue, saturation, brightness))
                                }
                            } while (event.changes.any { it.pressed })
                        }
                    }
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxHeight()
                        .fillMaxWidth(brightness)
                        .wrapContentSize(Alignment.CenterEnd)
                        .padding(end = 2.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(24.dp)
                            .clip(CircleShape)
                            .background(Color.White)
                            .shadow(4.dp, CircleShape)
                    )
                }
            }
        }
    }
}
