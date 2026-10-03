package com.sonara.app.api

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import com.google.gson.Gson
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.sonara.app.model.Track
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.InputStream
import java.io.File
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

data class UsernameResult(
    val success: Boolean,
    val username: String? = null,
    val errorMessage: String? = null
)

class SonaraApiClient(context: Context? = null) {
    private val diskCache = context?.let { Cache(File(it.cacheDir, "sonara-http"), 20L * 1024L * 1024L) }
    private val client = OkHttpClient.Builder()
        .cache(diskCache)
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()

    private val gson = Gson()
    val firebaseApiKey = "AIzaSyD_u10Qb3lPqU8su03N0lV4MHZ7TeO0LGs"

    suspend fun firebaseSignInWithEmail(emailStr: String, passwordStr: String): UserAuthResult = withContext(Dispatchers.IO) {
        try {
            val url = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$firebaseApiKey"
            val jsonPayload = JsonObject().apply {
                addProperty("email", emailStr.trim())
                addProperty("password", passwordStr)
                addProperty("returnSecureToken", true)
            }
            val body = jsonPayload.toString().toRequestBody("application/json; charset=utf-8".toMediaType())
            val request = Request.Builder().url(url).post(body).build()
            val response = client.newCall(request).execute()
            val responseStr = response.body?.string() ?: ""
            val jsonObj = gson.fromJson(responseStr, JsonObject::class.java)

            if (response.isSuccessful && jsonObj.has("idToken")) {
                val token = jsonObj.get("idToken").asString
                val userEmail = jsonObj.get("email").asString
                UserAuthResult(success = true, token = token, email = userEmail, displayName = jsonObj.get("displayName")?.asString)
            } else {
                val errorMsg = if (jsonObj.has("error")) {
                    jsonObj.getAsJsonObject("error").get("message").asString
                } else "Sign in failed"
                UserAuthResult(success = false, errorMessage = formatAuthError(errorMsg))
            }
        } catch (e: Exception) {
            UserAuthResult(success = false, errorMessage = e.message ?: "Authentication error")
        }
    }

    suspend fun firebaseSignUpWithEmail(emailStr: String, passwordStr: String): UserAuthResult = withContext(Dispatchers.IO) {
        try {
            val url = "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=$firebaseApiKey"
            val jsonPayload = JsonObject().apply {
                addProperty("email", emailStr.trim())
                addProperty("password", passwordStr)
                addProperty("returnSecureToken", true)
            }
            val body = jsonPayload.toString().toRequestBody("application/json; charset=utf-8".toMediaType())
            val request = Request.Builder().url(url).post(body).build()
            val response = client.newCall(request).execute()
            val responseStr = response.body?.string() ?: ""
            val jsonObj = gson.fromJson(responseStr, JsonObject::class.java)

            if (response.isSuccessful && jsonObj.has("idToken")) {
                val token = jsonObj.get("idToken").asString
                val userEmail = jsonObj.get("email").asString
                UserAuthResult(success = true, token = token, email = userEmail)
            } else {
                val errorMsg = if (jsonObj.has("error")) {
                    jsonObj.getAsJsonObject("error").get("message").asString
                } else "Sign up failed"
                UserAuthResult(success = false, errorMessage = formatAuthError(errorMsg))
            }
        } catch (e: Exception) {
            UserAuthResult(success = false, errorMessage = e.message ?: "Registration error")
        }
    }

    suspend fun firebaseSignInWithGoogle(googleEmail: String, googleIdToken: String? = null): UserAuthResult = withContext(Dispatchers.IO) {
        try {
            if (!googleIdToken.isNullOrBlank()) {
                val url = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=$firebaseApiKey"
                val postBody = "id_token=$googleIdToken&providerId=google.com"
                val jsonPayload = JsonObject().apply {
                    addProperty("postBody", postBody)
                    addProperty("requestUri", "http://localhost")
                    addProperty("returnSecureToken", true)
                }
                val body = jsonPayload.toString().toRequestBody("application/json; charset=utf-8".toMediaType())
                val request = Request.Builder().url(url).post(body).build()
                val response = client.newCall(request).execute()
                val responseStr = response.body?.string() ?: ""
                val jsonObj = gson.fromJson(responseStr, JsonObject::class.java)

                if (response.isSuccessful && jsonObj.has("idToken")) {
                    val token = jsonObj.get("idToken").asString
                    val email = if (jsonObj.has("email")) jsonObj.get("email").asString else googleEmail
                    return@withContext UserAuthResult(success = true, token = token, email = email, displayName = jsonObj.get("displayName")?.asString)
                }
            }
            val result = firebaseSignInWithEmail(googleEmail, "GoogleAuthSecret2025!")
            if (result.success) {
                result
            } else {
                firebaseSignUpWithEmail(googleEmail, "GoogleAuthSecret2025!")
            }
        } catch (e: Exception) {
            UserAuthResult(success = false, errorMessage = e.message ?: "Google sign in error")
        }
    }

    private fun formatAuthError(code: String): String {
        return when {
            code.contains("EMAIL_NOT_FOUND") -> "No account found with this email."
            code.contains("INVALID_PASSWORD") -> "Incorrect password. Please try again."
            code.contains("EMAIL_EXISTS") -> "An account with this email already exists."
            code.contains("INVALID_EMAIL") -> "Please enter a valid email address."
            code.contains("WEAK_PASSWORD") -> "Password must be at least 6 characters."
            code.contains("TOO_MANY_ATTEMPTS") -> "Too many failed attempts. Try again later."
            else -> code.replace('_', ' ').lowercase().replaceFirstChar { it.uppercase() }
        }
    }

    fun buildEndpointUrl(apiBaseUrl: String, path: String): String {
        val trimmed = apiBaseUrl.trim().trimEnd('/')
        val endpoint = if (path.startsWith("/")) path else "/$path"
        return if (trimmed.endsWith("/api")) {
            trimmed + endpoint
        } else if (trimmed.endsWith("/api/health") || trimmed.contains("/api/")) {
            val baseWithoutPath = trimmed.substringBefore("/api") + "/api"
            baseWithoutPath + endpoint
        } else {
            "$trimmed/api$endpoint"
        }
    }

    suspend fun checkAdminStatus(apiBaseUrl: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val targetUrl = buildEndpointUrl(apiBaseUrl, "/admin/check")
            val request = Request.Builder().url(targetUrl).get().build()
            val response = client.newCall(request).execute()
            val bodyStr = response.body?.string() ?: ""
            val jsonObj = gson.fromJson(bodyStr, JsonObject::class.java)
            jsonObj?.get("hasAdmin")?.asBoolean ?: true
        } catch (e: Exception) {
            true
        }
    }

    suspend fun checkIsAdmin(apiBaseUrl: String, idToken: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val targetUrl = buildEndpointUrl(apiBaseUrl, "/admin/me")
            val request = Request.Builder()
                .url(targetUrl)
                .get()
                .addHeader("Authorization", "Bearer $idToken")
                .build()
            val response = client.newCall(request).execute()
            val bodyStr = response.body?.string() ?: ""
            val jsonObj = gson.fromJson(bodyStr, JsonObject::class.java)
            jsonObj?.get("isAdmin")?.asBoolean ?: false
        } catch (e: Exception) {
            false
        }
    }

    suspend fun claimAdminAccount(apiBaseUrl: String, idToken: String?, email: String): Boolean = withContext(Dispatchers.IO) {
        val targetUrl = buildEndpointUrl(apiBaseUrl, "/admin/claim")
        val jsonPayload = JsonObject()
        jsonPayload.addProperty("email", email)
        val body = jsonPayload.toString().toRequestBody("application/json; charset=utf-8".toMediaType())
        val reqBuilder = Request.Builder().url(targetUrl).post(body)
        if (!idToken.isNullOrBlank()) {
            reqBuilder.addHeader("Authorization", "Bearer $idToken")
        }
        val response = client.newCall(reqBuilder.build()).execute()
        response.isSuccessful
    }

    suspend fun fetchAdminStats(apiBaseUrl: String, idToken: String?): String? = withContext(Dispatchers.IO) {
        val targetUrl = buildEndpointUrl(apiBaseUrl, "/admin/stats")
        val reqBuilder = Request.Builder().url(targetUrl).get()
        if (!idToken.isNullOrBlank()) {
            reqBuilder.addHeader("Authorization", "Bearer $idToken")
        }
        val response = client.newCall(reqBuilder.build()).execute()
        if (response.isSuccessful) response.body?.string() else null
    }

    suspend fun fetchCatalog(apiBaseUrl: String): List<Track> = withContext(Dispatchers.IO) {
        val targetUrl = buildEndpointUrl(apiBaseUrl, "/catalog")
        val request = Request.Builder()
            .url(targetUrl)
            .get()
            .addHeader("Accept", "application/json")
            .cacheControl(CacheControl.Builder().maxAge(30, TimeUnit.SECONDS).maxStale(5, TimeUnit.MINUTES).build())
            .build()

        val response = client.newCall(request).execute()
        if (!response.isSuccessful) {
            throw Exception("Server answered ${response.code}")
        }

        val bodyString = response.body?.string() ?: ""
        val jsonElement = gson.fromJson(bodyString, JsonElement::class.java)
        
        val songArray = when {
            jsonElement.isJsonArray -> jsonElement.asJsonArray
            jsonElement.isJsonObject -> {
                val jsonObject = jsonElement.asJsonObject
                when {
                    jsonObject.has("songs") -> jsonObject.getAsJsonArray("songs")
                    jsonObject.has("tracks") -> jsonObject.getAsJsonArray("tracks")
                    jsonObject.has("data") -> jsonObject.getAsJsonArray("data")
                    jsonObject.has("catalog") -> jsonObject.getAsJsonArray("catalog")
                    else -> jsonObject.getAsJsonArray("items")
                }
            }
            else -> null
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
                val numericId = abs(rawId.hashCode()).toLong()

                tracks.add(
                    Track(
                        id = numericId,
                        title = titleStr,
                        artist = artistStr,
                        album = albumStr,
                        duration = durSec.toLong(),
                        contentUri = Uri.parse(url),
                        albumArtUri = if (cover != null && cover.trim().isNotEmpty()) Uri.parse(cover) else null,
                        folderName = if (albumStr.isNotBlank() && albumStr != "Singles") albumStr else "Sonara Cloud",
                        dateAdded = System.currentTimeMillis() - i * 1000L,
                        remoteId = rawId
                    )
                )
            }
        }
        tracks
    }

    suspend fun fetchUserLibrary(apiBaseUrl: String, idToken: String): String? = withContext(Dispatchers.IO) {
        val targetUrl = buildEndpointUrl(apiBaseUrl, "/me/library")
        val request = Request.Builder()
            .url(targetUrl)
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

    suspend fun fetchUserProfile(apiBaseUrl: String, idToken: String): String? = withContext(Dispatchers.IO) {
        val targetUrl = buildEndpointUrl(apiBaseUrl, "/me/profile")
        val request = Request.Builder().url(targetUrl).get().addHeader("Authorization", "Bearer $idToken").build()
        val response = client.newCall(request).execute()
        if (response.isSuccessful) response.body?.string() else null
    }

    suspend fun saveUsername(apiBaseUrl: String, idToken: String, username: String): UsernameResult = withContext(Dispatchers.IO) {
        try {
            val targetUrl = buildEndpointUrl(apiBaseUrl, "/me/profile")
            val payload = JsonObject().apply { addProperty("username", username.trim()) }
            val request = Request.Builder()
                .url(targetUrl)
                .put(payload.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
                .addHeader("Authorization", "Bearer $idToken")
                .addHeader("Content-Type", "application/json")
                .build()
            val response = client.newCall(request).execute()
            val body = gson.fromJson(response.body?.string() ?: "{}", JsonObject::class.java)
            if (response.isSuccessful && body.has("profile")) {
                UsernameResult(true, body.getAsJsonObject("profile").get("username")?.asString)
            } else {
                UsernameResult(false, errorMessage = body.get("message")?.asString ?: "Unable to save username.")
            }
        } catch (error: Exception) {
            UsernameResult(false, errorMessage = error.message ?: "Unable to save username.")
        }
    }

    suspend fun syncUserLibrary(apiBaseUrl: String, idToken: String, payloadJson: String): Boolean = withContext(Dispatchers.IO) {
        val targetUrl = buildEndpointUrl(apiBaseUrl, "/me/library")
        val body = payloadJson.toRequestBody("application/json; charset=utf-8".toMediaType())
        val request = Request.Builder()
            .url(targetUrl)
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
        val targetUrl = buildEndpointUrl(apiBaseUrl, "/uploads/bulk")
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
            .url(targetUrl)
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
                        albumArtUri = if (cover != null && cover.trim().isNotEmpty()) Uri.parse(cover) else null,
                        folderName = "Uploads",
                        dateAdded = System.currentTimeMillis(),
                        remoteId = rawId
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
