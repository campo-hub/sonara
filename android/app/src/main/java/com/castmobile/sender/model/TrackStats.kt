package com.sonara.app.model

data class TrackStats(
    val trackId: Long,
    var playCount: Int = 0,
    var skipCount: Int = 0,
    var lastPlayedTimestamp: Long = 0L,
    var moodScore: Float = 0.5f, // 0.0 to 1.0 (chill to high energy)
    var favoriteBoost: Float = 1.0f
)
