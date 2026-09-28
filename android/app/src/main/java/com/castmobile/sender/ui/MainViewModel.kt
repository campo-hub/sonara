package com.sonara.app.ui

import android.app.Application
import android.app.RecoverableSecurityException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.SharedPreferences
import android.media.audiofx.Equalizer
import android.media.audiofx.Visualizer
import android.os.Build
import android.os.IBinder
import androidx.activity.result.IntentSenderRequest
import androidx.compose.runtime.*
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.sonara.app.api.SonaraApiClient
import com.sonara.app.dj.DJSessionPlanner
import com.sonara.app.dj.ListeningHistory
import com.sonara.app.dj.PreferenceEngine
import com.sonara.app.dj.QueueGenerator
import com.sonara.app.dj.SongAnalyzer
import com.sonara.app.media.MediaService
import com.sonara.app.model.Folder
import com.sonara.app.model.Track
import com.sonara.app.repository.MusicRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

enum class PlaybackRepeatMode { NONE, ALL, ONE }

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = MusicRepository(application)
    private var mediaService: MediaService? = null
    private var isBound = false
    private val prefs: SharedPreferences = application.getSharedPreferences("sonara_prefs", Context.MODE_PRIVATE)

    // DJ System Components
    private val listeningHistory = ListeningHistory(application)
    private val preferenceEngine = PreferenceEngine(listeningHistory, SongAnalyzer)
    private val sessionPlanner = DJSessionPlanner(SongAnalyzer, preferenceEngine)
    private val queueGenerator = QueueGenerator(SongAnalyzer, listeningHistory, preferenceEngine, sessionPlanner)

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            val binder = service as? MediaService.LocalBinder
            mediaService = binder?.getService()
            isBound = true
            
            mediaService?.onSkipNext = { playNext() }
            mediaService?.onSkipPrevious = { playPrevious() }
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            mediaService = null
            isBound = false
        }
    }

    private val _folders = mutableStateOf<List<Folder>>(emptyList())
    var folders: List<Folder> 
        get() = _folders.value
        private set(value) { _folders.value = value }

    private val _userPlaylists = mutableStateOf<List<Folder>>(emptyList())
    var userPlaylists: List<Folder>
        get() = _userPlaylists.value
        private set(value) { _userPlaylists.value = value }

    private val _artistFolders = mutableStateOf<List<Folder>>(emptyList())
    var artistFolders: List<Folder>
        get() = _artistFolders.value
        private set(value) { _artistFolders.value = value }

    private val _recentlyPlayedFolders = mutableStateOf<List<Folder>>(emptyList())
    var recentlyPlayedFolders: List<Folder>
        get() = _recentlyPlayedFolders.value
        private set(value) { _recentlyPlayedFolders.value = value }

    private val _recentlyPlayedTracks = mutableStateOf<List<Track>>(emptyList())
    var recentlyPlayedTracks: List<Track>
        get() = _recentlyPlayedTracks.value
        private set(value) { _recentlyPlayedTracks.value = value }

    private val _allTracks = mutableStateOf<List<Track>>(emptyList())
    var allTracks: List<Track>
        get() = _allTracks.value
        private set(value) { _allTracks.value = value }

    private val _currentFolder = mutableStateOf<Folder?>(null)
    var currentFolder: Folder?
        get() = _currentFolder.value
        set(value) { _currentFolder.value = value }

    private val _currentTrack = mutableStateOf<Track?>(null)
    var currentTrack: Track?
        get() = _currentTrack.value
        private set(value) { _currentTrack.value = value }

    private var playbackQueue = mutableListOf<Track>()
    private var djHistory = mutableListOf<Long>()

    var isPlaying by mutableStateOf(false)
        private set

    var showFullPlayer by mutableStateOf(false)
    var currentPosition by mutableLongStateOf(0L)
    var duration by mutableLongStateOf(0L)

    var selectedTab by mutableIntStateOf(0)
    var contextLabel by mutableStateOf("All Music")

    // Sorting State
    var sortType by mutableStateOf("Name") // "Name", "Date", "Size"
    var isSortAscending by mutableStateOf(true)

    val sortedTracks: List<Track>
        get() {
            val list = allTracks
            return when (sortType) {
                "Name" -> if (isSortAscending) list.sortedBy { it.title.lowercase() } else list.sortedByDescending { it.title.lowercase() }
                "Date" -> if (isSortAscending) list.sortedBy { it.dateAdded } else list.sortedByDescending { it.dateAdded }
                "Size" -> if (isSortAscending) list.sortedBy { it.size } else list.sortedByDescending { it.size }
                else -> list
            }
        }

    // Visualizer State
    var bassIntensity by mutableFloatStateOf(0f)
        private set
    var midIntensity by mutableFloatStateOf(0f)
        private set
    var trebleIntensity by mutableFloatStateOf(0f)
        private set
    var fftBands by mutableStateOf(FloatArray(64))
        private set
    private var visualizer: Visualizer? = null

    // Equalizer State
    var equalizer: Equalizer? = null
        private set
    var eqBands by mutableStateOf<List<Int>>(emptyList())
    
    // Use individual state for each band to prevent full map recomposition
    private val eqLevelValues = mutableStateListOf<Short>(0, 0, 0, 0, 0)
    val eqLevels: Map<Int, Short>
        get() = mapOf(0 to eqLevelValues[0], 1 to eqLevelValues[1], 2 to eqLevelValues[2], 3 to eqLevelValues[3], 4 to eqLevelValues[4])
    
    var currentPresetName by mutableStateOf("Manual")
    var isEqualizerEnabled by mutableStateOf(true)
    var preampLevel by mutableFloatStateOf(0f)

    val presets = mapOf(
        "Flat" to listOf<Short>(0, 0, 0, 0, 0),
        "Bass Boost" to listOf<Short>(600, 400, 0, 0, 0),
        "Treble Boost" to listOf<Short>(0, 0, 0, 400, 600),
        "Vocal Boost" to listOf<Short>(-200, -100, 500, 100, -100),
        "Rock" to listOf<Short>(400, 200, -100, 200, 400),
        "Pop" to listOf<Short>(-100, 200, 500, 200, -100),
        "Jazz" to listOf<Short>(300, 100, -200, 100, 300),
        "Classical" to listOf<Short>(400, 300, 0, 300, 400),
        "Dance" to listOf<Short>(500, 0, 200, 400, 600),
        "Hip Hop" to listOf<Short>(600, 300, 0, 200, 500),
        "Electronic" to listOf<Short>(500, 300, 0, 400, 500),
        "Acoustic" to listOf<Short>(300, 200, 100, 200, 300),
        "Loudness" to listOf<Short>(600, 400, 0, 400, 600),
        "Podcast" to listOf<Short>(-200, 300, 500, 300, -100),
        "Bass Reducer" to listOf<Short>(-400, -200, 0, 0, 0),
        "Treble Reducer" to listOf<Short>(0, 0, 0, -200, -400)
    )

    // Sleep Timer State
    var sleepTimerTimeLeft by mutableLongStateOf(0L)
    private var sleepTimerJob: Job? = null

    var showEqualizer by mutableStateOf(false)
    var showSleepTimer by mutableStateOf(false)

    // Kick Detection State
    private var prevBassMagnitude = 0f
    private var kickThreshold = 5f
    private val decayRate = 0.15f

    var isShuffle by mutableStateOf(false)
    var repeatMode by mutableStateOf(PlaybackRepeatMode.NONE)
    var favoriteTracks = mutableStateOf<Set<Long>>(emptySet())

    // DJ Mode State
    var isDjMode by mutableStateOf(false)
        private set
    private var djQueue = mutableListOf<Track>()
    var currentDjGenre by mutableStateOf("Your Mix")
        private set
    
    // Intelligent DJ State
    private var currentSessionPlan: DJSessionPlanner.SessionPlan? = null
    private var djPosition = 0
    var djSessionType by mutableStateOf(DJSessionPlanner.SessionType.CHILL)
        private set
    var djEnergyCurve by mutableStateOf<List<Float>>(emptyList())
        private set
    var userTasteProfile by mutableStateOf<PreferenceEngine.TasteProfile?>(null)
        private set
    
    // Theme Rotation State
    private var themeRotation = mutableListOf<DJSessionPlanner.SessionType>()
    private var currentThemeIndex = 0
    private var tracksInCurrentTheme = 0
    var currentThemeName by mutableStateOf("Your Mix")
        private set

    private val _pendingDeleteTrack = mutableStateOf<Track?>(null)
    var pendingDeleteTrack: Track?
        get() = _pendingDeleteTrack.value
        set(value) { _pendingDeleteTrack.value = value }

    var intentSenderRequest by mutableStateOf<IntentSenderRequest?>(null)

    // Selection State
    var isSelectionMode by mutableStateOf(false)
    var selectedTrackIds by mutableStateOf<Set<Long>>(emptySet())

    private val _targetPlaylistForAdding = mutableStateOf<Folder?>(null)
    var targetPlaylistForAdding: Folder?
        get() = _targetPlaylistForAdding.value
        set(value) { _targetPlaylistForAdding.value = value }

    private var lastPlayedTrackId: Long
        get() = prefs.getLong("last_played_track_id", -1L)
        set(value) = prefs.edit().putLong("last_played_track_id", value).apply()

    init {
        val intent = Intent(application, MediaService::class.java)
        application.bindService(intent, connection, Context.BIND_AUTO_CREATE)
        loadFavorites()
        loadUserPlaylists()
        startPositionUpdate()
        isEqualizerEnabled = prefs.getBoolean("eq_enabled", true)
        
        // Register observer for automatic scanning of new audio
        application.contentResolver.registerContentObserver(
            android.provider.MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
            true,
            object : android.database.ContentObserver(null) {
                override fun onChange(selfChange: Boolean) {
                    loadMusic()
                }
            }
        )
    }

    fun toggleEqualizer(enabled: Boolean) {
        isEqualizerEnabled = enabled
        equalizer?.enabled = enabled
        prefs.edit().putBoolean("eq_enabled", enabled).apply()
    }

    // Online / Offline Mode State
    private val apiClient = SonaraApiClient()

    var isOnlineMode by mutableStateOf(prefs.getBoolean("is_online_mode", false))
        private set

    var apiBaseUrl by mutableStateOf(prefs.getString("api_base_url", "https://sonara-xgmr.onrender.com/api") ?: "https://sonara-xgmr.onrender.com/api")
        private set

    var isOnlineLoading by mutableStateOf(false)
        private set

    var onlineError by mutableStateOf<String?>(null)
        private set

    var idToken by mutableStateOf(prefs.getString("id_token", null))
        private set

    var userEmail by mutableStateOf(prefs.getString("user_email", null))
        private set

    var hasAdmin by mutableStateOf(true)
        private set

    var isAdmin by mutableStateOf(false)
        private set

    var adminStatsJson by mutableStateOf<String?>(null)
        private set

    init {
        checkAdminStatus()
    }

    fun checkAdminStatus() {
        viewModelScope.launch {
            hasAdmin = apiClient.checkAdminStatus(apiBaseUrl)
        }
    }

    fun checkIsAdmin() {
        val token = idToken ?: return
        viewModelScope.launch {
            isAdmin = apiClient.checkIsAdmin(apiBaseUrl, token)
        }
    }

    fun claimAdminAccount(emailStr: String, onResult: (Boolean, String) -> Unit) {
        viewModelScope.launch {
            val success = apiClient.claimAdminAccount(apiBaseUrl, idToken, emailStr)
            if (success) {
                hasAdmin = true
                isAdmin = true
                onResult(true, "👑 Admin Account claimed successfully!")
                loadAdminStats()
            } else {
                onResult(false, "Admin account has already been claimed.")
            }
        }
    }

    fun loadAdminStats() {
        viewModelScope.launch {
            val stats = apiClient.fetchAdminStats(apiBaseUrl, idToken)
            if (stats != null) {
                adminStatsJson = stats
            }
        }
    }

    private val _remoteTracks = mutableStateOf<List<Track>>(emptyList())
    var remoteTracks: List<Track>
        get() = _remoteTracks.value
        private set(value) { _remoteTracks.value = value }

    fun toggleOnlineMode(online: Boolean) {
        isOnlineMode = online
        prefs.edit().putBoolean("is_online_mode", online).apply()
        loadMusic()
    }

    fun updateApiBaseUrl(url: String) {
        val clean = url.trim()
        val normalized = if (clean.isBlank()) "https://sonara-xgmr.onrender.com/api" else clean
        apiBaseUrl = normalized
        prefs.edit().putString("api_base_url", normalized).apply()
        if (isOnlineMode) {
            loadOnlineCatalog()
            checkAdminStatus()
        }
    }

    fun setUserAuth(email: String?, token: String?) {
        userEmail = email
        idToken = token
        prefs.edit()
            .putString("user_email", email)
            .putString("id_token", token)
            .apply()
        if (token != null && isOnlineMode) {
            fetchUserLibraryFromCloud()
            checkIsAdmin()
        } else {
            isAdmin = false
        }
    }

    fun firebaseSignIn(emailStr: String, passStr: String, isRegister: Boolean, onResult: (Boolean, String) -> Unit) {
        viewModelScope.launch {
            val result = if (isRegister) {
                apiClient.firebaseSignUpWithEmail(emailStr, passStr)
            } else {
                apiClient.firebaseSignInWithEmail(emailStr, passStr)
            }
            if (result.success && result.token != null && result.email != null) {
                setUserAuth(result.email, result.token)
                onResult(true, if (isRegister) "Account created!" else "Signed in!")
            } else {
                onResult(false, result.errorMessage ?: "Authentication failed")
            }
        }
    }

    fun firebaseGoogleSignIn(googleEmail: String, googleToken: String? = null, onResult: (Boolean, String) -> Unit) {
        viewModelScope.launch {
            val result = apiClient.firebaseSignInWithGoogle(googleEmail, googleToken)
            if (result.success && result.token != null && result.email != null) {
                setUserAuth(result.email, result.token)
                onResult(true, "Signed in with Google!")
            } else {
                onResult(false, result.errorMessage ?: "Google auth failed")
            }
        }
    }

    fun loadMusic() {
        if (isOnlineMode) {
            loadOnlineCatalog()
        } else {
            loadLocalMusic()
        }
    }

    fun loadOnlineCatalog() {
        viewModelScope.launch {
            isOnlineLoading = true
            onlineError = null
            try {
                val tracks: List<Track> = apiClient.fetchCatalog(apiBaseUrl)
                _remoteTracks.value = tracks
                allTracks = tracks

                // Group remote tracks into folders
                val groupedMap = tracks.groupBy { it.folderName }
                val groupedFolders = mutableListOf<Folder>()
                for (entry in groupedMap) {
                    groupedFolders.add(
                        Folder(
                            name = entry.key,
                            trackCount = entry.value.size,
                            tracks = entry.value,
                            coverArtUri = entry.value.firstOrNull { it.albumArtUri != null }?.albumArtUri
                        )
                    )
                }
                folders = groupedFolders.sortedBy { it.name }

                // Artist folders
                val artistMap = tracks.groupBy { track ->
                    track.artist.split(",", "&", ";", "/").first().trim()
                }
                val artistList = mutableListOf<Folder>()
                for (entry in artistMap) {
                    artistList.add(
                        Folder(
                            name = entry.key,
                            trackCount = entry.value.size,
                            tracks = entry.value,
                            coverArtUri = entry.value.firstOrNull { it.albumArtUri != null }?.albumArtUri
                        )
                    )
                }
                artistFolders = artistList.sortedBy { it.name }

                updateUserPlaylistsTracks()

                if (currentTrack == null && tracks.size > 0) {
                    val firstSong = tracks[0]
                    currentTrack = firstSong
                    duration = firstSong.duration
                }

                if (!idToken.isNullOrBlank()) {
                    fetchUserLibraryFromCloud()
                }
            } catch (e: Exception) {
                onlineError = e.message ?: "Unable to reach Sonara Render server"
            } finally {
                isOnlineLoading = false
            }
        }
    }

    fun fetchUserLibraryFromCloud() {
        val token = idToken ?: return
        if (!isOnlineMode) return
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val responseStr = apiClient.fetchUserLibrary(apiBaseUrl, token) ?: return@launch
                val json = JSONObject(responseStr)
                if (json.has("preferences")) {
                    val prefsObj = json.getJSONObject("preferences")
                    if (prefsObj.has("liked")) {
                        val likedArray = prefsObj.getJSONArray("liked")
                        val set = mutableSetOf<Long>()
                        for (i in 0 until likedArray.length()) {
                            set.add(likedArray.getLong(i))
                        }
                        withContext(Dispatchers.Main) {
                            favoriteTracks.value = set
                            prefs.edit().putStringSet("favorites", set.map { it.toString() }.toSet()).apply()
                            updateUserPlaylistsTracks()
                        }
                    }
                }
            } catch (e: Exception) {
                // Ignore background fetch failure
            }
        }
    }

    fun syncUserLibraryToCloud() {
        val token = idToken ?: return
        if (!isOnlineMode) return
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val favList = favoriteTracks.value.toList()
                val playlistMap = mutableMapOf<String, List<Long>>()
                for (p in userPlaylists) {
                    if (p.name != "Favorites") {
                        playlistMap[p.name] = p.tracks.map { it.id }
                    }
                }

                val json = JSONObject()
                val prefsObj = JSONObject()
                val likedArray = JSONArray()
                favList.forEach { likedArray.put(it) }
                prefsObj.put("liked", likedArray)
                json.put("preferences", prefsObj)

                val playlistsArray = JSONArray()
                for ((pName, pTracks) in playlistMap) {
                    val pObj = JSONObject()
                    pObj.put("name", pName)
                    val tArray = JSONArray()
                    pTracks.forEach { tArray.put(it) }
                    pObj.put("tracks", tArray)
                    playlistsArray.put(pObj)
                }
                json.put("playlists", playlistsArray)

                apiClient.syncUserLibrary(apiBaseUrl, token, json.toString())
            } catch (e: Exception) {
                // Ignore background sync failure
            }
        }
    }

    fun uploadFilesToOnlineServer(context: Context, fileUris: List<android.net.Uri>, onResult: (Boolean, String) -> Unit) {
        if (!isOnlineMode) return
        viewModelScope.launch {
            isOnlineLoading = true
            try {
                val uploaded: List<Track> = apiClient.uploadAudioFiles(apiBaseUrl, idToken, context, fileUris)
                _remoteTracks.value = uploaded + _remoteTracks.value
                allTracks = _remoteTracks.value
                loadOnlineCatalog()
                onResult(true, "${uploaded.size} tracks uploaded successfully.")
            } catch (e: Exception) {
                onResult(false, e.message ?: "Upload failed.")
            } finally {
                isOnlineLoading = false
            }
        }
    }

    private fun loadLocalMusic() {
        viewModelScope.launch(Dispatchers.IO) {
            val allFoldersList = repository.getAllFolders().filter { folder ->
                !folder.name.lowercase().contains("backup") && 
                !folder.name.lowercase().contains("cache") &&
                folder.tracks.isNotEmpty()
            }
            folders = allFoldersList
            allTracks = allFoldersList.flatMap { it.tracks }
            updateUserPlaylistsTracks()
            updateArtistFolders()
            
            if (currentTrack == null && lastPlayedTrackId != -1L) {
                val lastTrack = allTracks.find { it.id == lastPlayedTrackId }
                if (lastTrack != null) {
                    currentTrack = lastTrack
                    duration = lastTrack.duration
                }
            }
            
            recentlyPlayedFolders = (folders + userPlaylists).filter { it.lastPlayedTimestamp > 0 }.sortedByDescending { it.lastPlayedTimestamp }.take(6)
            
            val recentTrackIds = listeningHistory.getRecentlyPlayed(10)
            val all = allTracks
            recentlyPlayedTracks = recentTrackIds.mapNotNull { id: Long -> all.find { it.id == id } }
        }
    }

    private fun loadFavorites() {
        val favSet = prefs.getStringSet("favorites", emptySet()) ?: emptySet()
        favoriteTracks.value = favSet.mapNotNull { it.toLongOrNull() }.toSet()
    }

    private fun saveFavorites() {
        prefs.edit().putStringSet("favorites", favoriteTracks.value.map { it.toString() }.toSet()).apply()
        updateUserPlaylistsTracks()
        syncUserLibraryToCloud()
    }

    private fun loadUserPlaylists() {}

    private fun updateUserPlaylistsTracks() {
        val playlists = mutableListOf<Folder>()
        
        val favs = allTracks.filter { favoriteTracks.value.contains(it.id) }
        playlists.add(Folder(
            name = "Favorites",
            trackCount = favs.size,
            tracks = favs,
            coverArtUri = favs.firstOrNull()?.albumArtUri,
            lastPlayedTimestamp = prefs.getLong("last_played_Favorites", 0L)
        ))

        val playlistsJson = prefs.getString("playlists", "{}") ?: "{}"
        try {
            val json = JSONObject(playlistsJson)
            val keys = json.keys()
            while (keys.hasNext()) {
                val name = keys.next()
                if (name == "Favorites") continue
                
                val trackIdsArray = json.getJSONArray(name)
                val trackIds = mutableSetOf<Long>()
                for (i in 0 until trackIdsArray.length()) {
                    trackIds.add(trackIdsArray.getLong(i))
                }
                
                val tracksList = allTracks.filter { trackIds.contains(it.id) }
                playlists.add(Folder(
                    name = name,
                    trackCount = tracksList.size,
                    tracks = tracksList,
                    coverArtUri = tracksList.firstOrNull()?.albumArtUri,
                    lastPlayedTimestamp = prefs.getLong("last_played_$name", 0L)
                ))
            }
        } catch (e: Exception) {}

        userPlaylists = playlists
    }

    fun createPlaylist(name: String) {
        if (name.isBlank()) return
        val playlistsJson = prefs.getString("playlists", "{}") ?: "{}"
        try {
            val json = JSONObject(playlistsJson)
            if (!json.has(name)) {
                json.put(name, JSONArray())
                prefs.edit().putString("playlists", json.toString()).apply()
                updateUserPlaylistsTracks()
            }
        } catch (e: Exception) {}
    }

    fun addTrackToPlaylist(trackId: Long, playlistName: String) {
        val playlistsJson = prefs.getString("playlists", "{}") ?: "{}"
        try {
            val json = JSONObject(playlistsJson)
            val array = json.optJSONArray(playlistName) ?: JSONArray()
            var exists = false
            for (i in 0 until array.length()) {
                if (array.getLong(i) == trackId) {
                    exists = true
                    break
                }
            }
            if (!exists) {
                array.put(trackId)
                json.put(playlistName, array)
                prefs.edit().putString("playlists", json.toString()).apply()
                updateUserPlaylistsTracks()
            }
        } catch (e: Exception) {}
    }

    fun removeTrackFromPlaylist(trackId: Long, playlistName: String) {
        val playlistsJson = prefs.getString("playlists", "{}") ?: "{}"
        try {
            val json = JSONObject(playlistsJson)
            val array = json.optJSONArray(playlistName) ?: return
            val newArray = JSONArray()
            for (i in 0 until array.length()) {
                if (array.getLong(i) != trackId) {
                    newArray.put(array.get(i))
                }
            }
            json.put(playlistName, newArray)
            prefs.edit().putString("playlists", json.toString()).apply()
            updateUserPlaylistsTracks()
            
            if (currentFolder?.name == playlistName) {
                currentFolder = userPlaylists.find { it.name == playlistName }
            }
        } catch (e: Exception) {}
    }

    private fun updateArtistFolders() {
        val groupedByArtist = allTracks.groupBy { track ->
            track.artist.split(",", "&", ";", "/").first().trim()
        }
        artistFolders = groupedByArtist.map { entry ->
            val tracksList = entry.value
            Folder(
                name = entry.key,
                trackCount = tracksList.size,
                tracks = tracksList,
                coverArtUri = tracksList.firstOrNull()?.albumArtUri,
                lastPlayedTimestamp = prefs.getLong("last_played_${entry.key}", 0L)
            )
        }.sortedBy { it.name }
    }

    fun setSleepTimer(minutes: Int) {
        sleepTimerJob?.cancel()
        if (minutes <= 0) {
            sleepTimerTimeLeft = 0
            return
        }
        sleepTimerTimeLeft = minutes * 60 * 1000L
        sleepTimerJob = viewModelScope.launch {
            while (sleepTimerTimeLeft > 0) {
                delay(1000)
                sleepTimerTimeLeft -= 1000
            }
            if (isPlaying) togglePlayback()
        }
    }

    // Debounce timer for EQ updates
    private val eqUpdateJobs = arrayOfNulls<Job>(5)
    
    fun setEqLevel(band: Int, level: Short) {
        if (band in 0..4) {
            eqLevelValues[band] = level
        }
        
        // Manual override
        currentPresetName = "Manual"
        
        // Debounce the actual equalizer update per band
        eqUpdateJobs[band]?.cancel()
        eqUpdateJobs[band] = viewModelScope.launch {
            delay(50) // 50ms debounce
            if (isEqualizerEnabled && band in 0 until (equalizer?.numberOfBands?.toInt() ?: 5)) {
                try {
                    equalizer?.setBandLevel(band.toShort(), level)
                } catch (e: Exception) {
                    // Ignore equalizer errors
                }
            }
        }
    }

    fun setPreamp(level: Float) {
        preampLevel = level
        currentPresetName = "Manual"
    }

    fun applyPreset(name: String) {
        val presetLevels = presets[name] ?: return
        currentPresetName = name
        val bandsCount = equalizer?.numberOfBands?.toInt() ?: 5
        
        presetLevels.forEachIndexed { index, level ->
            if (index < bandsCount && index < 5) {
                eqLevelValues[index] = level
                if (isEqualizerEnabled) {
                    try {
                        equalizer?.setBandLevel(index.toShort(), level)
                    } catch (e: Exception) {
                        // Ignore equalizer errors
                    }
                }
            }
        }
    }

    fun playTrack(track: Track, fromTracks: List<Track>, djMode: Boolean = false) {
        // Record completion of previous track if playing
        if (isDjMode && currentTrack != null && currentTrack?.id != track.id) {
            val previousTrack = currentTrack!!
            val playDuration = currentPosition
            val completionRatio = if (previousTrack.duration > 0) {
                playDuration.toFloat() / previousTrack.duration
            } else 0f
            
            // Record as complete if listened to > 80%
            if (completionRatio > 0.8f) {
                listeningHistory.recordEvent(previousTrack, ListeningHistory.EventType.COMPLETE, playDuration)
            } else if (completionRatio < 0.3f) {
                listeningHistory.recordEvent(previousTrack, ListeningHistory.EventType.SKIP, playDuration)
            }
        }
        
        currentTrack = track
        lastPlayedTrackId = track.id
        mediaService?.playTrack(track)
        isPlaying = true
        isDjMode = djMode
        duration = track.duration
        updateFolderTimestamp(track.folderName)
        
        viewModelScope.launch {
            delay(600)
            setupVisualizer()
            setupEqualizer()
        }
        
        if (djMode) {
            djHistory.add(track.id)
            if (djHistory.size > 20) djHistory.removeAt(0)
        } else {
            playbackQueue.clear()
            playbackQueue.addAll(fromTracks)
            if (isShuffle) {
                playbackQueue.shuffle()
                val current = currentTrack
                if (current != null) {
                    playbackQueue.remove(current)
                    playbackQueue.add(0, current)
                }
            }
        }
    }

    fun startPlayback(tracks: List<Track>, startIndex: Int, label: String = "All Music", shuffleOverride: Boolean? = null) {
        if (tracks.isEmpty()) return
        val targetIndex = if (startIndex < 0) 0 else if (startIndex >= tracks.size) tracks.size - 1 else startIndex
        val firstTrack = tracks[targetIndex]
        
        val useShuffle = shuffleOverride ?: isShuffle
        isShuffle = useShuffle
        isDjMode = false
        contextLabel = label
        
        val queue = mutableListOf<Track>()
        if (useShuffle) {
            queue.add(firstTrack)
            val rest = mutableListOf<Track>()
            for (i in 0 until tracks.size) {
                if (i != targetIndex) rest.add(tracks[i])
            }
            rest.shuffle()
            queue.addAll(rest)
        } else {
            queue.addAll(tracks)
        }
        
        playbackQueue.clear()
        playbackQueue.addAll(queue)
        
        val playIndex = if (useShuffle) 0 else targetIndex
        playTrack(queue[playIndex], queue)
    }

    fun playFromList(tracks: List<Track>, index: Int, label: String = "All Music") {
        val target = if (index in 0 until tracks.size) tracks[index] else return
        if (currentTrack?.id == target.id) {
            togglePlayback()
            return
        }
        startPlayback(tracks, index, label)
    }

    fun getUpNextTracks(count: Int = 5): List<Pair<Track, Int>> {
        val result = mutableListOf<Pair<Track, Int>>()
        if (isDjMode) {
            val limit = if (count < djQueue.size) count else djQueue.size
            for (i in 0 until limit) {
                result.add(Pair(djQueue[i], i))
            }
            return result
        }
        val current = currentTrack ?: return emptyList()
        val currentIndex = playbackQueue.indexOfFirst { it.id == current.id }
        if (currentIndex == -1 || currentIndex >= playbackQueue.size - 1) return emptyList()
        val end = if (currentIndex + 1 + count < playbackQueue.size) currentIndex + 1 + count else playbackQueue.size
        for (i in (currentIndex + 1) until end) {
            result.add(Pair(playbackQueue[i], i))
        }
        return result
    }

    fun jumpToQueueIndex(index: Int) {
        if (isDjMode) {
            if (index in djQueue.indices) {
                val track = djQueue.removeAt(index)
                playTrack(track, emptyList(), djMode = true)
            }
            return
        }
        if (index in playbackQueue.indices) {
            val track = playbackQueue[index]
            playTrack(track, playbackQueue)
        }
    }

    private fun startPositionUpdate() {
        viewModelScope.launch {
            while (true) {
                mediaService?.let { service ->
                    isPlaying = service.isPlaying
                    currentPosition = service.currentPosition.toLong()
                }
                delay(1000)
            }
        }
    }

    fun togglePlayback() {
        val current = currentTrack
        if (mediaService?.isPlaying == false && current != null && currentPosition == 0L) {
            playTrack(current, allTracks)
        } else {
            mediaService?.togglePlayback()
        }
        isPlaying = mediaService?.isPlaying ?: false
    }

    fun playNext() {
        if (isDjMode) {
            playNextDjTrack()
            return
        }

        val queue = if (playbackQueue.isNotEmpty()) playbackQueue else sortedTracks
        if (queue.isEmpty()) return
        
        val current = currentTrack
        val currentIndex = queue.indexOfFirst { it.id == current?.id }
        
        if (currentIndex != -1 && currentIndex < queue.size - 1) {
            playTrack(queue[currentIndex + 1], queue)
        } else if (repeatMode == PlaybackRepeatMode.ALL) {
            playTrack(queue[0], queue)
        }
    }

    private fun playNextDjTrack() {
        // Check if we need to transition to next theme
        if (tracksInCurrentTheme >= DJSessionPlanner.TRACKS_PER_THEME) {
            transitionToNextTheme()
        }
        
        if (djQueue.isEmpty()) {
            // If intelligent queue is empty, generate more for current theme
            if (currentSessionPlan != null) {
                val generatedQueue = queueGenerator.generateQueue(
                    allTracks = allTracks,
                    sessionPlan = currentSessionPlan!!,
                    currentTrackId = currentTrack?.id,
                    count = DJSessionPlanner.TRACKS_PER_THEME
                )
                djQueue.clear()
                djQueue.addAll(generatedQueue.tracks)
            } else {
                generateDjCluster()
            }
        }
        
        if (djQueue.isNotEmpty()) {
            val nextTrack = djQueue.removeAt(0)
            djPosition++
            tracksInCurrentTheme++
            
            // Record play event
            listeningHistory.recordEvent(nextTrack, ListeningHistory.EventType.PLAY)
            
            playTrack(nextTrack, emptyList(), djMode = true)
        } else {
            isDjMode = false
            playNext()
        }
    }
    
    /**
     * Transition to the next theme in the rotation
     */
    private fun transitionToNextTheme() {
        currentThemeIndex++
        tracksInCurrentTheme = 0
        
        // Wrap around if we've gone through all themes
        if (currentThemeIndex >= themeRotation.size) {
            // Regenerate rotation for continued listening
            val newRotation = sessionPlanner.generateThemeRotation(
                startType = themeRotation.last(),
                profile = userTasteProfile!!,
                count = 5
            )
            themeRotation.clear()
            themeRotation.addAll(newRotation)
            currentThemeIndex = 0
        }
        
        // Create new session plan for the next theme
        currentThemeName = sessionPlanner.getThemeDisplayName(themeRotation[currentThemeIndex])
        djSessionType = themeRotation[currentThemeIndex]
        
        currentSessionPlan = sessionPlanner.createThemeSession(
            type = djSessionType,
            profile = userTasteProfile!!,
            trackFeatures = SongAnalyzer.analyzeAll(allTracks),
            themeIndex = currentThemeIndex,
            themeName = currentThemeName
        )
        
        // Store energy curve for UI
        djEnergyCurve = currentSessionPlan?.energyCurve ?: emptyList()
        
        // Generate new queue for the new theme
        val generatedQueue = queueGenerator.generateQueue(
            allTracks = allTracks,
            sessionPlan = currentSessionPlan!!,
            count = DJSessionPlanner.TRACKS_PER_THEME
        )
        
        djQueue.clear()
        djQueue.addAll(generatedQueue.tracks)
    }

    private fun generateDjCluster() {
        if (allTracks.isEmpty()) return
        val allClusters = folders + userPlaylists
        if (allClusters.isEmpty()) return
        
        // Fallback: Use intelligent queue generation if available
        if (userTasteProfile != null && currentSessionPlan != null) {
            val generatedQueue = queueGenerator.generateQueue(
                allTracks = allTracks,
                sessionPlan = currentSessionPlan!!,
                count = 10
            )
            djQueue.clear()
            djQueue.addAll(generatedQueue.tracks)
            currentDjGenre = currentSessionPlan?.type?.name ?: "Smart Mix"
            return
        }
        
        // Legacy fallback
        val randomCluster = allClusters.filter { it.tracks.isNotEmpty() }.randomOrNull() ?: return
        val clusterTracksList = randomCluster.tracks.filter { !djHistory.contains(it.id) }.shuffled()
        
        currentDjGenre = randomCluster.name
        djQueue.clear()
        if (clusterTracksList.isEmpty()) {
            djQueue.addAll(randomCluster.tracks.shuffled().take(7))
        } else {
            djQueue.addAll(clusterTracksList.take(7))
        }
    }

    fun skipDjGenre() {
        // This method is now equivalent to changeDJVibe()
        changeDJVibe()
    }

    fun playPrevious() {
        val queue = if (playbackQueue.isNotEmpty()) playbackQueue else sortedTracks
        if (queue.isEmpty()) return
        
        val current = currentTrack
        val currentIndex = queue.indexOfFirst { it.id == current?.id }
        
        if (currentIndex > 0) {
            playTrack(queue[currentIndex - 1], queue)
        } else if (repeatMode == PlaybackRepeatMode.ALL) {
            playTrack(queue.last(), queue)
        }
    }

    fun seekTo(position: Float) {
        mediaService?.seekTo(position.toInt())
        currentPosition = position.toLong()
    }

    fun toggleShuffle() { 
        isShuffle = !isShuffle
        val current = currentTrack
        if (isShuffle && current != null && playbackQueue.isNotEmpty()) {
            playbackQueue.shuffle()
            playbackQueue.remove(current)
            playbackQueue.add(0, current)
        } else if (!isShuffle) {
            val folder = currentFolder
            if (folder != null) {
                playbackQueue.clear()
                playbackQueue.addAll(folder.tracks)
            }
        }
    }

    fun toggleRepeat() {
        repeatMode = when (repeatMode) {
            PlaybackRepeatMode.NONE -> PlaybackRepeatMode.ALL
            PlaybackRepeatMode.ALL -> PlaybackRepeatMode.ONE
            PlaybackRepeatMode.ONE -> PlaybackRepeatMode.NONE
        }
    }
    fun toggleFavorite(trackId: Long) {
        val currentSet = favoriteTracks.value.toMutableSet()
        if (currentSet.contains(trackId)) currentSet.remove(trackId) else currentSet.add(trackId)
        favoriteTracks.value = currentSet
        saveFavorites()
    }

    fun toggleSelection(trackId: Long) {
        val currentSet = selectedTrackIds.toMutableSet()
        if (currentSet.contains(trackId)) currentSet.remove(trackId) else currentSet.add(trackId)
        selectedTrackIds = currentSet
        if (selectedTrackIds.isEmpty()) isSelectionMode = false
    }

    fun selectAll(tracks: List<Track>) {
        selectedTrackIds = tracks.map { it.id }.toSet()
        isSelectionMode = true
    }

    fun deselectAll() {
        selectedTrackIds = emptySet()
        isSelectionMode = false
    }

    fun deleteSelectedTracks() {
        viewModelScope.launch(Dispatchers.IO) {
            selectedTrackIds.forEach { id ->
                allTracks.find { it.id == id }?.let { track ->
                    try {
                        getApplication<Application>().contentResolver.delete(track.contentUri, null, null)
                    } catch (e: Exception) {}
                }
            }
            deselectAll()
            loadMusic()
        }
    }

    fun addSelectedTracksToPlaylist(playlistName: String) {
        val playlistsJson = prefs.getString("playlists", "{}") ?: "{}"
        try {
            val json = JSONObject(playlistsJson)
            val array = json.optJSONArray(playlistName) ?: JSONArray()
            selectedTrackIds.forEach { id ->
                var exists = false
                for (i in 0 until array.length()) {
                    if (array.getLong(i) == id) {
                        exists = true
                        break
                    }
                }
                if (!exists) array.put(id)
            }
            json.put(playlistName, array)
            prefs.edit().putString("playlists", json.toString()).apply()
            updateUserPlaylistsTracks()
            deselectAll()
            targetPlaylistForAdding = null
        } catch (e: Exception) {}
    }

    fun deleteTrack(track: Track) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                getApplication<Application>().contentResolver.delete(track.contentUri, null, null)
                loadMusic()
            } catch (e: SecurityException) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val recoverableSecurityException = e as? RecoverableSecurityException
                    recoverableSecurityException?.let {
                        pendingDeleteTrack = track
                        intentSenderRequest = IntentSenderRequest.Builder(it.userAction.actionIntent.intentSender).build()
                    }
                }
            }
        }
    }

    fun deleteFolder(folder: Folder) {
        val playlistsJson = prefs.getString("playlists", "{}") ?: "{}"
        try {
            val json = JSONObject(playlistsJson)
            if (json.has(folder.name)) {
                json.remove(folder.name)
                prefs.edit().putString("playlists", json.toString()).apply()
                updateUserPlaylistsTracks()
                return
            }
        } catch (e: Exception) {}

        viewModelScope.launch(Dispatchers.IO) {
            folder.tracks.forEach { track ->
                try {
                    getApplication<Application>().contentResolver.delete(track.contentUri, null, null)
                } catch (e: Exception) {}
            }
            loadMusic()
        }
    }

    fun onDeletionConfirmed() {
        pendingDeleteTrack = null
        intentSenderRequest = null
        loadMusic()
    }

    fun startDJ() {
        if (allTracks.isNotEmpty()) {
            isDjMode = true
            djQueue.clear()
            djHistory.clear()
            djPosition = 0
            tracksInCurrentTheme = 0
            
            // Build user taste profile
            userTasteProfile = preferenceEngine.buildProfile(allTracks)
            
            // Auto-detect optimal session type
            djSessionType = sessionPlanner.detectOptimalSessionType(userTasteProfile!!)
            
            // Generate theme rotation sequence
            themeRotation.clear()
            themeRotation.addAll(sessionPlanner.generateThemeRotation(
                startType = djSessionType,
                profile = userTasteProfile!!,
                count = 5
            ))
            currentThemeIndex = 0
            
            // Create first theme session plan
            currentThemeName = sessionPlanner.getThemeDisplayName(themeRotation[currentThemeIndex])
            currentSessionPlan = sessionPlanner.createThemeSession(
                type = themeRotation[currentThemeIndex],
                profile = userTasteProfile!!,
                trackFeatures = SongAnalyzer.analyzeAll(allTracks),
                themeIndex = currentThemeIndex,
                themeName = currentThemeName
            )
            
            // Store energy curve for UI
            djEnergyCurve = currentSessionPlan?.energyCurve ?: emptyList()
            
            // Generate intelligent queue for first theme
            val generatedQueue = queueGenerator.generateQueue(
                allTracks = allTracks,
                sessionPlan = currentSessionPlan!!,
                count = DJSessionPlanner.TRACKS_PER_THEME
            )
            
            djQueue.clear()
            djQueue.addAll(generatedQueue.tracks)
            
            playNextDjTrack()
            showFullPlayer = true
        }
    }

    /**
     * Start DJ with specific session type
     */
    fun startDJWithType(type: DJSessionPlanner.SessionType) {
        djSessionType = type
        startDJ()
    }

    /**
     * Skip to next track in DJ mode
     */
    fun skipDJTrack() {
        if (djQueue.isNotEmpty()) {
            // Record skip
            currentTrack?.let { track ->
                listeningHistory.recordEvent(track, ListeningHistory.EventType.SKIP)
            }
            playNextDjTrack()
        }
    }
    
    /**
     * Change the current vibe/theme while staying in DJ mode
     * Called when user presses the DJ button in Full Player
     */
    fun changeDJVibe() {
        if (!isDjMode || allTracks.isEmpty()) return
        
        // Skip to next theme
        transitionToNextTheme()
        
        // Play first track from the new theme
        if (djQueue.isNotEmpty()) {
            val nextTrack = djQueue.removeAt(0)
            tracksInCurrentTheme++
            
            listeningHistory.recordEvent(nextTrack, ListeningHistory.EventType.PLAY)
            playTrack(nextTrack, emptyList(), djMode = true)
        }
    }

    /**
     * Like current track and adapt queue
     */
    fun likeCurrentDJTrack() {
        currentTrack?.let { track ->
            listeningHistory.recordEvent(track, ListeningHistory.EventType.LIKE)
            favoriteTracks.value = favoriteTracks.value + track.id
            
            // Rebuild profile with new preference
            userTasteProfile = preferenceEngine.buildProfile(allTracks)
        }
    }

    /**
     * Get upcoming tracks preview
     */
    fun getDJUpcoming(count: Int = 5): List<Track> {
        return djQueue.take(count)
    }

    private fun updateFolderTimestamp(folderName: String) {
        val timestamp = System.currentTimeMillis()
        prefs.edit().putLong("last_played_$folderName", timestamp).apply()
        folders.find { it.name == folderName }?.let { it.lastPlayedTimestamp = timestamp }
        userPlaylists.find { it.name == folderName }?.let { it.lastPlayedTimestamp = timestamp }
        recentlyPlayedFolders = (folders + userPlaylists).filter { it.lastPlayedTimestamp > 0 }.sortedByDescending { it.lastPlayedTimestamp }.take(6)
    }

    private fun setupVisualizer() {
        try {
            val sessionId = mediaService?.audioSessionId ?: return
            if (sessionId == 0) return
            
            // Release old visualizer first
            visualizer?.release()
            
            visualizer = Visualizer(sessionId).apply {
                captureSize = Visualizer.getCaptureSizeRange()[1]
                setDataCaptureListener(object : Visualizer.OnDataCaptureListener {
                    override fun onWaveFormDataCapture(v: Visualizer?, waveform: ByteArray?, samplingRate: Int) {}
                    override fun onFftDataCapture(v: Visualizer?, fft: ByteArray?, samplingRate: Int) {
                        if (fft == null || !viewModelScope.isActive) return
                        
                        try {
                            var currentBassMagnitude = 0f
                            for (i in 1..4) {
                                val re = fft[2 * i].toInt()
                                val im = fft[2 * i + 1].toInt()
                                currentBassMagnitude += kotlin.math.sqrt((re * re + im * im).toDouble()).toFloat()
                            }
                            
                            val flux = (currentBassMagnitude - prevBassMagnitude).coerceAtLeast(0f)
                            prevBassMagnitude = currentBassMagnitude
                            
                            if (flux > kickThreshold) {
                                bassIntensity = 1.0f 
                                kickThreshold = flux * 0.8f
                            } else {
                                bassIntensity = (bassIntensity - decayRate).coerceAtLeast(0f)
                                kickThreshold = (kickThreshold * 0.95f).coerceAtLeast(5f)
                            }

                            var mid = 0f
                            var treble = 0f
                            
                            for (i in 5..30) {
                                val re = fft[2 * i].toInt()
                                val im = fft[2 * i + 1].toInt()
                                mid += kotlin.math.sqrt((re * re + im * im).toDouble()).toFloat()
                            }
                            
                            for (i in 31..100) {
                                val re = fft[2 * i].toInt()
                                val im = fft[2 * i + 1].toInt()
                                treble += kotlin.math.sqrt((re * re + im * im).toDouble()).toFloat()
                            }
                            
                            midIntensity = (mid / 25f).coerceIn(0f, 100f) / 100f
                            trebleIntensity = (treble / 70f).coerceIn(0f, 100f) / 100f

                            val newBands = FloatArray(64)
                            for (i in 0 until 64) {
                                val re = fft[2 * (i + 1)].toInt()
                                val im = fft[2 * (i + 1) + 1].toInt()
                                val magnitude = kotlin.math.sqrt((re * re + im * im).toDouble()).toFloat()
                                newBands[i] = (magnitude / 50f).coerceIn(0f, 1f)
                            }
                            fftBands = newBands
                        } catch (e: Exception) {
                            // Ignore FFT processing errors
                        }
                    }
                }, Visualizer.getMaxCaptureRate() / 2, false, true)
                enabled = true
            }
        } catch (e: Exception) {
            // Visualizer setup failed - continue without visualization
            visualizer = null
        }
    }

    private fun setupEqualizer() {
        try {
            val sessionId = mediaService?.audioSessionId ?: return
            if (sessionId == 0) return

            // Release old equalizer
            equalizer?.release()
            
            equalizer = Equalizer(0, sessionId).apply {
                enabled = isEqualizerEnabled
                val bands = mutableListOf<Int>()
                val bandsCount = numberOfBands.toInt().coerceAtMost(5)
                
                for (i in 0 until bandsCount) {
                    bands.add(getCenterFreq(i.toShort()) / 1000)
                    
                    // Re-apply existing level or initialize to 0
                    val existingLevel = if (i < eqLevelValues.size) eqLevelValues[i] else 0
                    setBandLevel(i.toShort(), existingLevel)
                }
                eqBands = bands
            }
            
            // Re-apply preset if one was active
            if (currentPresetName != "Manual" && isEqualizerEnabled) {
                applyPreset(currentPresetName)
            }
        } catch (e: Exception) {
            // Equalizer setup failed - continue without EQ
            equalizer = null
        }
    }

    override fun onCleared() {
        super.onCleared()
        
        // Cancel all pending jobs
        eqUpdateJobs.forEach { it?.cancel() }
        sleepTimerJob?.cancel()
        
        // Release audio resources
        try {
            visualizer?.release()
            equalizer?.release()
        } catch (e: Exception) {
            // Ignore cleanup errors
        }
        
        if (isBound) {
            try {
                getApplication<Application>().unbindService(connection)
            } catch (e: Exception) {
                // Ignore unbind errors
            }
            isBound = false
        }
    }
}
