package com.sonara.app.ui

import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.lifecycle.AndroidViewModel

class ThemeViewModel(application: Application) : AndroidViewModel(application) {
    private val prefs: SharedPreferences = application.getSharedPreferences("sonara_theme_prefs", Context.MODE_PRIVATE)

    // Theme mode: "light", "dark", "system"
    var themeMode by mutableStateOf(prefs.getString("theme_mode", "light") ?: "light")
        private set

    // Accent selection: "poppy", "ochre", "moss", "ink", "teal", "graphite", "custom"
    var accentSelection by mutableStateOf(prefs.getString("accent_selection", "poppy") ?: "poppy")
        private set

    // Custom accent color in hex
    var customAccentHex by mutableStateOf(prefs.getString("custom_accent_hex", "#D83A22") ?: "#D83A22")
        private set

    // Display options
    var showWaveforms by mutableStateOf(prefs.getBoolean("show_waveforms", true))
        private set

    var compactRows by mutableStateOf(prefs.getBoolean("compact_rows", false))
        private set

    var spinRecords by mutableStateOf(prefs.getBoolean("spin_records", true))
        private set

    var userName by mutableStateOf(prefs.getString("user_name", "Listener") ?: "Listener")
        private set

    var isVisualizerEnabled by mutableStateOf(prefs.getBoolean("visualizer", true))
        private set

    // Derived theme properties
    fun isDark(systemDark: Boolean): Boolean {
        return when (themeMode) {
            "dark" -> true
            "light" -> false
            else -> systemDark
        }
    }

    fun getAccentColor(isDark: Boolean): Color {
        if (accentSelection == "custom") {
            return try {
                val hex = customAccentHex.removePrefix("#")
                Color(android.graphics.Color.parseColor("#$hex"))
            } catch (e: Exception) {
                if (isDark) Color(0xFFFF6B4A) else Color(0xFFD83A22)
            }
        }
        val accents = SonaraDesign.Accents
        val option = accents.find { it.id == accentSelection } ?: accents.first()
        return if (isDark) option.dark else option.light
    }

    val primary: Color
        get() = getAccentColor(themeMode == "dark")

    val secondary: Color
        get() = getAccentColor(themeMode == "dark").copy(alpha = 0.7f)

    val textColor: Color
        get() = if (themeMode == "dark") SonaraDesign.DarkText else SonaraDesign.LightText

    fun updateThemeMode(mode: String) {
        themeMode = mode
        prefs.edit().putString("theme_mode", mode).apply()
    }

    fun updateAccent(accentId: String) {
        accentSelection = accentId
        prefs.edit().putString("accent_selection", accentId).apply()
    }

    fun updateCustomAccent(hex: String) {
        customAccentHex = hex
        accentSelection = "custom"
        prefs.edit()
            .putString("custom_accent_hex", hex)
            .putString("accent_selection", "custom")
            .apply()
    }

    fun toggleWaveforms(enabled: Boolean) {
        showWaveforms = enabled
        prefs.edit().putBoolean("show_waveforms", enabled).apply()
    }

    fun toggleCompactRows(enabled: Boolean) {
        compactRows = enabled
        prefs.edit().putBoolean("compact_rows", enabled).apply()
    }

    fun toggleSpinRecords(enabled: Boolean) {
        spinRecords = enabled
        prefs.edit().putBoolean("spin_records", enabled).apply()
    }

    fun updateUserName(name: String) {
        userName = name
        prefs.edit().putString("user_name", name).apply()
    }

    fun toggleVisualizer(enabled: Boolean) {
        isVisualizerEnabled = enabled
        prefs.edit().putBoolean("visualizer", enabled).apply()
    }

    fun resetAppearance() {
        themeMode = "light"
        accentSelection = "poppy"
        customAccentHex = "#D83A22"
        showWaveforms = true
        compactRows = false
        spinRecords = true
        prefs.edit()
            .putString("theme_mode", "light")
            .putString("accent_selection", "poppy")
            .putString("custom_accent_hex", "#D83A22")
            .putBoolean("show_waveforms", true)
            .putBoolean("compact_rows", false)
            .putBoolean("spin_records", true)
            .apply()
    }
}
