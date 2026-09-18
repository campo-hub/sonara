package com.sonara.app.media

import android.content.Context
import android.media.MediaPlayer
import com.sonara.app.model.Track

class PlaybackManager(private val context: Context) {
    private var mediaPlayer: MediaPlayer? = null
    var onCompletion: (() -> Unit)? = null

    fun play(track: Track) {
        mediaPlayer?.stop()
        mediaPlayer?.release()
        
        mediaPlayer = MediaPlayer().apply {
            setDataSource(context, track.contentUri)
            prepare()
            start()
            setOnCompletionListener { onCompletion?.invoke() }
        }
    }

    fun pause() {
        mediaPlayer?.pause()
    }

    fun resume() {
        mediaPlayer?.start()
    }

    fun stop() {
        mediaPlayer?.stop()
        mediaPlayer?.release()
        mediaPlayer = null
    }

    val isPlaying: Boolean
        get() = mediaPlayer?.isPlaying ?: false

    val currentPosition: Int
        get() = mediaPlayer?.currentPosition ?: 0

    val audioSessionId: Int
        get() = mediaPlayer?.audioSessionId ?: 0

    fun seekTo(position: Int) {
        mediaPlayer?.seekTo(position)
    }
}
