# ZARVIS Privacy

ZARVIS privacy behavior follows the master blueprint.

## Data principles

- Collect only what a capability needs.
- Keep data scoped to the authorized account and task.
- Do not treat permission as unlimited authorization.
- Give users control over memory and integrations.
- Handle permission revocation and disconnected integrations.
- Avoid sensitive data in application logs.

## Android notification privacy

Notification access should support configurable privacy modes, including:

- Off
- App + type
- Contact + app
- Contact + app + preview
- Available content

Quiet hours, lock-screen behavior, headphones behavior and sensitive-content exclusions should be respected where supported.

OTP, banking and authentication alerts are not spoken by default.

## Truthful privacy UX

Every permission request should explain why access is needed, what access/data is involved, what ZARVIS will not do automatically, and how the user can revoke access.
