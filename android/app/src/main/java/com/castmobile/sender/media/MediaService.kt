package com.castmobile.sender.media

import android.content.BroadcastReceiver
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.media.session.MediaButtonReceiver
import com.castmobile.sender.model.Track
import com.castmobile.sender.ui.MainActivity
import java.io.InputStream

class MediaService : Service(), AudioManager.OnAudioFocusChangeListener {
    private var mediaSession: MediaSessionCompat? = null
    private lateinit var playbackManager: PlaybackManager
    private val binder = LocalBinder()
    private var currentTrack: Track? = null
    var onSkipNext: (() -> Unit)? = null
    var onSkipPrevious: (() -> Unit)? = null

    private lateinit var audioManager: AudioManager
    private var focusRequest: AudioFocusRequest? = null
    private var resumeOnFocusGain = false

    private val noisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY == intent?.action) {
                handlePause()
            }
        }
    }

    inner class LocalBinder : Binder() {
        fun getService(): MediaService = this@MediaService
    }

    override fun onCreate() {
        super.onCreate()
        playbackManager = PlaybackManager(this)
        audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager

        playbackManager.onCompletion = {
            onSkipNext?.invoke()
        }
        
        mediaSession = MediaSessionCompat(this, "SonaraMediaService").apply {
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() {
                    handlePlay()
                }

                override fun onPause() {
                    handlePause()
                }

                override fun onStop() {
                    stopPlayback()
                }

                override fun onSkipToNext() {
                    onSkipNext?.invoke()
                }

                override fun onSkipToPrevious() {
                    onSkipPrevious?.invoke()
                }
                
                override fun onSeekTo(pos: Long) {
                    playbackManager.seekTo(pos.toInt())
                    updatePlaybackState(if (playbackManager.isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED)
                }
            })
            isActive = true
        }
        
        createNotificationChannel()
        registerReceiver(noisyReceiver, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY))
    }

    private fun requestAudioFocus(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val playbackAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build()
            focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(playbackAttributes)
                .setAcceptsDelayedFocusGain(true)
                .setOnAudioFocusChangeListener(this)
                .build()
            audioManager.requestAudioFocus(focusRequest!!) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        } else {
            @Suppress("DEPRECATION")
            audioManager.requestAudioFocus(this, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        }
    }

    override fun onAudioFocusChange(focusChange: Int) {
        when (focusChange) {
            AudioManager.AUDIOFOCUS_GAIN -> {
                if (resumeOnFocusGain) {
                    resumePlayback()
                    resumeOnFocusGain = false
                }
            }
            AudioManager.AUDIOFOCUS_LOSS -> {
                pausePlayback()
                resumeOnFocusGain = false
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                if (playbackManager.isPlaying) {
                    pausePlayback()
                    resumeOnFocusGain = true
                }
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                // Could lower volume here, but user asked to pause
                if (playbackManager.isPlaying) {
                    pausePlayback()
                    resumeOnFocusGain = true
                }
            }
        }
    }

    private fun handlePlay() {
        if (requestAudioFocus()) {
            resumePlayback()
        }
    }

    private fun handlePause() {
        pausePlayback()
        resumeOnFocusGain = false
    }

    private fun resumePlayback() {
        playbackManager.resume()
        updatePlaybackState(PlaybackStateCompat.STATE_PLAYING)
        currentTrack?.let { showNotification(it) }
    }

    private fun pausePlayback() {
        playbackManager.pause()
        updatePlaybackState(PlaybackStateCompat.STATE_PAUSED)
        currentTrack?.let { showNotification(it) }
    }

    fun playTrack(track: Track) {
        if (requestAudioFocus()) {
            currentTrack = track
            playbackManager.play(track)
            updateMetadata(track)
            updatePlaybackState(PlaybackStateCompat.STATE_PLAYING)
            startForeground(1, createNotification(track))
            resumeOnFocusGain = false
        }
    }

    fun togglePlayback() {
        if (playbackManager.isPlaying) {
            handlePause()
        } else {
            handlePlay()
        }
    }

    fun stopPlayback() {
        playbackManager.stop()
        updatePlaybackState(PlaybackStateCompat.STATE_STOPPED)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && focusRequest != null) {
            audioManager.abandonAudioFocusRequest(focusRequest!!)
        } else {
            @Suppress("DEPRECATION")
            audioManager.abandonAudioFocus(this)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            stopForeground(true)
        }
        stopSelf()
    }

    val isPlaying: Boolean get() = playbackManager.isPlaying
    val currentPosition: Int get() = playbackManager.currentPosition
    val audioSessionId: Int get() = playbackManager.audioSessionId

    fun seekTo(position: Int) = playbackManager.seekTo(position)

    private fun updateMetadata(track: Track) {
        val metadataBuilder = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, track.title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, track.artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, track.album)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, track.duration)
        
        val art = getAlbumArt(track.albumArtUri)
        if (art != null) {
            metadataBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, art)
        }
        
        mediaSession?.setMetadata(metadataBuilder.build())
    }

    private fun updatePlaybackState(state: Int) {
        val playbackState = PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY or
                PlaybackStateCompat.ACTION_PAUSE or
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                PlaybackStateCompat.ACTION_STOP or
                PlaybackStateCompat.ACTION_SEEK_TO
            )
            .setState(state, playbackManager.currentPosition.toLong(), 1.0f)
            .build()
        mediaSession?.setPlaybackState(playbackState)
    }

    private fun showNotification(track: Track) {
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(1, createNotification(track))
    }

    private fun createNotification(track: Track): Notification {
        val sessionToken = mediaSession?.sessionToken ?: return Notification()
        
        val intent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE)

        val builder = NotificationCompat.Builder(this, "media_channel")
            .setContentTitle(track.title)
            .setContentText(track.artist)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setLargeIcon(getAlbumArt(track.albumArtUri))
            .setContentIntent(pendingIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(playbackManager.isPlaying)
            .setStyle(androidx.media.app.NotificationCompat.MediaStyle()
                .setMediaSession(sessionToken)
                .setShowActionsInCompactView(0, 1, 2)
            )
            .addAction(
                NotificationCompat.Action(
                    android.R.drawable.ic_media_previous, "Previous",
                    MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS)
                )
            )
            .addAction(
                NotificationCompat.Action(
                    if (playbackManager.isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                    if (playbackManager.isPlaying) "Pause" else "Play",
                    MediaButtonReceiver.buildMediaButtonPendingIntent(this, if (playbackManager.isPlaying) PlaybackStateCompat.ACTION_PAUSE else PlaybackStateCompat.ACTION_PLAY)
                )
            )
            .addAction(
                NotificationCompat.Action(
                    android.R.drawable.ic_media_next, "Next",
                    MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_SKIP_TO_NEXT)
                )
            )

        return builder.build()
    }

    private fun getAlbumArt(uri: Uri?): Bitmap? {
        if (uri == null) return null
        return try {
            val inputStream: InputStream? = contentResolver.openInputStream(uri)
            BitmapFactory.decodeStream(inputStream)
        } catch (e: Exception) {
            null
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel("media_channel", "Sonara Playback", NotificationManager.IMPORTANCE_LOW)
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        MediaButtonReceiver.handleIntent(mediaSession, intent)
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        unregisterReceiver(noisyReceiver)
        mediaSession?.release()
        playbackManager.stop()
    }
}
