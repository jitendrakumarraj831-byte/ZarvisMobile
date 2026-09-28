package com.zarvismobile.domain.capability

import com.zarvismobile.domain.entity.ActionClass
import com.zarvismobile.domain.entity.RiskLevel
import com.zarvismobile.domain.entity.SkillDefinition

/**
 * Blueprint §17 action policy — identical rule to the backend's `policyRequiresConfirmation`
 * (backend/src/capabilities/registry.ts). The policy can only *add* a confirmation
 * requirement on top of what a skill declares; it never removes one.
 */
object ActionPolicy {
    fun requiresConfirmation(actionClass: ActionClass, risk: RiskLevel): Boolean = when (actionClass) {
        ActionClass.EXTERNAL_COMMUNICATION,
        ActionClass.FINANCIAL,
        ActionClass.DESTRUCTIVE,
        ActionClass.SECURITY_SENSITIVE,
        -> true
        ActionClass.READ_ONLY, ActionClass.LOW_IMPACT -> risk == RiskLevel.HIGH || risk == RiskLevel.VERY_HIGH
    }

    fun requiresConfirmation(skill: SkillDefinition): Boolean =
        skill.requiresConfirmation || requiresConfirmation(skill.actionClass, skill.riskLevel)
}
