package com.zarvismobile.domain.entity

/** Raw arguments for one skill invocation, validated against [SkillDefinition.inputSchema]. */
data class SkillInput(val values: Map<String, Any?> = emptyMap())

/** Who/what is asking, threaded through to the handler for account-scoped side effects. */
data class SkillExecutionContext(
    val accountId: String,
    val taskId: String? = null,
    val locale: String = "en",
)

sealed interface SkillResult {
    /**
     * [summary] must be non-blank — the Tool pipeline's verification stage rejects a blank one.
     * [userActionRequired] is true when the skill truthfully only *handed off* to a system
     * screen/app (e.g. Bluetooth settings, the Clock app) and the user must finish there;
     * the structured result then reports USER_ACTION_REQUIRED instead of COMPLETED.
     * [evidence] holds only facts the platform actually returned (never assumptions).
     */
    data class Success(
        val output: Map<String, Any?>,
        val summary: String,
        val userActionRequired: Boolean = false,
        val evidence: Map<String, String> = emptyMap(),
    ) : SkillResult

    /**
     * [userMessage] is what gets shown/spoken to the user; [reason] is a stable error code for logs.
     * [userActionRequired] is true when nothing failed on ZARVIS's side but the user must do
     * something first (e.g. open the app to read); it reports USER_ACTION_REQUIRED, not FAILED.
     */
    data class Failure(val reason: String, val userMessage: String, val userActionRequired: Boolean = false) : SkillResult
}

fun interface SkillHandler {
    suspend fun execute(input: SkillInput, context: SkillExecutionContext): SkillResult
}

/** The result of preparing a call before confirmation: exactly what will happen, or why it can't. */
sealed interface PreparedAction {
    /** [description] is shown in the confirmation; [input] is the resolved input the handler receives. */
    data class Ready(val description: String, val input: SkillInput) : PreparedAction
    data class Failed(val failure: SkillResult.Failure) : PreparedAction
}

/**
 * Resolves a call before any confirmation (e.g. contact name → the exact number), so the user
 * confirms the precise action and the handler executes exactly what was confirmed.
 */
fun interface SkillPreparer {
    suspend fun prepare(input: SkillInput, context: SkillExecutionContext): PreparedAction
}

/**
 * The unit of capability. See MASTER_SPEC.md §6 and SKILLS.md for the authoring guide.
 * Adding a new skill never requires touching the Orchestrator or [com.zarvismobile.domain.tooling.ToolPipeline].
 */
data class SkillDefinition(
    val id: String,
    val name: String,
    val description: String,
    val category: SkillCategory,
    val capabilities: List<String> = emptyList(),
    val requiredPermissions: List<PermissionType> = emptyList(),
    val requiredEntitlement: EntitlementLevel = EntitlementLevel.FREE,
    val usageCost: UsageCost = UsageCost.FREE,
    val riskLevel: RiskLevel = RiskLevel.LOW,
    val actionClass: ActionClass = ActionClass.READ_ONLY,
    /** Phase 1 capability id (shared/capability-registry.json), when the skill uses one. */
    val capabilityId: String? = null,
    val requiresConfirmation: Boolean = riskLevel != RiskLevel.LOW,
    /** true = handled on-device (agents/skills on Android); false = executed via the backend. */
    val executesOnDevice: Boolean = false,
    val inputSchema: JsonSchema = JsonSchema(),
    /** Optional pre-confirmation resolution; see [SkillPreparer]. */
    val preparer: SkillPreparer? = null,
    val handler: SkillHandler,
) {
    init {
        require(id.matches(Regex("^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$"))) {
            "Skill id must be 'category.action' lowercase (e.g. 'web.search'), got: '$id'"
        }
    }
}
