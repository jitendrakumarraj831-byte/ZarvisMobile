package com.zarvismobile.core.tooling

import android.app.SearchManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.telephony.TelephonyManager
import com.zarvismobile.domain.skill.AppAliases
import com.zarvismobile.domain.skill.AppSearchPort
import com.zarvismobile.domain.skill.DraftResult
import com.zarvismobile.domain.skill.MessageChannel
import com.zarvismobile.domain.skill.MessageDraft
import com.zarvismobile.domain.skill.MessageDraftPort
import com.zarvismobile.domain.skill.PhoneNumbers
import com.zarvismobile.domain.skill.SearchShown
import com.zarvismobile.domain.skill.SearchTarget
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Starts [intent] if an app on this phone handles it, and names that app ([fallbackName] when Android shows its own chooser).
 * Null when nothing handles it. Needs the matching `<queries>` entry in app/AndroidManifest.xml on Android 11+.
 */
private fun Context.startNamed(intent: Intent, fallbackName: String): String? {
    val target = packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY) ?: return null
    val pkg = target.activityInfo?.packageName
    val name = if (pkg == null || pkg == "android") fallbackName else target.activityInfo.applicationInfo.loadLabel(packageManager).toString()
    return try {
        startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        name
    } catch (e: ActivityNotFoundException) {
        null
    } catch (e: SecurityException) {
        null
    }
}

private fun plainText(text: String): Intent = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)

/**
 * Real implementation of [MessageDraftPort] for `message.draft`: the message opens in the app the user named, addressed where that
 * app allows it, and waits there for the user to press Send. Nothing is ever sent from here: these are share and SENDTO intents,
 * which only fill in a draft. Needs no permission (the contact's number was resolved before, with Contacts access).
 */
class AndroidMessageDraftPort(private val context: Context) : MessageDraftPort {

    override suspend fun open(draft: MessageDraft): DraftResult = withContext(Dispatchers.Main) {
        when (draft.channel) {
            MessageChannel.WHATSAPP -> whatsApp(draft)
            MessageChannel.SMS -> sms(draft)
            MessageChannel.EMAIL -> email(draft)
            MessageChannel.OTHER_APP -> otherApp(draft)
            MessageChannel.ANY_APP -> context.startNamed(Intent.createChooser(plainText(draft.text), null), "the share menu")
                ?.let { DraftResult.Opened(it, addressed = false) }
                ?: DraftResult.Unavailable("No app on this phone can share a message, so I didn't open one.")
        }
    }

    private fun whatsApp(draft: MessageDraft): DraftResult {
        val pm = context.packageManager
        val pkg = WHATSAPP_PACKAGES.firstOrNull { pm.getLaunchIntentForPackage(it) != null }
            ?: return DraftResult.Unavailable("WhatsApp isn't installed on this phone, so I didn't open a message.")
        // The chat with that number, with the text typed in; WhatsApp needs the full international number.
        val number = draft.recipientAddress?.let { PhoneNumbers.international(it, countryIso()) }
        if (number != null) {
            val chat = Intent(Intent.ACTION_VIEW, Uri.parse("https://api.whatsapp.com/send?phone=$number&text=" + Uri.encode(draft.text))).setPackage(pkg)
            context.startNamed(chat, "WhatsApp")?.let { return DraftResult.Opened(it) }
        }
        return context.startNamed(plainText(draft.text).setPackage(pkg), "WhatsApp")?.let { DraftResult.Opened(it, addressed = false) }
            ?: DraftResult.Unavailable("WhatsApp didn't open, so I didn't open a message.")
    }

    private fun sms(draft: MessageDraft): DraftResult {
        val to = draft.recipientAddress?.filter { it.isDigit() || it == '+' }.orEmpty()
        val intent = Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(to))).putExtra("sms_body", draft.text)
        return context.startNamed(intent, "Messages")?.let { DraftResult.Opened(it, addressed = to.isNotEmpty()) }
            ?: DraftResult.Unavailable("There is no SMS app on this phone, so I didn't open a message.")
    }

    private fun email(draft: MessageDraft): DraftResult {
        val to = draft.recipientAddress?.trim()?.takeIf { EMAIL_ADDRESS.matches(it) }.orEmpty()
        val intent = Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:$to?body=" + Uri.encode(draft.text)))
            .putExtra(Intent.EXTRA_TEXT, draft.text)
            .apply { if (to.isNotEmpty()) putExtra(Intent.EXTRA_EMAIL, arrayOf(to)) }
        return context.startNamed(intent, "Email")?.let { DraftResult.Opened(it, addressed = to.isNotEmpty()) }
            ?: DraftResult.Unavailable("There is no email app on this phone, so I didn't open a message.")
    }

    /** "Telegram", "Instagram": the app among those that can share text whose name matches best. */
    private fun otherApp(draft: MessageDraft): DraftResult {
        val wanted = draft.appName.orEmpty()
        val pm = context.packageManager
        val targets = pm.queryIntentActivities(plainText(""), 0)
            .mapNotNull { it.activityInfo }
            .filter { it.packageName != context.packageName }
            .distinctBy { it.packageName }
        val labels = targets.map { it.applicationInfo.loadLabel(pm).toString() }
        val index = AppAliases.resolve(wanted).labels.firstNotNullOfOrNull { AppAliases.bestLabelMatch(it, labels) }
            ?: return DraftResult.Unavailable("I couldn't find \"$wanted\" among the apps that can send a message, so I didn't open one.")
        return context.startNamed(plainText(draft.text).setPackage(targets[index].packageName), labels[index])
            ?.let { DraftResult.Opened(it, addressed = false) }
            ?: DraftResult.Unavailable("${labels[index]} didn't open, so I didn't open a message.")
    }

    /** The phone's country, for numbers saved without a country code: the SIM's, else the network's, else the phone's language region. */
    private fun countryIso(): String? {
        val telephony = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
        return listOfNotNull(telephony?.simCountryIso, telephony?.networkCountryIso, Locale.getDefault().country)
            .firstOrNull { it.length == 2 }
    }

    private companion object {
        val WHATSAPP_PACKAGES = listOf("com.whatsapp", "com.whatsapp.w4b")
        val EMAIL_ADDRESS = Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")
    }
}

/**
 * Real implementation of [AppSearchPort] for `app.search`: YouTube, Maps, the Play Store or the browser opens at the results for
 * the query (each app's own search intent first, then its web address, which the app or a browser opens), and Maps at the
 * directions to a place, waiting for the user to press Start. Needs no permission.
 */
class AndroidAppSearchPort(private val context: Context) : AppSearchPort {

    override suspend fun search(target: SearchTarget, query: String): SearchShown = withContext(Dispatchers.Main) {
        val q = Uri.encode(query)
        val candidates = when (target) {
            SearchTarget.WEB -> listOf(
                Intent(Intent.ACTION_WEB_SEARCH).putExtra(SearchManager.QUERY, query),
                view("https://www.google.com/search?q=$q"),
            )
            SearchTarget.YOUTUBE -> listOf(
                Intent(Intent.ACTION_SEARCH).setPackage(YOUTUBE_PACKAGE).putExtra(SearchManager.QUERY, query),
                view("https://www.youtube.com/results?search_query=$q"),
            )
            SearchTarget.MAPS -> listOf(view("geo:0,0?q=$q"), view("https://www.google.com/maps/search/?api=1&query=$q"))
            SearchTarget.DIRECTIONS -> listOf(view("https://www.google.com/maps/dir/?api=1&destination=$q"))
            SearchTarget.PLAY_STORE -> listOf(view("market://search?q=$q"), view("https://play.google.com/store/search?q=$q"))
        }
        for (intent in candidates) {
            context.startNamed(intent, target.displayName)?.let { return@withContext SearchShown.Shown(it) }
        }
        SearchShown.Unavailable("Nothing on this phone can show ${target.displayName} results, so I didn't open anything.")
    }

    private fun view(uri: String) = Intent(Intent.ACTION_VIEW, Uri.parse(uri))

    private companion object {
        const val YOUTUBE_PACKAGE = "com.google.android.youtube"
    }
}
