package com.zarvismobile.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import com.zarvismobile.core.ui.components.GlassSurface
import com.zarvismobile.core.ui.components.QueenIconTile
import com.zarvismobile.core.ui.components.QueenInlineError
import com.zarvismobile.core.ui.components.QueenNote
import com.zarvismobile.core.ui.components.ZarvisPrimaryButton
import com.zarvismobile.core.ui.components.ZarvisSecondaryButton
import com.zarvismobile.core.ui.components.ZarvisTextField
import com.zarvismobile.core.ui.i18n.tr
import com.zarvismobile.core.ui.icons.ZarvisIcons
import com.zarvismobile.core.ui.theme.ZarvisAccents
import com.zarvismobile.core.ui.theme.ZarvisProStyles
import com.zarvismobile.core.ui.theme.ZarvisSpacing
import com.zarvismobile.data.repository.SessionState
import com.zarvismobile.domain.presentation.UiString

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
        Row(horizontalArrangement = Arrangement.spacedBy(ZarvisSpacing.gap), verticalAlignment = Alignment.Top) {
            val guest = session is SessionState.Active && session.isGuest
            QueenIconTile(icon = ZarvisIcons.User, tint = if (session is SessionState.Active) ZarvisAccents.primary else ZarvisAccents.warning)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.xs)) {
                when (session) {
                    is SessionState.Active -> {
                        Text(
                            if (guest) "Guest account on this phone" else "Signed in as ${session.email}",
                            style = ZarvisProStyles.rowTitle,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            if (guest) {
                                "This account has no sign-in email yet, so it only exists on this phone. Link an email to use the same account on the web or another device."
                            } else {
                                "Use this email and password on the web or another phone to continue the same conversations and tasks."
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    is SessionState.Expired -> Text("Your session ended. Sign in to continue.", style = ZarvisProStyles.rowTitle, fontWeight = FontWeight.Bold)
                    SessionState.None -> Text("Not signed in", style = ZarvisProStyles.rowTitle, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
    form.info?.let { QueenNote(text = it, icon = ZarvisIcons.Check, tint = ZarvisAccents.success) }
    form.error?.let { QueenInlineError(text = it) }

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
        ZarvisSecondaryButton(tr(UiString.SIGN_OUT), onClick = onSignOut, icon = ZarvisIcons.User)
    }
}

/**
 * An email and password, and the one button that sends them. The password is hidden unless the eye button (named Show / Hide
 * password for TalkBack) shows it; the button stays off until the email has an @ and the password its 8 characters.
 */
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
    var showPassword by rememberSaveable(title) { mutableStateOf(false) }
    GlassSurface(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(ZarvisSpacing.sm)) {
            Text(title, style = ZarvisProStyles.rowTitle, fontWeight = FontWeight.Bold)
            note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            ZarvisTextField(
                value = email,
                onValueChange = { email = it },
                label = "Email",
                leadingIcon = ZarvisIcons.User,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            )
            ZarvisTextField(
                value = password,
                onValueChange = { password = it },
                label = "Password (8+ characters)",
                leadingIcon = ZarvisIcons.Lock,
                trailing = {
                    IconButton(onClick = { showPassword = !showPassword }) {
                        Icon(
                            imageVector = ZarvisIcons.Eye,
                            contentDescription = tr(if (showPassword) UiString.A11Y_HIDE_PASSWORD else UiString.A11Y_SHOW_PASSWORD),
                            tint = if (showPassword) ZarvisAccents.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            )
            ZarvisPrimaryButton(
                text = if (busy) "Please wait…" else action,
                enabled = !busy && email.contains('@') && password.length >= 8,
                onClick = { onSubmit(email, password) },
            )
        }
    }
}
