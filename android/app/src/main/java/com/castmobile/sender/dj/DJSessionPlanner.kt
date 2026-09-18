package com.sonara.app.dj

import com.sonara.app.model.Track
import java.util.Calendar
import kotlin.math.abs

/**
 * DJSessionPlanner - Creates coherent listening sessions
 * 
 * Inspired by Spotify's DJ but for local music:
 * - Plans energy curves (not random shuffle)
 * - Creates smooth transitions between songs
 * - Adapts to time of day
 * - Supports different session types (workout, chill, focus, etc.)
 * - Considers listening duration and breaks
 */
class DJSessionPlanner(
    private val analyzer: SongAnalyzer,
    private val preferences: PreferenceEngine
) {
    
    enum class SessionType {
        WORKOUT,        // High energy, fast tempo, aggressive
        CHILL,          // Low energy, smooth transitions
        FOCUS,          // Consistent, not distracting
        PARTY,          // High energy, danceable, fun
        MORNING,        // Gentle wake up, increasing energy
        NIGHT,          // Wind down, decreasing energy
        DISCOVER,       // Explore new genres/artists
        ROAD_TRIP,      // Mixed energy, sing-alongs
        CUSTOM          // User defined
    }
    
    data class SessionPlan(
        val type: SessionType,
        val targetDurationMinutes: Int,
        val energyCurve: List<Float>,  // target energy for each position
        val trackCount: Int,
        val startEnergy: Float,
        val endEnergy: Float,
        val peakPosition: Int,         // index where energy peaks
        val genreMix: Map<SongAnalyzer.Genre, Float>, // genre distribution
        val themeName: String = type.name // display name for the theme
    )
    
    companion object {
        const val TRACKS_PER_THEME = 7
    }
    
    data class Transition(
        val fromTrackId: Long,
        val toTrackId: Long,
        val fromFeatures: SongAnalyzer.AudioFeatures,
        val toFeatures: SongAnalyzer.AudioFeatures,
        val smoothnessScore: Float,  // 0-1, higher = smoother
        val suggestedCrossfadeMs: Int
    )
    
    /**
     * Create a session plan based on type and duration
     */
    fun createSession(
        type: SessionType,
        durationMinutes: Int,
        trackFeatures: Map<Long, SongAnalyzer.AudioFeatures>,
        profile: PreferenceEngine.TasteProfile
    ): SessionPlan {
        val targetTrackCount = estimateTrackCount(durationMinutes, trackFeatures)
        val energyCurve = generateEnergyCurve(type, targetTrackCount)
        val genreMix = calculateGenreMix(type, profile)
        
        return SessionPlan(
            type = type,
            targetDurationMinutes = durationMinutes,
            energyCurve = energyCurve,
            trackCount = targetTrackCount,
            startEnergy = energyCurve.firstOrNull() ?: 0.5f,
            endEnergy = energyCurve.lastOrNull() ?: 0.5f,
            peakPosition = energyCurve.indices.maxByOrNull { energyCurve[it] } ?: 0,
            genreMix = genreMix
        )
    }
    
    /**
     * Auto-detect best session type based on current conditions
     */
    fun detectOptimalSessionType(profile: PreferenceEngine.TasteProfile): SessionType {
        val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
        val preferredEnergy = profile.energyPreference
        val preferredMood = preferences.getCurrentMoodPreference(profile)
        
        return when {
            // Early morning
            hour in 5..7 -> SessionType.MORNING
            
            // Work hours
            hour in 9..17 && preferredEnergy < 0.5f -> SessionType.FOCUS
            
            // Evening
            hour in 18..20 -> SessionType.CHILL
            
            // Late night
            hour in 21..23 || hour in 0..4 -> SessionType.NIGHT
            
            // High energy preference
            preferredEnergy > 0.7f -> SessionType.PARTY
            
            // Default
            else -> SessionType.CHILL
        }
    }
    
    /**
     * Generate a sequence of themes for intelligent session progression
     * Returns a list of SessionTypes that will rotate through different vibes
     */
    fun generateThemeRotation(
        startType: SessionType,
        profile: PreferenceEngine.TasteProfile,
        count: Int = 5
    ): List<SessionType> {
        val themes = mutableListOf<SessionType>()
        val availableTypes = SessionType.entries.filter { it != SessionType.CUSTOM }
        
        // Start with the detected/selected type
        themes.add(startType)
        
        // Build rotation based on energy flow and variety
        val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
        
        // Create a natural flow: e.g., CHILL -> FOCUS -> WORKOUT -> PARTY -> NIGHT
        val energyFlow = when {
            hour in 5..11 -> listOf(
                SessionType.MORNING,
                SessionType.FOCUS,
                SessionType.CHILL,
                SessionType.WORKOUT,
                SessionType.PARTY
            )
            hour in 12..17 -> listOf(
                SessionType.WORKOUT,
                SessionType.PARTY,
                SessionType.FOCUS,
                SessionType.CHILL,
                SessionType.NIGHT
            )
            hour in 18..23 -> listOf(
                SessionType.CHILL,
                SessionType.NIGHT,
                SessionType.PARTY,
                SessionType.WORKOUT,
                SessionType.MORNING
            )
            else -> listOf(
                SessionType.NIGHT,
                SessionType.CHILL,
                SessionType.MORNING,
                SessionType.FOCUS,
                SessionType.WORKOUT
            )
        }
        
        // Add themes from energy flow, avoiding repeats
        for (theme in energyFlow) {
            if (themes.size >= count) break
            if (theme !in themes) {
                themes.add(theme)
            }
        }
        
        // Fill remaining with random variety if needed
        while (themes.size < count) {
            val remaining = availableTypes.filter { it !in themes }
            if (remaining.isEmpty()) break
            themes.add(remaining.random())
        }
        
        return themes
    }
    
    /**
     * Create a session plan for a specific theme within a rotation
     */
    fun createThemeSession(
        type: SessionType,
        profile: PreferenceEngine.TasteProfile,
        trackFeatures: Map<Long, SongAnalyzer.AudioFeatures>,
        themeIndex: Int = 0,
        themeName: String? = null
    ): SessionPlan {
        // Each theme gets approximately TRACKS_PER_THEME songs
        val trackCount = TRACKS_PER_THEME
        val energyCurve = generateEnergyCurve(type, trackCount)
        val genreMix = calculateGenreMix(type, profile)
        
        val displayThemeName = themeName ?: getThemeDisplayName(type)
        
        return SessionPlan(
            type = type,
            targetDurationMinutes = trackCount * 4, // assume 4 min avg
            energyCurve = energyCurve,
            trackCount = trackCount,
            startEnergy = energyCurve.firstOrNull() ?: 0.5f,
            endEnergy = energyCurve.lastOrNull() ?: 0.5f,
            peakPosition = energyCurve.indices.maxByOrNull { energyCurve[it] } ?: 0,
            genreMix = genreMix,
            themeName = displayThemeName
        )
    }
    
    /**
     * Get display name for a theme
     */
    fun getThemeDisplayName(type: SessionType): String {
        return when (type) {
            SessionType.CHILL -> "Chill Vibes"
            SessionType.WORKOUT -> "Workout Energy"
            SessionType.FOCUS -> "Deep Focus"
            SessionType.PARTY -> "Party Mode"
            SessionType.MORNING -> "Morning Sunrise"
            SessionType.NIGHT -> "Night Drive"
            SessionType.DISCOVER -> "New Discovery"
            SessionType.ROAD_TRIP -> "Road Trip"
            SessionType.CUSTOM -> "Your Mix"
        }
    }
    
    /**
     * Generate smooth energy curve for session
     */
    private fun generateEnergyCurve(type: SessionType, trackCount: Int): List<Float> {
        if (trackCount <= 0) return emptyList()
        
        return when (type) {
            SessionType.WORKOUT -> {
                // High energy throughout with slight ramp up
                List(trackCount) { i ->
                    val progress = i.toFloat() / (trackCount - 1).coerceAtLeast(1)
                    0.7f + progress * 0.25f  // 0.7 to 0.95
                }
            }
            
            SessionType.CHILL -> {
                // Gentle arc: medium -> high -> medium -> low
                List(trackCount) { i ->
                    val progress = i.toFloat() / (trackCount - 1).coerceAtLeast(1)
                    when {
                        progress < 0.2f -> 0.4f + progress  // 0.4 to 0.6
                        progress < 0.5f -> 0.6f + (progress - 0.2f) * 0.67f  // 0.6 to 0.8
                        progress < 0.8f -> 0.8f - (progress - 0.5f) * 0.67f  // 0.8 to 0.6
                        else -> 0.6f - (progress - 0.8f) * 1.0f  // 0.6 to 0.4
                    }
                }
            }
            
            SessionType.FOCUS -> {
                // Consistent energy, minimal variation
                List(trackCount) { 0.5f }
            }
            
            SessionType.PARTY -> {
                // High energy with peaks
                List(trackCount) { i ->
                    val progress = i.toFloat() / (trackCount - 1).coerceAtLeast(1)
                    val base = 0.7f + (i % 3) * 0.1f  // Base oscillation
                    base + progress * 0.15f  // Gradual increase
                }.coerceAll()
            }
            
            SessionType.MORNING -> {
                // Start low, gradually increase
                List(trackCount) { i ->
                    val progress = i.toFloat() / (trackCount - 1).coerceAtLeast(1)
                    0.2f + progress * 0.6f  // 0.2 to 0.8
                }
            }
            
            SessionType.NIGHT -> {
                // Start medium, decrease to calm
                List(trackCount) { i ->
                    val progress = i.toFloat() / (trackCount - 1).coerceAtLeast(1)
                    0.6f - progress * 0.4f  // 0.6 to 0.2
                }
            }
            
            SessionType.DISCOVER -> {
                // Varied energy to showcase diversity
                List(trackCount) { i ->
                    when (i % 4) {
                        0 -> 0.5f
                        1 -> 0.8f
                        2 -> 0.4f
                        3 -> 0.7f
                        else -> 0.5f
                    }
                }
            }
            
            SessionType.ROAD_TRIP -> {
                // Mixed with singalong peaks
                List(trackCount) { i ->
                    val base = 0.5f + (i % 5) * 0.1f
                    base + kotlin.math.sin(i * 0.5f) * 0.15f
                }.coerceAll()
            }
            
            SessionType.CUSTOM -> {
                List(trackCount) { 0.5f }
            }
        }
    }
    
    /**
     * Calculate genre distribution for session
     */
    private fun calculateGenreMix(
        type: SessionType,
        profile: PreferenceEngine.TasteProfile
    ): Map<SongAnalyzer.Genre, Float> {
        val topGenres = profile.genreScores.entries
            .sortedByDescending { it.value }
            .take(3)
            .map { it.key }
        
        return when (type) {
            SessionType.WORKOUT -> mapOf(
                SongAnalyzer.Genre.HIP_HOP to 0.4f,
                SongAnalyzer.Genre.ELECTRONIC to 0.3f,
                SongAnalyzer.Genre.POP to 0.3f
            )
            
            SessionType.FOCUS -> mapOf(
                SongAnalyzer.Genre.LO_FI to 0.4f,
                SongAnalyzer.Genre.CLASSICAL to 0.3f,
                SongAnalyzer.Genre.JAZZ to 0.3f
            )
            
            SessionType.CHILL -> mapOf(
                SongAnalyzer.Genre.RNB to 0.35f,
                SongAnalyzer.Genre.AFROBEATS to 0.35f,
                SongAnalyzer.Genre.LO_FI to 0.3f
            )
            
            SessionType.PARTY -> mapOf(
                SongAnalyzer.Genre.DANCE to 0.3f,
                SongAnalyzer.Genre.POP to 0.3f,
                SongAnalyzer.Genre.HIP_HOP to 0.4f
            )
            
            else -> {
                // Use user's top genres
                if (topGenres.isNotEmpty()) {
                    val perGenre = 1f / topGenres.size
                    topGenres.associateWith { perGenre }
                } else {
                    mapOf(
                        SongAnalyzer.Genre.POP to 0.4f,
                        SongAnalyzer.Genre.HIP_HOP to 0.3f,
                        SongAnalyzer.Genre.RNB to 0.3f
                    )
                }
            }
        }
    }
    
    /**
     * Calculate transition smoothness between two tracks
     */
    fun calculateTransition(
        from: SongAnalyzer.AudioFeatures,
        to: SongAnalyzer.AudioFeatures
    ): Transition {
        var smoothness = 0f
        
        // Energy similarity (most important for smoothness)
        val energyDiff = abs(from.energy - to.energy)
        smoothness += (1f - energyDiff) * 0.4f
        
        // Genre compatibility
        if (from.genre == to.genre) {
            smoothness += 0.3f
        } else if (from.genre.categoryOf() == to.genre.categoryOf()) {
            smoothness += 0.15f
        }
        
        // Tempo match
        if (from.tempo == to.tempo) {
            smoothness += 0.2f
        } else {
            val tempoOrder = listOf(
                SongAnalyzer.Tempo.VERY_SLOW,
                SongAnalyzer.Tempo.SLOW,
                SongAnalyzer.Tempo.MEDIUM,
                SongAnalyzer.Tempo.FAST,
                SongAnalyzer.Tempo.VERY_FAST
            )
            val fromIdx = tempoOrder.indexOf(from.tempo)
            val toIdx = tempoOrder.indexOf(to.tempo)
            val tempoDiff = abs(fromIdx - toIdx) / 4f
            smoothness += (1f - tempoDiff) * 0.15f
        }
        
        // Mood match
        if (from.mood == to.mood) {
            smoothness += 0.1f
        }
        
        // Suggest crossfade based on energy difference
        val crossfadeMs = when {
            energyDiff < 0.1f -> 6000  // Very smooth, long crossfade
            energyDiff < 0.3f -> 4000  // Medium
            energyDiff < 0.5f -> 2000  // Quick
            else -> 0  // Hard cut
        }
        
        return Transition(
            fromTrackId = from.trackId,
            toTrackId = to.trackId,
            fromFeatures = from,
            toFeatures = to,
            smoothnessScore = smoothness.coerceIn(0f, 1f),
            suggestedCrossfadeMs = crossfadeMs
        )
    }
    
    /**
     * Find best next track given current state and plan
     */
    fun findBestNextTrack(
        currentTrack: SongAnalyzer.AudioFeatures?,
        candidates: List<Track>,
        candidateFeatures: Map<Long, SongAnalyzer.AudioFeatures>,
        plan: SessionPlan,
        currentPosition: Int,
        recentlyPlayed: Set<Long>,
        profile: PreferenceEngine.TasteProfile
    ): Track? {
        if (candidates.isEmpty()) return null
        
        val targetEnergy = plan.energyCurve.getOrNull(currentPosition) ?: 0.5f
        
        return candidates
            .filter { it.id !in recentlyPlayed }
            .maxByOrNull { track ->
                val features = candidateFeatures[track.id] ?: return@maxByOrNull 0f
                
                var score = 0f
                
                // Energy match (40% weight)
                val energyDiff = abs(features.energy - targetEnergy)
                score += (1f - energyDiff) * 0.4f
                
                // Preference match (30% weight)
                score += preferences.scoreTrack(track, profile) * 0.3f
                
                // Transition smoothness (20% weight)
                if (currentTrack != null) {
                    val transition = calculateTransition(currentTrack, features)
                    score += transition.smoothnessScore * 0.2f
                }
                
                // Genre diversity bonus (10% weight)
                val genreInPlan = plan.genreMix[features.genre] ?: 0f
                score += genreInPlan * 0.1f
                
                score
            }
    }
    
    private fun SongAnalyzer.Genre.categoryOf(): String {
        return when (this) {
            SongAnalyzer.Genre.HIP_HOP, SongAnalyzer.Genre.RNB -> "urban"
            SongAnalyzer.Genre.POP, SongAnalyzer.Genre.ELECTRONIC, SongAnalyzer.Genre.LATIN, SongAnalyzer.Genre.DANCE -> "mainstream"
            SongAnalyzer.Genre.ROCK, SongAnalyzer.Genre.ALTERNATIVE, SongAnalyzer.Genre.INDIE, SongAnalyzer.Genre.FOLK -> "guitar"
            SongAnalyzer.Genre.JAZZ, SongAnalyzer.Genre.CLASSICAL, SongAnalyzer.Genre.LO_FI, SongAnalyzer.Genre.MELANCHOLY -> "chill"
            SongAnalyzer.Genre.AFROBEATS, SongAnalyzer.Genre.REGGAE -> "world"
            else -> "other"
        }
    }
    
    private fun estimateTrackCount(durationMinutes: Int, trackFeatures: Map<Long, SongAnalyzer.AudioFeatures>): Int {
        // Assume average 4 minute tracks
        val avgDurationMinutes = 4f
        return (durationMinutes / avgDurationMinutes).toInt().coerceIn(5, 50)
    }
    
    private fun List<Float>.coerceAll(): List<Float> {
        return map { it.coerceIn(0f, 1f) }
    }
}
