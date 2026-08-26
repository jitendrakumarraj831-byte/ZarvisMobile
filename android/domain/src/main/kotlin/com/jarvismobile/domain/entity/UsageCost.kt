package com.jarvismobile.domain.entity

/** Credit cost charged on successful execution. See MASTER_SPEC.md §21. */
data class UsageCost(val value: Int, val unit: String = "credits") {
    init {
        require(value >= 0) { "UsageCost.value must not be negative, got $value" }
    }

    companion object {
        val FREE = UsageCost(0)
    }
}
