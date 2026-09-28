package com.sonara.app.media

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.PowerManager
import android.util.Log
import com.sonara.app.model.Track

class PlaybackManager(private val context: Context) {
    private var mediaPlayer: MediaPlayer? = null
    var onCompletion: (() -> Unit)? = null
    var onError: ((String) -> Unit)? = null

    fun play(track: Track) {
        try {
            mediaPlayer?.stop()
            mediaPlayer?.release()
            
            val scheme = track.contentUri.scheme?.lowercase() ?: ""
            val isNetworkStream = scheme == "http" || scheme == "https"
            
            mediaPlayer = MediaPlayer().apply {
                setWakeMode(context, PowerManager.PARTIAL_WAKE_LOCK)
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .build()
                )
                setDataSource(context, track.contentUri)
                
                setOnCompletionListener { onCompletion?.invoke() }
                setOnErrorListener { _, what, extra ->
                    Log.e("PlaybackManager", "MediaPlayer error: what=$what, extra=$extra")
                    onError?.invoke("Playback error ($what, $extra)")
                    true
                }

                if (isNetworkStream) {
                    setOnPreparedListener { mp ->
                        mp.start()
                    }
                    prepareAsync()
                } else {
                    prepare()
                    start()
                }
            }
        } catch (e: Exception) {
            Log.e("PlaybackManager", "Failed to play track: ${e.message}", e)
            onError?.invoke(e.message ?: "Failed to start playback")
        }
    }

    fun pause() {
        try {
            mediaPlayer?.pause()
        } catch (e: Exception) {
            Log.e("PlaybackManager", "Error pausing: ${e.message}")
        }
    }

    fun resume() {
        try {
            mediaPlayer?.start()
        } catch (e: Exception) {
            Log.e("PlaybackManager", "Error resuming: ${e.message}")
        }
    }

    fun stop() {
        try {
            mediaPlayer?.stop()
            mediaPlayer?.release()
        } catch (e: Exception) {
            Log.e("PlaybackManager", "Error stopping: ${e.message}")
        } finally {
            mediaPlayer = null
        }
    }

    val isPlaying: Boolean
        get() = try { mediaPlayer?.isPlaying ?: false } catch (e: Exception) { false }

    val currentPosition: Int
        get() = try { mediaPlayer?.currentPosition ?: 0 } catch (e: Exception) { 0 }

    val audioSessionId: Int
        get() = try { mediaPlayer?.audioSessionId ?: 0 } catch (e: Exception) { 0 }

    fun seekTo(position: Int) {
        try {
            mediaPlayer?.seekTo(position)
        } catch (e: Exception) {
            Log.e("PlaybackManager", "Error seeking: ${e.message}")
        }
    }
}
