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
    /** [summary] must be non-blank — the Tool pipeline's verification stage rejects a blank one. */
    data class Success(val output: Map<String, Any?>, val summary: String) : SkillResult

    /** [userMessage] is what gets shown/spoken to the user; [reason] is a stable error code for logs. */
    data class Failure(val reason: String, val userMessage: String) : SkillResult
}

fun interface SkillHandler {
    suspend fun execute(input: SkillInput, context: SkillExecutionContext): SkillResult
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
    val requiresConfirmation: Boolean = riskLevel != RiskLevel.LOW,
    /** true = handled on-device (agents/skills on Android); false = executed via the backend. */
    val executesOnDevice: Boolean = false,
    val inputSchema: JsonSchema = JsonSchema(),
    val handler: SkillHandler,
) {
    init {
        require(id.matches(Regex("^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$"))) {
            "Skill id must be 'category.action' lowercase (e.g. 'web.search'), got: '$id'"
        }
    }
}
