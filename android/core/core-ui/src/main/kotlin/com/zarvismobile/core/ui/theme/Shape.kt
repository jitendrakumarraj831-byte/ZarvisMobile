package com.zarvismobile.core.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.dp

val ZarvisShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(24.dp),
    extraLarge = RoundedCornerShape(32.dp),
)

/**
 * The corners every surface uses, by what it is (Queen Night): 16dp for a card, 20dp for a feature card or a quick action, 24dp for a
 * dialog and the hero, 14dp for a note, a field or an inline message, 12dp for an icon tile, and pills for buttons and chips.
 */
object ZarvisCorners {
    val pill = RoundedCornerShape(50)
    val tile = RoundedCornerShape(12.dp)
    val note = RoundedCornerShape(14.dp)
    val field = RoundedCornerShape(14.dp)
    val card = RoundedCornerShape(16.dp)
    val featureCard = RoundedCornerShape(20.dp)
    val hero = RoundedCornerShape(24.dp)
    val dialog = RoundedCornerShape(24.dp)

    /** A message the user sent: rounded, with its tail at the bottom right. */
    val sentBubble = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp, bottomEnd = 6.dp, bottomStart = 20.dp)

    /** A reply from ZARVIS: rounded, with its tail at the top left under the ZARVIS label. */
    val replyBubble = RoundedCornerShape(topStart = 6.dp, topEnd = 20.dp, bottomEnd = 20.dp, bottomStart = 20.dp)
}
