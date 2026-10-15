package com.zarvismobile.domain.capability

import com.zarvismobile.domain.entity.CapabilityStatus
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** A capability's state on one platform. [note] says what a PARTIAL or UNSUPPORTED state depends on. */
data class FeatureState(val status: CapabilityStatus, val note: String?)

/** The real control a platform offers for a capability ("chat", "page", "settings", ...), with its button label. */
data class FeatureControl(val type: String, val label: String)

/** One product capability (Conversation, Web search, Memory, ...) as both apps list it. */
data class CatalogCapability(
    val id: String,
    val icon: String,
    val name: String,
    val short: String,
    val desc: String,
    /** The detail page that explains it, when one exists. */
    val detail: String?,
    val web: FeatureState,
    val webControl: FeatureControl?,
    val android: FeatureState,
)

data class CatalogGroup(val id: String, val title: String, val capabilityIds: List<String>)

/** A detail page's copy for one platform. [action] is the primary button's route ("chat", "voice", "developer", ...). */
data class PageCopy(
    val summary: String,
    val what: String,
    val why: String,
    val how: List<String>,
    val canDo: List<String>,
    val start: String,
    val permissions: String,
    val limits: List<String>,
    val examples: List<String>,
    val cta: String,
    val action: String,
    val prompt: String,
)

/** An on-device action of the Phone Agent. [capability] is its entry in shared/capability-registry.json, when it needs one. */
data class CatalogPhoneAction(
    val title: String,
    val description: String,
    val example: String,
    val requires: String,
    val android: FeatureState,
    val capability: CapabilityId?,
)

data class CatalogPage(
    val id: String,
    val category: String,
    val title: String,
    val icon: String,
    val capabilityIds: List<String>,
    /** Null when the page exists only in the Android app. */
    val web: PageCopy?,
    val android: PageCopy,
    val phoneActions: List<CatalogPhoneAction>,
)

/**
 * The one capability catalogue for the website and the Android app: `shared/feature-catalog.json`, packaged as a classpath
 * resource (see domain/build.gradle.kts). The website embeds the same file (web/feature-pages.js), and both sides test the
 * same rules, so a capability cannot be "Available now" on one and Partial on the other.
 */
class SharedFeatureCatalog(
    val groups: List<CatalogGroup>,
    val capabilities: List<CatalogCapability>,
    val pages: List<CatalogPage>,
) {
    fun capability(id: String): CatalogCapability = capabilities.first { it.id == id }

    fun page(id: String): CatalogPage? = pages.firstOrNull { it.id == id }

    /** The capabilities a page explains, in its order. */
    fun capabilitiesOf(page: CatalogPage): List<CatalogCapability> = page.capabilityIds.map(::capability)

    companion object {
        const val RESOURCE = "/feature-catalog.json"

        val default: SharedFeatureCatalog by lazy { loadDefault() }

        fun loadDefault(): SharedFeatureCatalog {
            val text = SharedFeatureCatalog::class.java.getResourceAsStream(RESOURCE)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
                ?: error("feature-catalog.json is missing from the classpath")
            return parse(text)
        }

        fun parse(json: String): SharedFeatureCatalog {
            val root = Json.parseToJsonElement(json).jsonObject
            val capabilities = root.getValue("capabilities").jsonArray.map { element ->
                val o = element.jsonObject
                val web = o.obj("web")
                CatalogCapability(
                    id = o.str("id"),
                    icon = o.str("icon"),
                    name = o.str("name"),
                    short = o.str("short"),
                    desc = o.str("desc"),
                    detail = o.optStr("detail"),
                    web = web.state(),
                    webControl = (web["action"] as? JsonObject)?.let { FeatureControl(it.str("type"), it.str("label")) },
                    android = o.obj("android").state(),
                )
            }
            val ids = capabilities.map { it.id }
            require(ids.size == ids.toSet().size) { "Duplicate capability ids in feature-catalog.json" }

            val groups = root.getValue("groups").jsonArray.map { element ->
                val o = element.jsonObject
                CatalogGroup(o.str("id"), o.str("title"), o.strings("capabilities"))
            }
            val grouped = groups.flatMap { it.capabilityIds }
            require(grouped.sorted() == ids.sorted()) { "Every capability must be in exactly one group" }

            val pages = root.getValue("pages").jsonArray.map { element ->
                val o = element.jsonObject
                CatalogPage(
                    id = o.str("id"),
                    category = o.str("category"),
                    title = o.str("title"),
                    icon = o.str("icon"),
                    capabilityIds = o.strings("capabilities"),
                    web = (o["web"] as? JsonObject)?.pageCopy(),
                    android = o.obj("android").pageCopy(),
                    phoneActions = (o["phoneActions"] as? JsonArray).orEmpty().map { action ->
                        val a = action.jsonObject
                        CatalogPhoneAction(
                            title = a.str("title"),
                            description = a.str("description"),
                            example = a.str("example"),
                            requires = a.str("requires"),
                            android = a.obj("android").state(),
                            capability = a.optStr("capability")?.let { wire ->
                                CapabilityId.fromWire(wire) ?: error("Phone action '${a.str("title")}' names unknown capability '$wire'")
                            },
                        )
                    },
                )
            }
            val pageIds = pages.map { it.id }.toSet()
            require(pageIds.size == pages.size) { "Duplicate page ids in feature-catalog.json" }
            for (page in pages) for (id in page.capabilityIds) require(id in ids) { "Page '${page.id}' names unknown capability '$id'" }
            for (capability in capabilities) capability.detail?.let { require(it in pageIds) { "'${capability.id}' links to missing page '$it'" } }
            return SharedFeatureCatalog(groups, capabilities, pages)
        }

        private fun JsonObject.str(key: String): String = getValue(key).jsonPrimitive.content
        private fun JsonObject.optStr(key: String): String? = this[key]?.jsonPrimitive?.content
        private fun JsonObject.obj(key: String): JsonObject = getValue(key).jsonObject
        private fun JsonObject.strings(key: String): List<String> = getValue(key).jsonArray.map { it.jsonPrimitive.content }
        private fun JsonObject.state(): FeatureState = FeatureState(CapabilityStatus.valueOf(str("status")), optStr("note"))
        private fun JsonObject.pageCopy(): PageCopy = PageCopy(
            summary = str("summary"),
            what = str("what"),
            why = str("why"),
            how = strings("how"),
            canDo = strings("canDo"),
            start = str("start"),
            permissions = str("permissions"),
            limits = strings("limits"),
            examples = strings("examples"),
            cta = str("cta"),
            action = str("action"),
            prompt = str("prompt"),
        )
    }
}
