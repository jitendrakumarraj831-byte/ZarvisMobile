package com.zarvismobile.domain.policy

import com.zarvismobile.domain.entity.ActionClass
import com.zarvismobile.domain.entity.RiskLevel
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * One phone action ZARVIS may run, and the rules it runs under (shared/automation-policy.json, AUTOMATION_SECURITY_POLICY.md).
 *
 * [risk] and [actionClass] must be exactly what the skill declares. [confirm] is true when the policy requires the exact action to
 * be confirmed every time; it can only add to what the action's class and risk already require. [privateResult] actions show their
 * result on the phone only. [actsInOtherApps] actions read or act inside the app in front, so the app they reach is checked before
 * anything is asked or done. [brainHandoff] actions may be handed to the phone by the server's planner.
 */
data class AutomationRule(
    val skillId: String,
    val capabilityId: String?,
    val risk: RiskLevel,
    val actionClass: ActionClass,
    val confirm: Boolean,
    val privateResult: Boolean,
    val actsInOtherApps: Boolean,
    val brainHandoff: Boolean,
)

/** Something ZARVIS never does on the phone, as the user reads it in Settings. */
data class PolicyPromise(val en: String, val hi: String) {
    fun text(locale: String): String = if (locale.startsWith("hi")) hi else en
}

/**
 * ZARVIS's phone-automation security policy. Default deny: an on-device action that has no [rule] is not run
 * ([com.zarvismobile.domain.tooling.ToolPipeline] refuses it), so a new phone action cannot run until it is written into the policy.
 */
class AutomationPolicy(
    val version: Int,
    val confirmationClasses: Set<ActionClass>,
    val confirmationRisks: Set<RiskLevel>,
    val maxPhoneSteps: Int,
    val neverDoes: List<PolicyPromise>,
    val rules: List<AutomationRule>,
) {
    private val byId: Map<String, AutomationRule> = rules.associateBy { it.skillId }

    init {
        require(byId.size == rules.size) { "automation policy lists an action twice" }
    }

    fun rule(skillId: String): AutomationRule? = byId[skillId]

    /** True when [rule]'s action must be confirmed each time: its own flag, or what its class and risk require. */
    fun requiresConfirmation(rule: AutomationRule): Boolean =
        rule.confirm || rule.actionClass in confirmationClasses || rule.risk in confirmationRisks

    /** Actions whose result never leaves the phone. */
    val privateResultSkills: Set<String> = rules.filter { it.privateResult }.map { it.skillId }.toSet()

    companion object {
        const val RESOURCE = "/automation-policy.json"

        /** The policy packaged on the classpath (see domain/build.gradle.kts), read once. */
        val default: AutomationPolicy by lazy {
            val text = AutomationPolicy::class.java.getResourceAsStream(RESOURCE)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
                ?: error("automation-policy.json is missing from the classpath")
            parse(text)
        }

        fun parse(json: String): AutomationPolicy {
            val root = Json.parseToJsonElement(json).jsonObject
            val rules = root.getValue("rules").jsonObject
            return AutomationPolicy(
                version = root.getValue("version").jsonPrimitive.int,
                confirmationClasses = rules.strings("confirmationClasses").map { ActionClass.valueOf(it) }.toSet(),
                confirmationRisks = rules.strings("confirmationRisks").map { RiskLevel.valueOf(it) }.toSet(),
                maxPhoneSteps = rules.getValue("maxPhoneSteps").jsonPrimitive.int,
                neverDoes = root.getValue("neverDoes").jsonArray.map {
                    val o = it.jsonObject
                    PolicyPromise(en = o.str("en"), hi = o.str("hi"))
                },
                rules = root.getValue("actions").jsonArray.map {
                    val o = it.jsonObject
                    AutomationRule(
                        skillId = o.str("skillId"),
                        capabilityId = o["capabilityId"]?.takeUnless { v -> v is JsonNull }?.jsonPrimitive?.content,
                        risk = RiskLevel.valueOf(o.str("risk")),
                        actionClass = ActionClass.valueOf(o.str("actionClass")),
                        confirm = o.getValue("confirm").jsonPrimitive.boolean,
                        privateResult = o.getValue("privateResult").jsonPrimitive.boolean,
                        actsInOtherApps = o.getValue("actsInOtherApps").jsonPrimitive.boolean,
                        brainHandoff = o.getValue("brainHandoff").jsonPrimitive.boolean,
                    )
                },
            )
        }

        private fun JsonObject.str(key: String): String = getValue(key).jsonPrimitive.content
        private fun JsonObject.strings(key: String): List<String> = (getValue(key) as JsonArray).map { it.jsonPrimitive.content }
    }
}
