package com.sonara.app.dj

import android.content.Context
import android.content.SharedPreferences
import com.sonara.app.model.Track
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.Calendar

/**
 * ListeningHistory - Tracks user behavior patterns
 * 
 * Stores:
 * - Play counts per track
 * - Skip patterns (when user skips)
 * - Likes/dislikes
 * - Time-of-day listening patterns
 * - Recent listening session history
 * 
 * Persists data using SharedPreferences
 */
class ListeningHistory(context: Context) {
    
    private val prefs: SharedPreferences = context.getSharedPreferences(
        "sonara_dj_history", Context.MODE_PRIVATE
    )
    
    // In-memory caches for fast access
    private val playCounts = mutableMapOf<Long, Int>()
    private val skipCounts = mutableMapOf<Long, Int>()
    private val likes = mutableSetOf<Long>()
    private val dislikes = mutableSetOf<Long>()
    private val lastPlayed = mutableMapOf<Long, Long>() // timestamp
    private val timeOfDayPlays = IntArray(24) // plays per hour (0-23)
    
    // Current session tracking
    private val currentSession = mutableListOf<TrackEvent>()
    
    private val _sessionEvents = MutableStateFlow<List<TrackEvent>>(emptyList())
    val sessionEvents: StateFlow<List<TrackEvent>> = _sessionEvents.asStateFlow()
    
    data class TrackEvent(
        val trackId: Long,
        val timestamp: Long,
        val event: EventType,
        val playDurationMs: Long = 0,
        val timeOfDay: Int = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
    )
    
    enum class EventType {
        PLAY,       // Started playing
        SKIP,       // Skipped within first 30 seconds
        COMPLETE,   // Listened to end
        PAUSE,      // Paused playback
        LIKE,       // User liked
        DISLIKE     // User disliked
    }
    
    data class TrackStats(
        val trackId: Long,
        val plays: Int = 0,
        val skips: Int = 0,
        val completions: Int = 0,
        val isLiked: Boolean = false,
        val isDisliked: Boolean = false,
        val lastPlayedTimestamp: Long = 0L,
        val avgListenRatio: Float = 0f, // avg % of song listened
        val preferredTimeOfDay: Int = -1 // hour when most played
    )
    
    init {
        loadFromPrefs()
    }
    
    /**
     * Record a track event
     */
    fun recordEvent(track: Track, event: EventType, playDurationMs: Long = 0) {
        val trackEvent = TrackEvent(
            trackId = track.id,
            timestamp = System.currentTimeMillis(),
            event = event,
            playDurationMs = playDurationMs
        )
        
        currentSession.add(trackEvent)
        _sessionEvents.value = currentSession.toList()
        
        // Update counters
        when (event) {
            EventType.PLAY -> {
                playCounts[track.id] = (playCounts[track.id] ?: 0) + 1
                lastPlayed[track.id] = System.currentTimeMillis()
                val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
                timeOfDayPlays[hour]++
            }
            EventType.SKIP -> {
                skipCounts[track.id] = (skipCounts[track.id] ?: 0) + 1
            }
            EventType.LIKE -> {
                likes.add(track.id)
                dislikes.remove(track.id)
            }
            EventType.DISLIKE -> {
                dislikes.add(track.id)
                likes.remove(track.id)
            }
            else -> {}
        }
        
        saveToPrefs()
    }
    
    /**
     * Get stats for a specific track
     */
    fun getTrackStats(trackId: Long): TrackStats {
        return TrackStats(
            trackId = trackId,
            plays = playCounts[trackId] ?: 0,
            skips = skipCounts[trackId] ?: 0,
            completions = 0, // Would need more tracking
            isLiked = trackId in likes,
            isDisliked = trackId in dislikes,
            lastPlayedTimestamp = lastPlayed[trackId] ?: 0L
        )
    }
    
    /**
     * Get all liked track IDs
     */
    fun getLikedTrackIds(): Set<Long> = likes.toSet()
    
    /**
     * Get disliked track IDs (to exclude from recommendations)
     */
    fun getDislikedTrackIds(): Set<Long> = dislikes.toSet()
    
    /**
     * Get recently played track IDs
     */
    fun getRecentlyPlayed(limit: Int = 20): List<Long> {
        return lastPlayed.entries
            .sortedByDescending { it.value }
            .take(limit)
            .map { it.key }
    }
    
    /**
     * Get most played track IDs
     */
    fun getMostPlayed(limit: Int = 20): List<Long> {
        return playCounts.entries
            .sortedByDescending { it.value }
            .take(limit)
            .map { it.key }
    }
    
    /**
     * Get tracks with high skip rate (might want to avoid)
     */
    fun getHighSkipRateTracks(threshold: Float = 0.5f): Set<Long> {
        val highSkips = mutableSetOf<Long>()
        for ((trackId, skips) in skipCounts) {
            val plays = playCounts[trackId] ?: 1
            if (skips.toFloat() / plays > threshold) {
                highSkips.add(trackId)
            }
        }
        return highSkips
    }
    
    /**
     * Get preferred listening time distribution
     * Returns normalized weights for each hour (0-23)
     */
    fun getTimeOfDayWeights(): FloatArray {
        val maxPlays = timeOfDayPlays.maxOrNull() ?: 1
        return timeOfDayPlays.map { it.toFloat() / maxPlays }.toFloatArray()
    }
    
    /**
     * Get the hour when user listens most
     */
    fun getPeakListeningHour(): Int {
        return timeOfDayPlays.indices.maxByOrNull { timeOfDayPlays[it] } ?: 12
    }
    
    /**
     * Calculate user's overall energy preference based on play history
     */
    fun getPreferredEnergyLevel(allTrackFeatures: Map<Long, SongAnalyzer.AudioFeatures>): Float {
        if (playCounts.isEmpty()) return 0.5f
        
        var totalEnergy = 0f
        var totalWeight = 0f
        
        for ((trackId, plays) in playCounts) {
            val features = allTrackFeatures[trackId] ?: continue
            totalEnergy += features.energy * plays
            totalWeight += plays
        }
        
        return if (totalWeight > 0) totalEnergy / totalWeight else 0.5f
    }
    
    /**
     * Get time since last play for a track (for cooldown)
     */
    fun getTimeSinceLastPlay(trackId: Long): Long {
        val last = lastPlayed[trackId] ?: return Long.MAX_VALUE
        return System.currentTimeMillis() - last
    }
    
    /**
     * Clear old history (older than specified days)
     */
    fun clearOldHistory(daysToKeep: Int = 30) {
        val cutoff = System.currentTimeMillis() - TimeUnit.DAYS.toMillis(daysToKeep.toLong())
        lastPlayed.entries.removeAll { it.value < cutoff }
        saveToPrefs()
    }
    
    /**
     * Export session history for analysis
     */
    fun exportSessionHistory(): List<TrackEvent> = currentSession.toList()
    
    private fun loadFromPrefs() {
        // Load play counts
        prefs.all.forEach { (key, value) ->
            when {
                key.startsWith("plays_") -> {
                    val trackId = key.removePrefix("plays_").toLongOrNull()
                    if (trackId != null && value is Int) {
                        playCounts[trackId] = value
                    }
                }
                key.startsWith("skips_") -> {
                    val trackId = key.removePrefix("skips_").toLongOrNull()
                    if (trackId != null && value is Int) {
                        skipCounts[trackId] = value
                    }
                }
                key.startsWith("last_") -> {
                    val trackId = key.removePrefix("last_").toLongOrNull()
                    if (trackId != null && value is Long) {
                        lastPlayed[trackId] = value
                    }
                }
                key.startsWith("liked_") -> {
                    val trackId = key.removePrefix("liked_").toLongOrNull()
                    if (trackId != null && value is Boolean && value) {
                        likes.add(trackId)
                    }
                }
                key.startsWith("disliked_") -> {
                    val trackId = key.removePrefix("disliked_").toLongOrNull()
                    if (trackId != null && value is Boolean && value) {
                        dislikes.add(trackId)
                    }
                }
                key.startsWith("hour_") -> {
                    val hour = key.removePrefix("hour_").toIntOrNull()
                    if (hour != null && value is Int) {
                        timeOfDayPlays[hour] = value
                    }
                }
            }
        }
    }
    
    private fun saveToPrefs() {
        val editor = prefs.edit()
        editor.clear()
        
        // Save play counts
        for ((trackId, count) in playCounts) {
            editor.putInt("plays_$trackId", count)
        }
        
        // Save skip counts
        for ((trackId, count) in skipCounts) {
            editor.putInt("skips_$trackId", count)
        }
        
        // Save last played
        for ((trackId, timestamp) in lastPlayed) {
            editor.putLong("last_$trackId", timestamp)
        }
        
        // Save likes
        for (trackId in likes) {
            editor.putBoolean("liked_$trackId", true)
        }
        
        // Save dislikes
        for (trackId in dislikes) {
            editor.putBoolean("disliked_$trackId", true)
        }
        
        // Save time of day
        for (hour in 0..23) {
            editor.putInt("hour_$hour", timeOfDayPlays[hour])
        }
        
        editor.apply()
    }
}
