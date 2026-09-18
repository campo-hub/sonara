package com.sonara.app.ui

import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.lifecycle.AndroidViewModel
import org.json.JSONArray
import org.json.JSONObject

data class LiquidIdentity(
    val name: String,
    val primary: Color,
    val secondary: Color,
    val textColor: Color,
    val vibe: VibeType = VibeType.NEON
)

enum class VibeType { NEON, AURORA, OCEAN, SOLAR, MONO }

val LiquidIdentities = listOf(
    LiquidIdentity("Cyber Pink", Color(0xFFFF2D95), Color(0xFF7C4DFF), Color.White, VibeType.NEON),
    LiquidIdentity("Deep Ocean", Color(0xFF00B8D4), Color(0xFF006064), Color.White, VibeType.OCEAN),
    LiquidIdentity("Northern Lights", Color(0xFF00E676), Color(0xFF7C4DFF), Color.White, VibeType.AURORA),
    LiquidIdentity("Solar Flare", Color(0xFFFF9100), Color(0xFFFF3D00), Color.White, VibeType.SOLAR),
    LiquidIdentity("Void Purple", Color(0xFFD500F9), Color(0xFF6200EA), Color.White, VibeType.NEON),
    LiquidIdentity("Arctic White", Color(0xFFB0BEC5), Color(0xFF546E7A), Color.White, VibeType.MONO),
    LiquidIdentity("Neon Sunset", Color(0xFFFF6B6B), Color(0xFF4ECDC4), Color.White, VibeType.NEON),
    LiquidIdentity("Forest", Color(0xFF2ECC71), Color(0xFF27AE60), Color.White, VibeType.AURORA),
    LiquidIdentity("Crimson", Color(0xFFE74C3C), Color(0xFFC0392B), Color.White, VibeType.SOLAR),
    LiquidIdentity("Ocean Mist", Color(0xFF3498DB), Color(0xFF2980B9), Color.White, VibeType.OCEAN),
)

data class ThemePreset(
    val name: String,
    val primary: Color,
    val secondary: Color,
    val textColor: Color,
    val isBuiltIn: Boolean = false
)

class ThemeViewModel(application: Application) : AndroidViewModel(application) {
    private val prefs: SharedPreferences = application.getSharedPreferences("liquid_prefs", Context.MODE_PRIVATE)

    var primary by mutableStateOf(Color(prefs.getInt("primary", Color(0xFFFF2D95).toArgb())))
        private set
    var secondary by mutableStateOf(Color(prefs.getInt("secondary", Color(0xFF7C4DFF).toArgb())))
        private set
    var textColor by mutableStateOf(Color(prefs.getInt("text_color", Color.White.toArgb())))
        private set

    var userName by mutableStateOf(prefs.getString("user_name", "Alex") ?: "Alex")
        private set

    var currentVibe by mutableStateOf(VibeType.valueOf(
        prefs.getString("vibe", VibeType.NEON.name) ?: VibeType.NEON.name
    ))
        private set

    var isVisualizerEnabled by mutableStateOf(prefs.getBoolean("visualizer", true))
        private set

    var currentMood by mutableStateOf("Chill")
        private set

    // Custom presets
    var customPresets by mutableStateOf(loadCustomPresets())
        private set

    fun applyIdentity(identity: LiquidIdentity) {
        primary = identity.primary
        secondary = identity.secondary
        textColor = identity.textColor
        currentVibe = identity.vibe
        prefs.edit()
            .putInt("primary", identity.primary.toArgb())
            .putInt("secondary", identity.secondary.toArgb())
            .putInt("text_color", identity.textColor.toArgb())
            .putString("vibe", identity.vibe.name)
            .apply()
    }

    fun applyPreset(preset: ThemePreset) {
        primary = preset.primary
        secondary = preset.secondary
        textColor = preset.textColor
        prefs.edit()
            .putInt("primary", preset.primary.toArgb())
            .putInt("secondary", preset.secondary.toArgb())
            .putInt("text_color", preset.textColor.toArgb())
            .apply()
    }

    fun updatePrimary(color: Color) {
        primary = color
        prefs.edit().putInt("primary", color.toArgb()).apply()
    }

    fun updateSecondary(color: Color) {
        secondary = color
        prefs.edit().putInt("secondary", color.toArgb()).apply()
    }

    fun updateTextColor(color: Color) {
        textColor = color
        prefs.edit().putInt("text_color", color.toArgb()).apply()
    }

    fun updateUserName(name: String) {
        userName = name
        prefs.edit().putString("user_name", name).apply()
    }

    fun toggleVisualizer(enabled: Boolean) {
        isVisualizerEnabled = enabled
        prefs.edit().putBoolean("visualizer", enabled).apply()
    }

    fun updateMood(mood: String) {
        currentMood = mood
    }

    // Custom preset management
    fun saveCustomPreset(name: String) {
        val preset = ThemePreset(name, primary, secondary, textColor)
        val updated = customPresets.toMutableList()
        // Check if name exists, overwrite
        val existingIndex = updated.indexOfFirst { it.name == name }
        if (existingIndex >= 0) {
            updated[existingIndex] = preset
        } else {
            updated.add(preset)
        }
        customPresets = updated
        saveCustomPresetsToPrefs(updated)
    }

    fun deleteCustomPreset(name: String) {
        val updated = customPresets.filter { it.name != name }
        customPresets = updated
        saveCustomPresetsToPrefs(updated)
    }

    fun renameCustomPreset(oldName: String, newName: String) {
        val updated = customPresets.map {
            if (it.name == oldName) it.copy(name = newName) else it
        }
        customPresets = updated
        saveCustomPresetsToPrefs(updated)
    }

    private fun saveCustomPresetsToPrefs(presets: List<ThemePreset>) {
        val jsonArray = JSONArray()
        for (preset in presets) {
            val obj = JSONObject().apply {
                put("name", preset.name)
                put("primary", preset.primary.toArgb())
                put("secondary", preset.secondary.toArgb())
                put("text_color", preset.textColor.toArgb())
            }
            jsonArray.put(obj)
        }
        prefs.edit().putString("custom_presets", jsonArray.toString()).apply()
    }

    private fun loadCustomPresets(): List<ThemePreset> {
        val json = prefs.getString("custom_presets", null) ?: return emptyList()
        return try {
            val jsonArray = JSONArray(json)
            (0 until jsonArray.length()).map { i ->
                val obj = jsonArray.getJSONObject(i)
                ThemePreset(
                    name = obj.getString("name"),
                    primary = Color(obj.getInt("primary")),
                    secondary = Color(obj.getInt("secondary")),
                    textColor = Color(obj.getInt("text_color"))
                )
            }
        } catch (e: Exception) {
            emptyList()
        }
    }

    fun getAllPresets(): List<ThemePreset> {
        val builtIn = LiquidIdentities.map {
            ThemePreset(it.name, it.primary, it.secondary, it.textColor, isBuiltIn = true)
        }
        return builtIn + customPresets
    }
}
