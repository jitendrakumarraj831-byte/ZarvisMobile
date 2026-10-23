import type { JsonSchema } from "../domain/types.js";
import type { ToolDefinition } from "../ai/provider.js";

/**
 * Phone actions the Brain may hand to the ZARVIS Android app (ZARVIS_ASSISTANT_UPGRADE_PLAN.md, Phase 6 "Brain → device
 * handoff"). The server never runs them: when the planner calls one, the turn ends with a structured `deviceAction`, the
 * phone runs it through its own ToolPipeline (Android permission, then the per-action confirmation it requires), and
 * reports the real result back (`POST /api/v1/orchestrator/device-result`). The phone stays the authority.
 *
 * The descriptions are the server's, never the client's: a client only says WHICH of these ids it can run (the turn
 * request's `deviceActions`), so nothing a client sends ends up in the model's tool catalogue. Ids and input fields
 * match the Android on-device skills (android/skills/.../OnDeviceSkillRegistryFactory.kt); an id the client does not
 * list is not offered.
 */
/**
 * How a phone action reaches the app or system feature it uses (blueprint Phase 11 "Third-party states"). API_AVAILABLE: an
 * Android API ZARVIS calls itself; INTENT_AVAILABLE: another app opened at the right screen; SHARE_FLOW_AVAILABLE: a draft
 * handed to another app, where the user presses Send; SYSTEM_FLOW_AVAILABLE: a system screen or dialog the user finishes;
 * ACCESSIBILITY_ALLOWED_AND_SUPPORTED: the accessibility service the user turned on, one confirmed step at a time.
 */
export type ThirdPartyRoute =
  | "API_AVAILABLE"
  | "INTENT_AVAILABLE"
  | "SHARE_FLOW_AVAILABLE"
  | "SYSTEM_FLOW_AVAILABLE"
  | "ACCESSIBILITY_ALLOWED_AND_SUPPORTED";

/** What no phone action does, whatever the request (NOT_SUPPORTED): the planner says so instead of trying. */
export const NOT_SUPPORTED_ON_PHONE: readonly string[] = [
  "send a message, email or post without the user pressing Send",
  "pay, transfer money or buy anything",
  "read another app's private data (chats, banking, passwords) other than what is on screen when the user asks to read it",
  "change a system setting by itself (it opens the settings screen for the user)",
  "act inside banking, payment or password apps (screen reading and tapping refuse them)",
];

export interface DeviceActionDefinition {
  id: string;
  /** What the action does and what each input field holds (the schema's properties carry only types). */
  description: string;
  inputSchema: JsonSchema;
  route: ThirdPartyRoute;
  /**
   * Words that make the development mock planner (ai/mockProvider.ts, which has no language understanding) choose this
   * action. Never shown to a real model.
   */
  mockHints: string[];
}

export const DEVICE_ACTIONS: readonly DeviceActionDefinition[] = [
  {
    id: "phone.open_app",
    description:
      "On this phone: open an app. appName is the app's name or kind in English as the user meant it, e.g. WhatsApp, " +
      "YouTube, Chrome, Gallery, Camera, Contacts, Phone, Messages, Calculator, Calendar, Clock, Maps, Files, Play Store. " +
      "Use it for 'open/launch/start X', 'X kholo', 'X chalu karo', 'X खोलो'. For the Settings app use the settings action.",
    inputSchema: { requiredFields: ["appName"], properties: { appName: "string" } },
    route: "INTENT_AVAILABLE",
    mockHints: ["open ", "kholo", "khol ", "launch", "chalu", "gallery", "whatsapp", "youtube", "chrome", "calculator", "camera app", "clock app"],
  },
  {
    id: "phone.find_contact",
    description:
      "On this phone: look up a saved contact's phone number. name is only the person's name as saved (e.g. Mom, Rahul), " +
      "without words such as number, ka or batao.",
    inputSchema: { requiredFields: ["name"], properties: { name: "string" } },
    route: "API_AVAILABLE",
    mockHints: ["number of", "ka number", "contact of", "phone number"],
  },
  {
    id: "phone.call",
    description:
      "On this phone: call a saved contact or a phone number. target is the person's name as saved, or the digits of the " +
      "number. The phone shows the exact number and the user confirms before anything is dialled.",
    inputSchema: { requiredFields: ["target"], properties: { target: "string" } },
    route: "SYSTEM_FLOW_AVAILABLE",
    mockHints: ["call ", "phone lagao", "phone karo", "dial "],
  },
  {
    id: "personal.reminder",
    description:
      "On this phone: create a reminder notification (action \"create\", title = the user's whole request including the " +
      "time) or list the user's reminders (action \"list\").",
    inputSchema: { requiredFields: ["action"], properties: { action: "string", title: "string" } },
    route: "API_AVAILABLE",
    mockHints: ["remind", "reminder", "yaad dila"],
  },
  {
    id: "alarm.set",
    description: "On this phone: set an alarm in the Clock app. utterance is the user's request including the time (e.g. 6:30 am, kal subah 6 baje).",
    inputSchema: { requiredFields: ["utterance"], properties: { utterance: "string" } },
    route: "INTENT_AVAILABLE",
    mockHints: ["alarm", "wake me"],
  },
  {
    id: "calendar.create_event",
    description: "On this phone: open a pre-filled calendar event for the user to save. utterance is the request with the event's title and time.",
    inputSchema: { requiredFields: ["utterance"], properties: { utterance: "string" } },
    route: "INTENT_AVAILABLE",
    mockHints: ["calendar", "add an event", "add event"],
  },
  {
    id: "device.open_settings",
    description: "On this phone: open a settings screen. panel is MAIN (the Settings app), WIFI, BLUETOOTH or LOCATION.",
    inputSchema: { requiredFields: ["panel"], properties: { panel: "string" } },
    route: "SYSTEM_FLOW_AVAILABLE",
    mockHints: ["settings", "setting ", "wifi", "wi-fi", "bluetooth", "open settings"],
  },
  {
    id: "location.current",
    description: "On this phone: get the user's approximate current location.",
    inputSchema: { requiredFields: [] },
    route: "API_AVAILABLE",
    mockHints: ["where am i", "my location", "meri location"],
  },
  // The next four say exactly what the phone does with the picture or file (android/domain/.../DeviceCapabilitySkills.kt):
  // only describe_photo sends anything to be understood. A description that promised more made the planner answer "summarize
  // this PDF" with a picker that then only showed the file's name.
  {
    id: "camera.capture_photo",
    description:
      "On this phone: open the camera so the user can take a photo now (\"take a photo\", \"selfie lo\"). The phone shows " +
      "only a small preview: the photo is not saved, uploaded or described, so you never see it. To say what is in a photo, " +
      "use the describe-photo action instead.",
    inputSchema: { requiredFields: [] },
    route: "SYSTEM_FLOW_AVAILABLE",
    mockHints: ["take a photo", "take a picture", "selfie", "photo khincho"],
  },
  {
    id: "photos.pick_photo",
    description:
      "On this phone: let the user pick one photo from the gallery. The phone shows its name and size only; the photo is not " +
      "uploaded or described. When the user wants to know what is in a photo, use the describe-photo action instead.",
    inputSchema: { requiredFields: [] },
    route: "SYSTEM_FLOW_AVAILABLE",
    mockHints: ["pick a photo", "choose a photo"],
  },
  {
    id: "photos.describe_photo",
    description:
      "On this phone: let the user pick a photo, then describe what is in it (\"is photo mein kya hai\", \"describe this " +
      "picture\"). The picked photo is sent to ZARVIS's server to be described and is not stored.",
    inputSchema: { requiredFields: [] },
    route: "SYSTEM_FLOW_AVAILABLE",
    mockHints: ["describe a photo", "describe this photo"],
  },
  {
    id: "files.pick_document",
    description:
      "On this phone: let the user pick one document. The phone shows the file's name, type and size only: it does not read " +
      "or upload the document, so you cannot summarize or answer questions about it from here. To have a document read, the " +
      "user attaches it in ZARVIS on the web; say so instead of offering this action for reading.",
    inputSchema: { requiredFields: [] },
    route: "SYSTEM_FLOW_AVAILABLE",
    mockHints: ["pick a file", "pick a document", "choose a file"],
  },
  {
    id: "notifications.read_recent",
    description: "On this phone: read a privacy-filtered summary of the user's current notifications.",
    inputSchema: { requiredFields: [] },
    route: "API_AVAILABLE",
    mockHints: ["my notifications", "notifications padho"],
  },
  {
    id: "notifications.speak_on",
    description: "On this phone: start reading new notifications aloud (with the user's privacy rules).",
    inputSchema: { requiredFields: [] },
    route: "API_AVAILABLE",
    mockHints: ["speak my notifications", "notifications bolo"],
  },
  {
    id: "notifications.speak_off",
    description: "On this phone: stop reading notifications aloud.",
    inputSchema: { requiredFields: [] },
    route: "API_AVAILABLE",
    mockHints: ["stop speaking notifications", "notification mat bolo"],
  },
  {
    id: "usage.screen_time",
    description: "On this phone: today's screen time and the most-used apps.",
    inputSchema: { requiredFields: [] },
    route: "API_AVAILABLE",
    mockHints: ["screen time"],
  },
  {
    id: "device.global_action",
    description:
      "On this phone (accessibility): press BACK or HOME, open RECENTS, the NOTIFICATIONS shade or QUICK_SETTINGS, or " +
      "LOCK_SCREEN. action is one of those names.",
    inputSchema: { requiredFields: ["action"], properties: { action: "string" } },
    route: "ACCESSIBILITY_ALLOWED_AND_SUPPORTED",
    mockHints: ["go home", "go back", "lock the screen", "recent apps", "quick settings"],
  },
  {
    id: "screen.read",
    description: "On this phone (accessibility): read the visible text of the app the user is in.",
    inputSchema: { requiredFields: [] },
    route: "ACCESSIBILITY_ALLOWED_AND_SUPPORTED",
    mockHints: ["read my screen", "screen padho"],
  },
  {
    id: "screen.tap",
    description: "On this phone (accessibility): tap one labelled button in the app the user is in. label is the button's text.",
    inputSchema: { requiredFields: ["label"], properties: { label: "string" } },
    route: "ACCESSIBILITY_ALLOWED_AND_SUPPORTED",
    mockHints: ["tap ", "button dabao"],
  },
  {
    id: "message.draft",
    description:
      "On this phone: open a message draft in another app for the user to send themselves; ZARVIS never sends it. text is " +
      "the message, as the user wants it sent. app is WhatsApp, SMS, Email, Telegram or another messaging app (leave it out " +
      "to let the user choose). to is the contact's name as saved, a phone number, or an email address for Email (leave it " +
      "out when the user named nobody). Then tell the user to press Send.",
    inputSchema: { requiredFields: ["text"], properties: { text: "string", app: "string", to: "string" } },
    route: "SHARE_FLOW_AVAILABLE",
    mockHints: ["message", "msg ", "bhejo", " saying ", "send ", "on whatsapp"],
  },
  {
    id: "app.search",
    description:
      "On this phone: show search results in an app. app is YouTube, Maps (find a place), Directions (the route to a place), " +
      "Play Store, or Web (the browser; the default). query is what to search for, or the place. Use it when the user wants " +
      "to see results on the phone ('YouTube pe X search karo', 'X ka rasta dikhao', 'search X on Google'); to answer a " +
      "question yourself, use your own research tools instead.",
    inputSchema: { requiredFields: ["query"], properties: { query: "string", app: "string" } },
    route: "INTENT_AVAILABLE",
    mockHints: ["search", "rasta", "directions", "navigate", "on the map", "dhundo", "on youtube", "youtube pe"],
  },
  {
    id: "assistant.setup",
    description: "On this phone: start making ZARVIS the phone's default digital assistant.",
    inputSchema: { requiredFields: [] },
    route: "SYSTEM_FLOW_AVAILABLE",
    mockHints: ["default assistant"],
  },
];

const BY_ID = new Map(DEVICE_ACTIONS.map((action) => [action.id, action] as const));

export function isDeviceActionId(id: unknown): id is string {
  return typeof id === "string" && BY_ID.has(id);
}

export function findDeviceAction(id: string): DeviceActionDefinition | undefined {
  return BY_ID.get(id);
}

/** Most phone steps one request may take (the first one included), so a confused plan cannot run on. */
export const MAX_PHONE_STEPS = 5;
const MAX_THEN_CHARS = 300;

const THEN_HINT =
  " Optional then: when the user's request needs more phone steps after this one, the rest of it in a few words (e.g. " +
  "after opening an app: 'tap Rahul's chat'); leave it out when this step finishes the request.";

/** The phone actions to offer the planner: the catalogue entries the client said it can run, in catalogue order. */
export function deviceActionTools(clientActions: readonly string[] | undefined): ToolDefinition[] {
  if (!clientActions?.length) return [];
  const wanted = new Set(clientActions);
  return DEVICE_ACTIONS.filter((action) => wanted.has(action.id)).map((action) => ({
    name: action.id,
    description: action.description + THEN_HINT,
    inputSchema: { ...action.inputSchema, properties: { ...action.inputSchema.properties, then: "string" } },
  }));
}

/** The rest of a multi-step request the planner put in a phone action's `then`, trimmed; undefined when there is none. */
export function nextPhoneStep(input: Record<string, unknown>): string | undefined {
  const then = typeof input?.then === "string" ? input.then.trim().slice(0, MAX_THEN_CHARS) : "";
  return then || undefined;
}

/**
 * The planner's instruction for the next step of a multi-step phone request, after the phone reported step [step]. It is
 * not stored in the conversation: the conversation already holds the user's request and each step's real result.
 */
export function continuationNote(step: number, status: string, then: string): string {
  return `Phone step ${step} finished (${status}). ${CONTINUATION_LEAD}${then}`;
}
export const CONTINUATION_LEAD = "Continue the same request with its next phone step, or say in one sentence that it is done: ";

const MAX_INPUT_VALUE_CHARS = 500;

/**
 * The input sent to the phone: only the fields the action declares, as trimmed strings (a model may send a number for a
 * phone number). Anything else the model added is dropped; the phone validates the rest again.
 */
export function sanitizeDeviceInput(action: DeviceActionDefinition, input: Record<string, unknown>): Record<string, string> {
  const allowed = new Set([...action.inputSchema.requiredFields, ...Object.keys(action.inputSchema.properties ?? {})]);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (!allowed.has(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const text = String(value).trim().slice(0, MAX_INPUT_VALUE_CHARS);
      if (text) out[key] = text;
    }
  }
  return out;
}

/** What a device-action turn returns instead of running anything on the server. */
export interface DeviceActionRequest {
  /** Unique per handoff; the phone echoes it when it reports the result. */
  toolCallId: string;
  skillId: string;
  input: Record<string, string>;
  /** The rest of a multi-step request, for the phone to continue with after this step succeeds (see continuationNote). */
  then?: string;
}

/** The result statuses a phone may report (the same vocabulary as tooling/toolResult.ts). */
export const DEVICE_RESULT_STATUSES = new Set([
  "COMPLETED",
  "FAILED",
  "DENIED",
  "PERMISSION_REQUIRED",
  "USER_ACTION_REQUIRED",
  "CONFIRMATION_REQUIRED",
  "UNSUPPORTED",
]);
