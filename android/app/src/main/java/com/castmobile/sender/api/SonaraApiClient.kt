package com.sonara.app.api

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.sonara.app.model.Track
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.InputStream
import java.util.concurrent.TimeUnit
import kotlin.math.abs

data class RemoteSong(
    val id: String?,
    val title: String?,
    val artist: String?,
    val album: String?,
    val duration: Double?,
    val seconds: Double?,
    val audioUrl: String?,
    val streamUrl: String?,
    val url: String?,
    val cover: String?,
    val coverUrl: String?,
    val artwork: String?
)

data class UserAuthResult(
    val success: Boolean,
    val token: String? = null,
    val email: String? = null,
    val displayName: String? = null,
    val errorMessage: String? = null
)

class SonaraApiClient {
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()

    private val gson = Gson()

    suspend fun fetchCatalog(apiBaseUrl: String): List<Track> = withContext(Dispatchers.IO) {
        val cleanUrl = apiBaseUrl.trimEnd('/') + "/catalog"
        val request = Request.Builder()
            .url(cleanUrl)
            .get()
            .addHeader("Accept", "application/json")
            .build()

        val response = client.newCall(request).execute()
        if (!response.isSuccessful) {
            throw Exception("Server answered ${response.code}")
        }

        val bodyString = response.body?.string() ?: ""
        val jsonObject = gson.fromJson(bodyString, JsonObject::class.java)
        
        val songArray = when {
            jsonObject.has("songs") -> jsonObject.getAsJsonArray("songs")
            jsonObject.has("tracks") -> jsonObject.getAsJsonArray("tracks")
            jsonObject.has("data") -> jsonObject.getAsJsonArray("data")
            jsonObject.has("catalog") -> jsonObject.getAsJsonArray("catalog")
            else -> jsonObject.getAsJsonArray("items")
        }

        val tracks = mutableListOf<Track>()
        if (songArray != null) {
            for (i in 0 until songArray.size()) {
                val elem = songArray.get(i)
                val song = gson.fromJson(elem, RemoteSong::class.java)
                
                val url = song.audioUrl ?: song.streamUrl ?: song.url ?: continue
                val cover = song.cover ?: song.coverUrl ?: song.artwork
                val titleStr = song.title ?: "Untitled track"
                val artistStr = song.artist ?: "Unknown artist"
                val albumStr = song.album ?: "Singles"
                val durSec = (song.duration ?: song.seconds ?: 0.0) * 1000
                
                val rawId = song.id ?: "remote-$i"
                val numericId = abs(rawId.hashCode()) .toLong()

                tracks.add(
                    Track(
                        id = numericId,
                        title = titleStr,
                        artist = artistStr,
                        album = albumStr,
                        duration = durSec.toLong(),
                        contentUri = Uri.parse(url),
                        albumArtUri = if (!cover.isNull_or_blank()) Uri.parse(cover) else null,
                        folderName = if (albumStr.isNotBlank() && albumStr != "Singles") albumStr else "Sonara Cloud",
                        dateAdded = System.currentTimeMillis() - i * 1000L
                    )
                )
            }
        }
        tracks
    }

    private fun String?.isNull_or_blank(): Boolean {
        return this == null || this.trim().isEmpty()
    }

    suspend fun fetchUserLibrary(apiBaseUrl: String, idToken: String): String? = withContext(Dispatchers.IO) {
        val cleanUrl = apiBaseUrl.trimEnd('/') + "/me/library"
        val request = Request.Builder()
            .url(cleanUrl)
            .get()
            .addHeader("Authorization", "Bearer $idToken")
            .addHeader("Accept", "application/json")
            .build()

        val response = client.newCall(request).execute()
        if (response.isSuccessful) {
            response.body?.string()
        } else {
            null
        }
    }

    suspend fun syncUserLibrary(apiBaseUrl: String, idToken: String, payloadJson: String): Boolean = withContext(Dispatchers.IO) {
        val cleanUrl = apiBaseUrl.trimEnd('/') + "/me/library"
        val body = payloadJson.toRequestBody("application/json; charset=utf-8".toMediaType())
        val request = Request.Builder()
            .url(cleanUrl)
            .put(body)
            .addHeader("Authorization", "Bearer $idToken")
            .build()

        val response = client.newCall(request).execute()
        response.isSuccessful
    }

    suspend fun uploadAudioFiles(
        apiBaseUrl: String,
        idToken: String?,
        context: Context,
        fileUris: List<Uri>
    ): List<Track> = withContext(Dispatchers.IO) {
        val cleanUrl = apiBaseUrl.trimEnd('/') + "/uploads/bulk"
        val multipartBuilder = MultipartBody.Builder().setType(MultipartBody.FORM)

        for (uri in fileUris) {
            val fileName = getFileNameFromUri(context, uri) ?: "track_${System.currentTimeMillis()}.mp3"
            val inputStream: InputStream = context.contentResolver.openInputStream(uri) ?: continue
            val bytes = inputStream.readBytes()
            inputStream.close()

            val mediaType = "audio/*".toMediaType()
            val fileBody = bytes.toRequestBody(mediaType)
            multipartBuilder.addFormDataPart("files", fileName, fileBody)
        }

        val reqBuilder = Request.Builder()
            .url(cleanUrl)
            .post(multipartBuilder.build())

        if (!idToken.isNullOrBlank()) {
            reqBuilder.addHeader("Authorization", "Bearer $idToken")
        }

        val response = client.newCall(reqBuilder.build()).execute()
        if (!response.isSuccessful) {
            throw Exception("Upload failed with status ${response.code}")
        }

        val responseStr = response.body?.string() ?: ""
        val jsonObject = gson.fromJson(responseStr, JsonObject::class.java)
        val trackArray = jsonObject.getAsJsonArray("tracks")

        val uploadedTracks = mutableListOf<Track>()
        if (trackArray != null) {
            for (i in 0 until trackArray.size()) {
                val elem = trackArray.get(i)
                val song = gson.fromJson(elem, RemoteSong::class.java)
                val url = song.audioUrl ?: song.streamUrl ?: song.url ?: continue
                val cover = song.cover ?: song.coverUrl ?: song.artwork
                val rawId = song.id ?: "upload-$i"
                val numericId = abs(rawId.hashCode()).toLong()

                uploadedTracks.add(
                    Track(
                        id = numericId,
                        title = song.title ?: "Uploaded track",
                        artist = song.artist ?: "Unknown artist",
                        album = song.album ?: "Uploads",
                        duration = ((song.duration ?: song.seconds ?: 0.0) * 1000).toLong(),
                        contentUri = Uri.parse(url),
                        albumArtUri = if (!cover.isNull_or_blank()) Uri.parse(cover) else null,
                        folderName = "Uploads",
                        dateAdded = System.currentTimeMillis()
                    )
                )
            }
        }
        uploadedTracks
    }

    private fun getFileNameFromUri(context: Context, uri: Uri): String? {
        var name: String? = null
        if (uri.scheme == "content") {
            val cursor = context.contentResolver.query(uri, null, null, null, null)
            cursor?.use {
                if (it.moveToFirst()) {
                    val index = it.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (index >= 0) {
                        name = it.getString(index)
                    }
                }
            }
        }
        if (name == null) {
            name = uri.path?.substringAfterLast('/')
        }
        return name
    }
}
