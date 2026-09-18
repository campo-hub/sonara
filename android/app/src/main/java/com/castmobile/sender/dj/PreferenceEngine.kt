package com.sonara.app.dj

import com.sonara.app.model.Track
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * PreferenceEngine - Learns and models user taste
 * 
 * Analyzes listening history to build a taste profile:
 * - Genre preferences (weighted by plays/likes)
 * - Energy preferences (time-of-day dependent)
 * - Mood patterns
 * - Artist loyalty vs exploration tendency
 * - Tempo preferences
 * 
 * Uses exponential decay for recent bias (recent plays matter more)
 */
class PreferenceEngine(
    private val history: ListeningHistory,
    private val analyzer: SongAnalyzer
) {
    
    companion object {
        private const val DECAY_HALF_LIFE_DAYS = 14.0f
        private const val LIKE_WEIGHT = 3.0f
        private const val COMPLETION_WEIGHT = 1.5f
        private const val SKIP_PENALTY = -1.0f
    }
    
    data class TasteProfile(
        val genreScores: Map<SongAnalyzer.Genre, Float>,
        val moodScores: Map<SongAnalyzer.Mood, Float>,
        val energyPreference: Float,        // 0.0 to 1.0
        val tempoPreference: SongAnalyzer.Tempo,
        val valencePreference: Float,       // 0.0 (sad) to 1.0 (happy)
        val explorationTendency: Float,     // 0.0 (sticks to favorites) to 1.0 (explores)
        val artistLoyalty: Map<String, Float>, // artist name to loyalty score
        val timeOfDayPreferences: Map<Int, SongAnalyzer.Mood> // hour to preferred mood
    )
    
    /**
     * Build a comprehensive taste profile from listening history
     */
    fun buildProfile(allTracks: List<Track>): TasteProfile {
        val allFeatures = analyzer.analyzeAll(allTracks)
        val trackMap = allTracks.associateBy { it.id }
        
        // Calculate genre preferences
        val genreScores = calculateGenrePreferences(allFeatures)
        
        // Calculate mood preferences
        val moodScores = calculateMoodPreferences(allFeatures)
        
        // Calculate energy preference
        val energyPreference = calculateEnergyPreference(allFeatures)
        
        // Calculate tempo preference
        val tempoPreference = calculateTempoPreference(allFeatures)
        
        // Calculate valence (happiness) preference
        val valencePreference = calculateValencePreference(allFeatures)
        
        // Calculate exploration tendency
        val explorationTendency = calculateExplorationTendency(allTracks)
        
        // Calculate artist loyalty
        val artistLoyalty = calculateArtistLoyalty(allTracks, trackMap)
        
        // Calculate time-of-day preferences
        val timeOfDayPreferences = calculateTimeOfDayPreferences(allFeatures)
        
        return TasteProfile(
            genreScores = genreScores,
            moodScores = moodScores,
            energyPreference = energyPreference,
            tempoPreference = tempoPreference,
            valencePreference = valencePreference,
            explorationTendency = explorationTendency,
            artistLoyalty = artistLoyalty,
            timeOfDayPreferences = timeOfDayPreferences
        )
    }
    
    /**
     * Calculate score for how well a track matches the user's taste
     */
    fun scoreTrack(track: Track, profile: TasteProfile): Float {
        val features = analyzer.analyze(track)
        var score = 0f
        
        // Genre match (30% weight)
        val genreScore = profile.genreScores[features.genre] ?: 0f
        score += normalizeScore(genreScore) * 0.30f
        
        // Mood match (20% weight)
        val moodScore = profile.moodScores[features.mood] ?: 0f
        score += normalizeScore(moodScore) * 0.20f
        
        // Energy match (25% weight) - cosine similarity style
        val energyDiff = abs(features.energy - profile.energyPreference)
        score += (1f - energyDiff) * 0.25f
        
        // Valence match (15% weight)
        val valenceDiff = abs(features.valence - profile.valencePreference)
        score += (1f - valenceDiff) * 0.15f
        
        // Tempo match (10% weight)
        if (features.tempo == profile.tempoPreference) {
            score += 0.10f
        }
        
        return score.coerceIn(0f, 1f)
    }
    
    /**
     * Get current hour's preferred mood
     */
    fun getCurrentMoodPreference(profile: TasteProfile): SongAnalyzer.Mood {
        val currentHour = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
        return profile.timeOfDayPreferences[currentHour] ?: SongAnalyzer.Mood.HAPPY
    }
    
    /**
     * Get time-decayed weight for a track (recent plays weighted higher)
     */
    private fun getDecayedWeight(trackId: Long): Float {
        val lastPlayed = history.getTimeSinceLastPlay(trackId)
        val daysSince = lastPlayed / (24 * 60 * 60 * 1000f)
        return Math.pow(0.5, (daysSince / DECAY_HALF_LIFE_DAYS).toDouble()).toFloat()
    }
    
    private fun calculateGenrePreferences(
        allFeatures: Map<Long, SongAnalyzer.AudioFeatures>
    ): Map<SongAnalyzer.Genre, Float> {
        val scores = mutableMapOf<SongAnalyzer.Genre, Float>()
        
        // Initialize all genres
        SongAnalyzer.Genre.entries.forEach { scores[it] = 0f }
        
        // Accumulate weighted scores
        for ((trackId, plays) in history.getMostPlayed(100).map { it to (history.getTrackStats(it).plays) }) {
            val features = allFeatures[trackId] ?: continue
            val weight = plays * getDecayedWeight(trackId)
            scores[features.genre] = (scores[features.genre] ?: 0f) + weight
        }
        
        // Add like bonuses
        for (trackId in history.getLikedTrackIds()) {
            val features = allFeatures[trackId] ?: continue
            scores[features.genre] = (scores[features.genre] ?: 0f) + LIKE_WEIGHT
        }
        
        // Penalize skipped genres
        for (trackId in history.getHighSkipRateTracks()) {
            val features = allFeatures[trackId] ?: continue
            scores[features.genre] = (scores[features.genre] ?: 0f) + SKIP_PENALTY
        }
        
        return scores
    }
    
    private fun calculateMoodPreferences(
        allFeatures: Map<Long, SongAnalyzer.AudioFeatures>
    ): Map<SongAnalyzer.Mood, Float> {
        val scores = mutableMapOf<SongAnalyzer.Mood, Float>()
        
        SongAnalyzer.Mood.entries.forEach { scores[it] = 0f }
        
        for ((trackId, plays) in history.getMostPlayed(100).map { it to (history.getTrackStats(it).plays) }) {
            val features = allFeatures[trackId] ?: continue
            val weight = plays * getDecayedWeight(trackId)
            scores[features.mood] = (scores[features.mood] ?: 0f) + weight
        }
        
        for (trackId in history.getLikedTrackIds()) {
            val features = allFeatures[trackId] ?: continue
            scores[features.mood] = (scores[features.mood] ?: 0f) + LIKE_WEIGHT
        }
        
        return scores
    }
    
    private fun calculateEnergyPreference(
        allFeatures: Map<Long, SongAnalyzer.AudioFeatures>
    ): Float {
        return history.getPreferredEnergyLevel(allFeatures)
    }
    
    private fun calculateTempoPreference(
        allFeatures: Map<Long, SongAnalyzer.AudioFeatures>
    ): SongAnalyzer.Tempo {
        val tempoCounts = mutableMapOf<SongAnalyzer.Tempo, Float>()
        
        for ((trackId, plays) in history.getMostPlayed(50).map { it to (history.getTrackStats(it).plays) }) {
            val features = allFeatures[trackId] ?: continue
            tempoCounts[features.tempo] = (tempoCounts[features.tempo] ?: 0f) + plays
        }
        
        return tempoCounts.maxByOrNull { it.value }?.key ?: SongAnalyzer.Tempo.MEDIUM
    }
    
    private fun calculateValencePreference(
        allFeatures: Map<Long, SongAnalyzer.AudioFeatures>
    ): Float {
        var totalValence = 0f
        var totalWeight = 0f
        
        for ((trackId, plays) in history.getMostPlayed(50).map { it to (history.getTrackStats(it).plays) }) {
            val features = allFeatures[trackId] ?: continue
            totalValence += features.valence * plays
            totalWeight += plays
        }
        
        return if (totalWeight > 0) totalValence / totalWeight else 0.5f
    }
    
    private fun calculateExplorationTendency(allTracks: List<Track>): Float {
        val totalTracks = allTracks.size.toFloat()
        val uniquePlayed = history.getMostPlayed(1000).size.toFloat()
        
        if (totalTracks == 0f) return 0.5f
        
        // Higher ratio = more exploration
        val explorationRatio = uniquePlayed / totalTracks
        
        // Also factor in like diversity
        val likedCount = history.getLikedTrackIds().size.toFloat()
        
        return (explorationRatio * 0.7f + (likedCount / totalTracks.coerceAtLeast(1f)) * 0.3f)
            .coerceIn(0f, 1f)
    }
    
    private fun calculateArtistLoyalty(
        allTracks: List<Track>,
        trackMap: Map<Long, Track>
    ): Map<String, Float> {
        val artistPlays = mutableMapOf<String, Int>()
        val artistTrackCount = mutableMapOf<String, Int>()
        
        // Count tracks per artist
        for (track in allTracks) {
            artistTrackCount[track.artist] = (artistTrackCount[track.artist] ?: 0) + 1
        }
        
        // Count plays per artist
        for ((trackId, plays) in history.getMostPlayed(500).map { it to (history.getTrackStats(it).plays) }) {
            val track = trackMap[trackId] ?: continue
            artistPlays[track.artist] = (artistPlays[track.artist] ?: 0) + plays
        }
        
        // Calculate loyalty: high plays relative to number of tracks by artist
        return artistPlays.map { (artist, plays) ->
            val trackCount = artistTrackCount[artist] ?: 1
            val loyalty = (plays.toFloat() / trackCount).coerceIn(0f, 10f) / 10f
            artist to loyalty
        }.toMap()
    }
    
    private fun calculateTimeOfDayPreferences(
        allFeatures: Map<Long, SongAnalyzer.AudioFeatures>
    ): Map<Int, SongAnalyzer.Mood> {
        val preferences = mutableMapOf<Int, SongAnalyzer.Mood>()
        val timeWeights = history.getTimeOfDayWeights()
        
        // Map hours to typical mood preferences
        for (hour in 0..23) {
            preferences[hour] = when (hour) {
                in 5..8 -> SongAnalyzer.Mood.ENERGETIC    // Morning: wake up
                in 9..12 -> SongAnalyzer.Mood.FOCUSED    // Work morning
                in 13..17 -> SongAnalyzer.Mood.HAPPY     // Afternoon
                in 18..20 -> SongAnalyzer.Mood.CHILL     // Evening wind down
                in 21..23 -> SongAnalyzer.Mood.ROMANTIC   // Night
                else -> SongAnalyzer.Mood.CHILL           // Late night
            }
        }
        
        return preferences
    }
    
    private fun normalizeScore(score: Float): Float {
        return (score / 10f).coerceIn(0f, 1f)
    }
}
