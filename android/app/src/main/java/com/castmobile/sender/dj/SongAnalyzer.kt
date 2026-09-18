package com.sonara.app.dj

import com.sonara.app.model.Track

/**
 * SongAnalyzer - Extracts audio features from local tracks
 * 
 * Since we can't use ML models on-device easily,
 * we use heuristics based on:
 * - Duration (shorter = pop, longer = ambient/classical)
 * - Title/artist keywords (genre detection)
 * - File size (proxy for bitrate/complexity)
 * - Play history patterns
 * 
 * In production, this could use Android's AudioRecord
 * to extract real BPM and energy via FFT analysis.
 */
object SongAnalyzer {

    /**
     * Analyzed audio features for a track
     */
    data class AudioFeatures(
        val trackId: Long,
        val energy: Float,        // 0.0 (calm) to 1.0 (energetic)
        val mood: Mood,
        val genre: Genre,
        val tempo: Tempo,
        val danceability: Float,  // 0.0 to 1.0
        val valence: Float,       // 0.0 (sad) to 1.0 (happy)
        val acousticness: Float   // 0.0 (electronic) to 1.0 (acoustic)
    )

    enum class Mood {
        ENERGETIC, HAPPY, CHILL, MELANCHOLY, DARK, ROMANTIC, FOCUSED, AGGRESSIVE
    }

    enum class Genre {
        HIP_HOP, AFROBEATS, POP, ROCK, RNB, ELECTRONIC, DANCE, JAZZ, CLASSICAL,
        COUNTRY, FOLK, REGGAE, LATIN, INDIE, ALTERNATIVE, GOSPEL, LO_FI,
        MELANCHOLY, UNKNOWN
    }

    enum class Tempo {
        VERY_SLOW,   // < 80 BPM
        SLOW,        // 80-100 BPM
        MEDIUM,      // 100-120 BPM
        FAST,        // 120-140 BPM
        VERY_FAST    // > 140 BPM
    }

    // Cache analyzed features
    private val featureCache = mutableMapOf<Long, AudioFeatures>()

    /**
     * Get or compute audio features for a track
     */
    fun analyze(track: Track): AudioFeatures {
        return featureCache.getOrPut(track.id) {
            computeFeatures(track)
        }
    }

    /**
     * Analyze multiple tracks
     */
    fun analyzeAll(tracks: List<Track>): Map<Long, AudioFeatures> {
        return tracks.associate { it.id to analyze(it) }
    }

    /**
     * Compute features using heuristics
     */
    private fun computeFeatures(track: Track): AudioFeatures {
        val durationSec = track.duration / 1000f
        val titleLower = track.title.lowercase()
        val artistLower = track.artist.lowercase()
        val combined = "$titleLower $artistLower"

        // Genre detection from keywords
        val genre = detectGenre(combined)
        
        // Energy estimation
        val energy = estimateEnergy(track, genre, durationSec)
        
        // Mood estimation
        val mood = estimateMood(energy, genre, titleLower)
        
        // Tempo estimation
        val tempo = estimateTempo(track, genre)
        
        // Danceability
        val danceability = estimateDanceability(genre, energy)
        
        // Valence (happiness)
        val valence = estimateValence(titleLower, mood, energy)
        
        // Acousticness
        val acousticness = estimateAcousticness(genre, artistLower)

        return AudioFeatures(
            trackId = track.id,
            energy = energy,
            mood = mood,
            genre = genre,
            tempo = tempo,
            danceability = danceability,
            valence = valence,
            acousticness = acousticness
        )
    }

    private fun detectGenre(text: String): Genre {
        return when {
            // Hip-Hop indicators
            text.containsAny("rap", "hip hop", "hip-hop", "trap", "drill",
                "lil ", "yeat", "playboi", "travis scott", "drake", "kendrick",
                "j cole", "future", "21 savage", "lil baby", "dababy") -> Genre.HIP_HOP

            // Afrobeats indicators
            text.containsAny("afro", "burna", "wizkid", "davido", "rema",
                "tems", "asake", "ayra star", "ckay", "fireboy",
                "omah lay", "bellstar") -> Genre.AFROBEATS

            // R&B indicators
            text.containsAny("r&b", "rnb", "r and b", "soul", "sza",
                "h.e.r.", "h.e.r", "giveon", "daniel caesar", "brent faiyaz",
                "summer walker", "the weeknd", "bryson tiller") -> Genre.RNB

            // Pop indicators
            text.containsAny("pop", "taylor swift", "dua lipa", "doja cat",
                "olivia rodrigo", "harry styles", "ed sheeran", "ariana",
                "billie eilish", "lizzo", "charli xcx", "sabrina carpenter") -> Genre.POP

            // Dance indicators
            text.containsAny("dance", "disco", "club", "party mix") -> Genre.DANCE

            // Electronic indicators
            text.containsAny("edm", "techno", "house", "dubstep", "trance",
                "progressive", "electro", "synth", "diplo", "calvin harris",
                "deadmau5", "tiesto", "marshmello", "slushii") -> Genre.ELECTRONIC

            // Rock indicators
            text.containsAny("rock", "metal", "punk", "alternative rock",
                "foo fighters", "arctic monkeys", "imagine dragons",
                "muse", "radiohead", "nirvana", "linkin park") -> Genre.ROCK

            // Jazz indicators
            text.containsAny("jazz", "swing", "bebop", "smooth jazz",
                "miles davis", "john coltrane", "ella fitzgerald",
                "nora jones", "kamasi washington") -> Genre.JAZZ

            // Classical indicators
            text.containsAny("classical", "orchestra", "symphony", "sonata",
                "mozart", "beethoven", "bach", "chopin", "debussy") -> Genre.CLASSICAL

            // Country indicators
            text.containsAny("country", "nashville", "bro country",
                "luke bryant", "morgan wallen", "carrie underwood") -> Genre.COUNTRY

            // Folk indicators
            text.containsAny("folk", "acoustic", "singer-songwriter", "bon iver", "iron & wine") -> Genre.FOLK

            // Reggae indicators
            text.containsAny("reggae", "dancehall", "bob marley",
                "shaggy", " Sean paul") -> Genre.REGGAE

            // Latin indicators
            text.containsAny("latin", "reggaeton", "bachata", "salsa",
                "bad bunny", "j balvin", "ozuna", "karol g", "daddy yankee") -> Genre.LATIN

            // Lo-fi indicators
            text.containsAny("lo-fi", "lofi", "lo fi", "chill beats",
                "study beats", "relaxing", "ambient", "meditation") -> Genre.LO_FI

            // Gospel indicators
            text.containsAny("gospel", "worship", "praise", "hymn",
                "christian", "church") -> Genre.GOSPEL

            else -> Genre.UNKNOWN
        }
    }

    private fun estimateEnergy(track: Track, genre: Genre, durationSec: Float): Float {
        var energy = 0.5f

        // Genre-based energy
        energy += when (genre) {
            Genre.ELECTRONIC, Genre.HIP_HOP -> 0.2f
            Genre.POP, Genre.LATIN, Genre.DANCE -> 0.15f
            Genre.ROCK, Genre.REGGAE -> 0.1f
            Genre.AFROBEATS, Genre.RNB -> 0.05f
            Genre.JAZZ, Genre.LO_FI -> -0.1f
            Genre.CLASSICAL, Genre.GOSPEL -> -0.15f
            else -> 0f
        }

        // Duration-based (shorter tracks often more energetic)
        energy += when {
            durationSec < 180 -> 0.1f      // < 3 min
            durationSec < 240 -> 0f         // 3-4 min
            durationSec < 300 -> -0.05f     // 4-5 min
            else -> -0.1f                   // > 5 min
        }

        return energy.coerceIn(0f, 1f)
    }

    private fun estimateMood(energy: Float, genre: Genre, title: String): Mood {
        // Check title for mood keywords
        if (title.containsAny("love", "heart", "baby", "sweet", "romantic")) {
            return Mood.ROMANTIC
        }
        if (title.containsAny("sad", "cry", "tears", "lonely", "broken", "hurt")) {
            return Mood.MELANCHOLY
        }
        if (title.containsAny("party", "dance", "turn up", "lit", "flex")) {
            return Mood.ENERGETIC
        }
        if (title.containsAny("chill", "relax", "vibe", "easy", "calm")) {
            return Mood.CHILL
        }
        if (title.containsAny("focus", "study", "concentrate", "deep")) {
            return Mood.FOCUSED
        }
        if (title.containsAny("angry", "rage", "hate", "fight")) {
            return Mood.AGGRESSIVE
        }
        if (title.containsAny("dark", "night", "midnight", "shadow")) {
            return Mood.DARK
        }

        // Genre + energy based mood
        return when {
            energy > 0.7f -> Mood.ENERGETIC
            energy > 0.5f && genre == Genre.POP -> Mood.HAPPY
            energy < 0.3f -> Mood.CHILL
            genre == Genre.MELANCHOLY -> Mood.MELANCHOLY
            else -> Mood.HAPPY
        }
    }

    private fun estimateTempo(track: Track, genre: Genre): Tempo {
        // Estimate based on genre and duration
        val estimatedBpm = when (genre) {
            Genre.ELECTRONIC -> 128
            Genre.HIP_HOP -> 85
            Genre.AFROBEATS -> 105
            Genre.POP -> 120
            Genre.ROCK -> 130
            Genre.JAZZ -> 110
            Genre.CLASSICAL -> 70
            Genre.LATIN -> 100
            Genre.REGGAE -> 80
            Genre.LO_FI -> 75
            else -> 110
        }

        return when {
            estimatedBpm < 80 -> Tempo.VERY_SLOW
            estimatedBpm < 100 -> Tempo.SLOW
            estimatedBpm < 120 -> Tempo.MEDIUM
            estimatedBpm < 140 -> Tempo.FAST
            else -> Tempo.VERY_FAST
        }
    }

    private fun estimateDanceability(genre: Genre, energy: Float): Float {
        val baseDanceability = when (genre) {
            Genre.ELECTRONIC, Genre.LATIN, Genre.DANCE -> 0.9f
            Genre.POP, Genre.AFROBEATS, Genre.HIP_HOP -> 0.8f
            Genre.RNB, Genre.REGGAE -> 0.7f
            Genre.ROCK, Genre.JAZZ -> 0.5f
            Genre.LO_FI, Genre.CLASSICAL -> 0.3f
            else -> 0.5f
        }
        return (baseDanceability + energy * 0.2f).coerceIn(0f, 1f)
    }

    private fun estimateValence(title: String, mood: Mood, energy: Float): Float {
        var valence = 0.5f

        // Mood影响
        valence += when (mood) {
            Mood.HAPPY, Mood.ENERGETIC -> 0.2f
            Mood.ROMANTIC -> 0.1f
            Mood.CHILL -> 0f
            Mood.FOCUSED -> -0.05f
            Mood.MELANCHOLY, Mood.DARK -> -0.2f
            Mood.AGGRESSIVE -> -0.1f
        }

        // Title keywords
        if (title.containsAny("happy", "joy", "smile", "laugh", "good", "love")) {
            valence += 0.15f
        }
        if (title.containsAny("sad", "cry", "tears", "lonely", "pain")) {
            valence -= 0.15f
        }

        return valence.coerceIn(0f, 1f)
    }

    private fun estimateAcousticness(genre: Genre, artist: String): Float {
        return when (genre) {
            Genre.CLASSICAL -> 0.9f
            Genre.JAZZ -> 0.8f
            Genre.FOLK, Genre.COUNTRY -> 0.7f
            Genre.GOSPEL -> 0.6f
            Genre.LO_FI -> 0.5f
            Genre.POP, Genre.RNB -> 0.4f
            Genre.HIP_HOP, Genre.ELECTRONIC -> 0.2f
            Genre.ROCK -> 0.3f
            else -> 0.4f
        }
    }

    /**
     * Calculate similarity between two tracks
     */
    fun similarity(a: AudioFeatures, b: AudioFeatures): Float {
        var score = 0f

        // Genre match (most important)
        if (a.genre == b.genre) score += 0.35f
        else if (a.genre.categoryOf() == b.genre.categoryOf()) score += 0.15f

        // Energy similarity
        score += (1f - kotlin.math.abs(a.energy - b.energy)) * 0.25f

        // Mood match
        if (a.mood == b.mood) score += 0.2f

        // Tempo match
        if (a.tempo == b.tempo) score += 0.1f

        // Danceability
        score += (1f - kotlin.math.abs(a.danceability - b.danceability)) * 0.1f

        return score.coerceIn(0f, 1f)
    }

    /**
     * Genre category for broader matching
     */
    private fun Genre.categoryOf(): String {
        return when (this) {
            Genre.HIP_HOP, Genre.RNB -> "urban"
            Genre.POP, Genre.ELECTRONIC, Genre.LATIN, Genre.DANCE -> "mainstream"
            Genre.ROCK, Genre.ALTERNATIVE, Genre.INDIE, Genre.FOLK -> "guitar"
            Genre.JAZZ, Genre.CLASSICAL, Genre.LO_FI, Genre.MELANCHOLY -> "chill"
            Genre.AFROBEATS, Genre.REGGAE -> "world"
            else -> "other"
        }
    }

    /**
     * Clear cache (call when library changes)
     */
    fun clearCache() {
        featureCache.clear()
    }

    private fun String.containsAny(vararg keywords: String): Boolean {
        return keywords.any { this.contains(it) }
    }
}
