package com.castmobile.sender.model

import android.net.Uri

data class Track(
    val id: Long,
    val title: String,
    val artist: String,
    val album: String,
    val duration: Long,
    val contentUri: Uri,
    val albumArtUri: Uri? = null,
    val folderName: String = "Internal Storage",
    val dateAdded: Long = 0L,
    val size: Long = 0L
)

data class Folder(
    val name: String,
    val trackCount: Int,
    val tracks: List<Track>,
    val coverArtUri: Uri? = null,
    var lastPlayedTimestamp: Long = 0L
)
