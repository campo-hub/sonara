package com.sonara.app.dj

import com.sonara.app.model.Track

/**
 * QueueGenerator - Generates intelligent queues with diversity
 * 
 * Features:
 * - Diversity optimization (no artist/genre clustering)
 * - Session-aware queue building
 * - Real-time adaptation based on skips/likes
 * - Smooth energy progression
 * - Avoids recently played tracks
 */
class QueueGenerator(
    private val analyzer: SongAnalyzer,
    private val history: ListeningHistory,
    private val preferences: PreferenceEngine,
    private val planner: DJSessionPlanner
) {
    
    data class GeneratedQueue(
        val tracks: List<Track>,
        val energyCurve: List<Float>,
        val diversityScore: Float,  // 0-1, higher = more diverse
        val estimatedDurationMs: Long,
        val sessionType: DJSessionPlanner.SessionType
    )
    
    data class DiversityMetrics(
        val artistDiversity: Float,
        val genreDiversity: Float,
        val energyDiversity: Float,
        val overallScore: Float
    )
    
    /**
     * Generate a complete queue based on session plan
     */
    fun generateQueue(
        allTracks: List<Track>,
        sessionPlan: DJSessionPlanner.SessionPlan,
        currentTrackId: Long? = null,
        count: Int = 20
    ): GeneratedQueue {
        val allFeatures = analyzer.analyzeAll(allTracks)
        val profile = preferences.buildProfile(allTracks)
        val trackMap = allTracks.associateBy { it.id }
        
        // Get excluded tracks (recently played, disliked)
        val recentlyPlayed = history.getRecentlyPlayed(30).toSet()
        val disliked = history.getDislikedTrackIds()
        val excluded = recentlyPlayed + disliked
        
        // Filter candidates
        val candidates = allTracks.filter { it.id !in excluded && it.id != currentTrackId }
        
        // Build queue with diversity optimization
        val queue = mutableListOf<Track>()
        val usedArtists = mutableSetOf<String>()
        val usedGenres = mutableSetOf<SongAnalyzer.Genre>()
        var lastFeatures: SongAnalyzer.AudioFeatures? = null
        
        // Find starting track if current is specified
        if (currentTrackId != null) {
            trackMap[currentTrackId]?.let { currentTrack ->
                queue.add(currentTrack)
                lastFeatures = allFeatures[currentTrackId]
                usedArtists.add(currentTrack.artist)
                allFeatures[currentTrackId]?.genre?.let { usedGenres.add(it) }
            }
        }
        
        // Generate remaining tracks
        for (position in queue.size until count) {
            val targetEnergy = sessionPlan.energyCurve.getOrNull(position) ?: 0.5f
            
            val nextTrack = findNextBestTrack(
                candidates = candidates.filter { it !in queue },
                allFeatures = allFeatures,
                profile = profile,
                lastFeatures = lastFeatures,
                targetEnergy = targetEnergy,
                usedArtists = usedArtists,
                usedGenres = usedGenres,
                sessionPlan = sessionPlan,
                position = position
            ) ?: break
            
            queue.add(nextTrack)
            lastFeatures = allFeatures[nextTrack.id]
            usedArtists.add(nextTrack.artist)
            allFeatures[nextTrack.id]?.genre?.let { usedGenres.add(it) }
        }
        
        // Calculate metrics
        val diversity = calculateDiversity(queue, allFeatures)
        val energyCurve = queue.map { allFeatures[it.id]?.energy ?: 0.5f }
        val estimatedDuration = queue.sumOf { it.duration }
        
        return GeneratedQueue(
            tracks = queue,
            energyCurve = energyCurve,
            diversityScore = diversity.overallScore,
            estimatedDurationMs = estimatedDuration,
            sessionType = sessionPlan.type
        )
    }
    
    /**
     * Generate a smart "Up Next" recommendation
     */
    fun suggestNextTrack(
        currentTrack: Track,
        allTracks: List<Track>,
        profile: PreferenceEngine.TasteProfile,
        count: Int = 5
    ): List<Track> {
        val allFeatures = analyzer.analyzeAll(allTracks)
        val currentFeatures = allFeatures[currentTrack.id] ?: return emptyList()
        val recentlyPlayed = history.getRecentlyPlayed(20).toSet()
        val disliked = history.getDislikedTrackIds()
        
        return allTracks
            .filter { it.id != currentTrack.id && it.id !in recentlyPlayed && it.id !in disliked }
            .map { track ->
                val features = allFeatures[track.id]
                val transition = if (features != null) {
                    planner.calculateTransition(currentFeatures, features)
                } else null
                
                val preferenceScore = preferences.scoreTrack(track, profile)
                val transitionScore = transition?.smoothnessScore ?: 0.5f
                
                track to (preferenceScore * 0.6f + transitionScore * 0.4f)
            }
            .sortedByDescending { it.second }
            .take(count)
            .map { it.first }
    }
    
    /**
     * Adapt queue based on user feedback (skip/like)
     */
    fun adaptQueue(
        currentQueue: List<Track>,
        currentIndex: Int,
        wasSkipped: Boolean,
        allTracks: List<Track>,
        sessionPlan: DJSessionPlanner.SessionPlan
    ): List<Track> {
        if (currentIndex >= currentQueue.size) return currentQueue
        
        val track = currentQueue[currentIndex]
        val event = if (wasSkipped) ListeningHistory.EventType.SKIP else ListeningHistory.EventType.LIKE
        history.recordEvent(track, event)
        
        // If skipped, try to replace future tracks with better matches
        if (wasSkipped && currentIndex + 1 < currentQueue.size) {
            val profile = preferences.buildProfile(allTracks)
            val remaining = currentQueue.subList(currentIndex + 1, currentQueue.size)
            
            val betterRemaining = remaining.map { remainingTrack ->
                val score = preferences.scoreTrack(remainingTrack, profile)
                remainingTrack to score
            }.sortedByDescending { it.second }.map { it.first }
            
            return currentQueue.subList(0, currentIndex + 1) + betterRemaining
        }
        
        return currentQueue
    }
    
    private fun findNextBestTrack(
        candidates: List<Track>,
        allFeatures: Map<Long, SongAnalyzer.AudioFeatures>,
        profile: PreferenceEngine.TasteProfile,
        lastFeatures: SongAnalyzer.AudioFeatures?,
        targetEnergy: Float,
        usedArtists: Set<String>,
        usedGenres: Set<SongAnalyzer.Genre>,
        sessionPlan: DJSessionPlanner.SessionPlan,
        position: Int
    ): Track? {
        if (candidates.isEmpty()) return null
        
        return candidates.maxByOrNull { track ->
            val features = allFeatures[track.id] ?: return@maxByOrNull 0f
            
            var score = 0f
            
            // Energy match (35%)
            val energyDiff = kotlin.math.abs(features.energy - targetEnergy)
            score += (1f - energyDiff) * 0.35f
            
            // Preference match (25%)
            score += preferences.scoreTrack(track, profile) * 0.25f
            
            // Artist diversity (20%) - penalize if already used
            val artistPenalty = if (track.artist in usedArtists) 0.5f else 1f
            score *= artistPenalty * 0.2f + 0.8f  // Blend penalty
            
            // Genre diversity (15%) - prefer genres in plan
            val genreInPlan = sessionPlan.genreMix[features.genre] ?: 0f
            val genrePenalty = if (features.genre in usedGenres) 0.7f else 1f
            score += genreInPlan * genrePenalty * 0.15f
            
            // Transition smoothness (5%)
            if (lastFeatures != null) {
                val transition = planner.calculateTransition(lastFeatures, features)
                score += transition.smoothnessScore * 0.05f
            }
            
            score
        }
    }
    
    private fun calculateDiversity(
        queue: List<Track>,
        allFeatures: Map<Long, SongAnalyzer.AudioFeatures>
    ): DiversityMetrics {
        if (queue.isEmpty()) return DiversityMetrics(0f, 0f, 0f, 0f)
        
        // Artist diversity: ratio of unique artists
        val uniqueArtists = queue.map { it.artist }.distinct().size.toFloat()
        val artistDiversity = uniqueArtists / queue.size
        
        // Genre diversity: Shannon entropy normalized
        val genreCounts = queue
            .mapNotNull { allFeatures[it.id]?.genre }
            .groupingBy { it }
            .eachCount()
        val genreEntropy = genreCounts.values.sumOf { count ->
            val p = count.toFloat() / queue.size
            if (p > 0) -p * kotlin.math.ln(p.toDouble()) else 0.0
        }
        val maxEntropy = kotlin.math.ln(SongAnalyzer.Genre.entries.size.toDouble())
        val genreDiversity = (genreEntropy / maxEntropy).toFloat().coerceIn(0f, 1f)
        
        // Energy diversity: standard deviation of energies
        val energies = queue.mapNotNull { allFeatures[it.id]?.energy }
        val avgEnergy = energies.average().toFloat()
        val energyVariance = energies.sumOf { ((it - avgEnergy) * (it - avgEnergy)).toDouble() } / energies.size
        val energyDiversity = kotlin.math.sqrt(energyVariance).toFloat().coerceIn(0f, 0.5f) * 2f
        
        // Overall score
        val overall = (artistDiversity * 0.4f + genreDiversity * 0.4f + energyDiversity * 0.2f)
        
        return DiversityMetrics(
            artistDiversity = artistDiversity,
            genreDiversity = genreDiversity,
            energyDiversity = energyDiversity,
            overallScore = overall.coerceIn(0f, 1f)
        )
    }
}
