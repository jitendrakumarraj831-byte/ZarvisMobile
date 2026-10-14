package com.zarvismobile.app.photo

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import com.zarvismobile.data.remote.ApiErrorBodies
import com.zarvismobile.data.remote.ZarvisApi
import com.zarvismobile.domain.skill.PhotoDescription
import com.zarvismobile.domain.skill.PhotoDescriberPort
import com.zarvismobile.domain.skill.PhotoDescriptionResults
import java.io.ByteArrayOutputStream
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * Sends the ONE photo the user just picked to the ZARVIS server (`POST /documents/extract`), where an
 * AI model that can see images describes it. The photo is shrunk to a JPEG first (long side at most
 * [MAX_SIDE_PX]) so it fits the server's 4 MB limit and uploads quickly on mobile data. Nothing is
 * written to disk, and the server does not keep the picture. What the server answers is turned into
 * words by the pure [PhotoDescriptionResults], which has its own unit tests.
 */
class ApiPhotoDescriber(
    private val context: Context,
    private val api: ZarvisApi,
) : PhotoDescriberPort {

    override suspend fun describe(uri: String, mimeType: String?): PhotoDescription = withContext(Dispatchers.IO) {
        val jpeg = try {
            shrinkToJpeg(Uri.parse(uri))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        } ?: return@withContext PhotoDescriptionResults.unreadableOnDevice()

        val part = MultipartBody.Part.createFormData("file", "photo.jpg", jpeg.toRequestBody("image/jpeg".toMediaType()))
        try {
            val response = api.extractDocument(part)
            val errorCode = if (response.isSuccessful) null else ApiErrorBodies.codeOf(response.errorBody()?.string())
            PhotoDescriptionResults.fromHttp(response.code(), errorCode, response.body()?.text)
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            PhotoDescriptionResults.networkFailure()
        } catch (e: Exception) {
            // An answer that is not the usual JSON (a proxy's page, a changed server) is reported, not allowed to crash the skill.
            PhotoDescriptionResults.unexpected()
        }
    }

    private fun shrinkToJpeg(uri: Uri): ByteArray? {
        val resolver = context.contentResolver

        // Pass 1: only the size, so a 48-megapixel photo is never decoded at full size.
        // (decodeStream returns null on purpose when only the bounds are asked for, so the stream is checked, not the result.)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        val boundsStream = resolver.openInputStream(uri) ?: return null
        boundsStream.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_SIDE_PX) sample *= 2
        val decoded = resolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: return null

        // The picker hands over the pixels as stored; the camera's rotation is in the EXIF tag.
        val rotation = resolver.openInputStream(uri)?.use { exifRotationDegrees(it) } ?: 0
        val scale = minOf(1f, MAX_SIDE_PX.toFloat() / maxOf(decoded.width, decoded.height))
        val matrix = Matrix().apply {
            if (scale < 1f) postScale(scale, scale)
            if (rotation != 0) postRotate(rotation.toFloat())
        }
        val upright = if (matrix.isIdentity) decoded else Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)

        for (quality in intArrayOf(85, 70, 55)) {
            val out = ByteArrayOutputStream()
            upright.compress(Bitmap.CompressFormat.JPEG, quality, out)
            if (out.size() <= MAX_UPLOAD_BYTES) return out.toByteArray()
        }
        return null
    }

    private fun exifRotationDegrees(stream: java.io.InputStream): Int =
        when (runCatching { ExifInterface(stream).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }.getOrNull()) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90
            ExifInterface.ORIENTATION_ROTATE_180 -> 180
            ExifInterface.ORIENTATION_ROTATE_270 -> 270
            else -> 0
        }

    private companion object {
        const val MAX_SIDE_PX = 1600

        /** Under the server's 4 MB request limit (backend/src/api/routes/documents.ts) with room for the form. */
        const val MAX_UPLOAD_BYTES = 3_500_000
    }
}
