package com.jarvismobile.core.ui.components

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * The Home/Conversation composer — text input with an inline mic toggle, per
 * MASTER_SPEC.md §11 "text input must also remain available" and the Home screen concept
 * in §22 (`[ 🎙 Speak ]` next to `[ Type your task ]`).
 */
@Composable
fun JarvisComposer(
    value: String,
    onValueChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onMicClick: () -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "Type your task",
    enabled: Boolean = true,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.fillMaxWidth(),
        enabled = enabled,
        placeholder = { Text(placeholder) },
        leadingIcon = {
            IconButton(onClick = onMicClick, enabled = enabled) {
                Icon(imageVector = Icons.Filled.Mic, contentDescription = "Speak")
            }
        },
        trailingIcon = {
            IconButton(onClick = onSubmit, enabled = enabled && value.isNotBlank()) {
                Icon(imageVector = Icons.Filled.Send, contentDescription = "Send")
            }
        },
        singleLine = true,
    )
}
