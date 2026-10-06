package com.sonara.app.ui

import androidx.compose.ui.graphics.Color

/**
 * Sonara Design System — Personal Record Room Aesthetic
 * Paper & ink foundation, earthy pigments, signal accent colors.
 */
object SonaraDesign {
    // ─── Light Mode (Paper) ───────────────────────────────────
    val LightBg = Color(0xFFEDEBE6)
    val LightPaper = Color(0xFFF8F6F2)
    val LightRaised = Color(0xFFE2DFD8)
    val LightLine = Color(0xFFD2CEC4)
    val LightLineSoft = Color(0xFFDCD9D0)
    val LightInk = Color(0xFF16150F)
    val LightOnInk = Color(0xFFF3F0E8)
    val LightText = Color(0xFF16150F)
    val LightMuted = Color(0xFF6B6860)
    val LightFaint = Color(0xFF9D9A91)

    // ─── Dark Mode (Night) ────────────────────────────────────
    val DarkBg = Color(0xFF15130F)
    val DarkPaper = Color(0xFF1E1B16)
    val DarkRaised = Color(0xFF2A2720)
    val DarkLine = Color(0xFF3A362D)
    val DarkLineSoft = Color(0xFF2A2720)
    val DarkInk = Color(0xFFEDE9DF)
    val DarkOnInk = Color(0xFF15130F)
    val DarkText = Color(0xFFEDE9DF)
    val DarkMuted = Color(0xFFA39E90)
    val DarkFaint = Color(0xFF6F6A5D)

    // ─── Deck (Floating Player) ───────────────────────────────
    val DeckBg = Color(0xFF16150F)
    val DeckFg = Color(0xFFF3F0E8)
    val DeckMuted = Color(0xFFF3F0E8).copy(alpha = 0.62f)
    val DeckTrack = Color(0xFFF3F0E8).copy(alpha = 0.20f)
    val RecordHole = Color(0xFFEDEBE6)

    // ─── Accent Options ───────────────────────────────────────
    data class AccentOption(
        val id: String,
        val name: String,
        val dark: Color,
        val light: Color
    )

    val Accents = listOf(
        AccentOption("poppy", "Poppy", Color(0xFFFF6B4A), Color(0xFFD83A22)),
        AccentOption("ochre", "Ochre", Color(0xFFE5B04A), Color(0xFFB7791F)),
        AccentOption("moss", "Moss", Color(0xFF8FB07A), Color(0xFF4D6B3F)),
        AccentOption("ink", "Ink blue", Color(0xFF8FA9CC), Color(0xFF2F4B6E)),
        AccentOption("teal", "Teal", Color(0xFF6FB5AE), Color(0xFF2F7470)),
        AccentOption("graphite", "Graphite", Color(0xFFCFCBC0), Color(0xFF2B2A27))
    )

    // ─── Sleeve Palettes (Generated Art) ─────────────────────
    val SleevePalettes = listOf(
        listOf(Color(0xFF2F4B6E), Color(0xFFEADBB8), Color(0xFFD9A441)),
        listOf(Color(0xFFD9A441), Color(0xFF16150F), Color(0xFFF3EAD3)),
        listOf(Color(0xFF5E7B4F), Color(0xFFF1E8D0), Color(0xFF26251F)),
        listOf(Color(0xFFB4533C), Color(0xFFF3E6D0), Color(0xFF26251F)),
        listOf(Color(0xFFE2DAC6), Color(0xFF2F4B6E), Color(0xFFB4533C)),
        listOf(Color(0xFF26251F), Color(0xFFD9A441), Color(0xFFEAE2CF))
    )

    // ─── Soundscape Card Tones ────────────────────────────────
    data class Tone(val bg: Color, val fg: Color)
    val SoundscapeTones = listOf(
        Tone(Color(0xFFB4533C), Color(0xFFF6E9DA)),
        Tone(Color(0xFF2F4B6E), Color(0xFFF1E9D6)),
        Tone(Color(0xFFD9A441), Color(0xFF16150F)),
        Tone(Color(0xFF5E7B4F), Color(0xFFF1E9D6)),
        Tone(Color(0xFFE0D8C3), Color(0xFF16150F)),
        Tone(Color(0xFF26251F), Color(0xFFF1E9D6))
    )

    fun hashString(value: String): Int {
        return value.hashCode() and 0x7FFFFFFF
    }
}
