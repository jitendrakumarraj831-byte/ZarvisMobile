package com.zarvismobile.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.ZarvisPrimaryButton
import com.zarvismobile.core.ui.components.ZarvisSecondaryButton
import com.zarvismobile.data.repository.SessionState

/**
 * Account continuity (blueprint §2): a guest account can be linked to an email so the same
 * account — conversations, tasks, credits — is used on the Web and other phones.
 */
@Composable
fun AccountSection(
    session: SessionState,
    form: AccountFormState,
    onLink: (String, String) -> Unit,
    onSignIn: (String, String) -> Unit,
    onSignOut: () -> Unit,
) {
    GlassSurface(Modifier.fillMaxWidth()) {
        when (session) {
            is SessionState.Active -> {
                Text(
                    if (session.isGuest) "Guest account on this phone" else "Signed in as ${session.email}",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    if (session.isGuest) {
                        "This account has no sign-in email yet, so it only exists on this phone. Link an email to use the same account on the web or another device."
                    } else {
                        "Use this email and password on the web or another phone to continue the same conversations and tasks."
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            is SessionState.Expired -> Text("Your session ended. Sign in to continue.", style = MaterialTheme.typography.titleMedium)
            SessionState.None -> Text("Not signed in", style = MaterialTheme.typography.titleMedium)
        }
    }
    form.info?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
    form.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

    if (session is SessionState.Active && session.isGuest) {
        CredentialsForm(
            title = "Link an email to this account",
            action = "Link email",
            busy = form.busy,
            onSubmit = onLink,
        )
    }
    CredentialsForm(
        title = if (session is SessionState.Active && session.isGuest) "Or sign in to a different account" else "Sign in with email",
        action = "Sign in",
        busy = form.busy,
        note = if (session is SessionState.Active && session.isGuest) "Signing in switches this phone to that account. This guest account's data is not merged." else null,
        onSubmit = onSignIn,
    )
    if (session is SessionState.Active) {
        ZarvisSecondaryButton("Sign out", onClick = onSignOut)
    }
}

@Composable
fun CredentialsForm(
    title: String,
    action: String,
    busy: Boolean,
    note: String? = null,
    initialEmail: String = "",
    onSubmit: (String, String) -> Unit,
) {
    var email by rememberSaveable(title) { mutableStateOf(initialEmail) }
    var password by rememberSaveable(title) { mutableStateOf("") }
    GlassSurface(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                label = { Text("Email") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Password (8+ characters)") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )
            ZarvisPrimaryButton(
                text = if (busy) "Please wait…" else action,
                enabled = !busy && email.contains('@') && password.length >= 8,
                onClick = { onSubmit(email, password) },
            )
        }
    }
}
