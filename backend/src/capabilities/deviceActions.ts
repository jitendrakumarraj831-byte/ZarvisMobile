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
export interface DeviceActionDefinition {
  id: string;
  /** What the action does and what each input field holds (the schema's properties carry only types). */
  description: string;
  inputSchema: JsonSchema;
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
    mockHints: ["open ", "kholo", "khol ", "launch", "chalu", "gallery", "whatsapp", "youtube", "chrome", "calculator", "camera app"],
  },
  {
    id: "phone.find_contact",
    description:
      "On this phone: look up a saved contact's phone number. name is only the person's name as saved (e.g. Mom, Rahul), " +
      "without words such as number, ka or batao.",
    inputSchema: { requiredFields: ["name"], properties: { name: "string" } },
    mockHints: ["number of", "ka number", "contact of", "phone number"],
  },
  {
    id: "phone.call",
    description:
      "On this phone: call a saved contact or a phone number. target is the person's name as saved, or the digits of the " +
      "number. The phone shows the exact number and the user confirms before anything is dialled.",
    inputSchema: { requiredFields: ["target"], properties: { target: "string" } },
    mockHints: ["call ", "phone lagao", "phone karo", "dial "],
  },
  {
    id: "personal.reminder",
    description:
      "On this phone: create a reminder notification (action \"create\", title = the user's whole request including the " +
      "time) or list the user's reminders (action \"list\").",
    inputSchema: { requiredFields: ["action"], properties: { action: "string", title: "string" } },
    mockHints: ["remind", "reminder", "yaad dila"],
  },
  {
    id: "alarm.set",
    description: "On this phone: set an alarm in the Clock app. utterance is the user's request including the time (e.g. 6:30 am, kal subah 6 baje).",
    inputSchema: { requiredFields: ["utterance"], properties: { utterance: "string" } },
    mockHints: ["alarm", "wake me"],
  },
  {
    id: "calendar.create_event",
    description: "On this phone: open a pre-filled calendar event for the user to save. utterance is the request with the event's title and time.",
    inputSchema: { requiredFields: ["utterance"], properties: { utterance: "string" } },
    mockHints: ["calendar", "add an event", "add event"],
  },
  {
    id: "device.open_settings",
    description: "On this phone: open a settings screen. panel is MAIN (the Settings app), WIFI, BLUETOOTH or LOCATION.",
    inputSchema: { requiredFields: ["panel"], properties: { panel: "string" } },
    mockHints: ["settings", "setting ", "wifi", "wi-fi", "bluetooth"],
  },
  {
    id: "location.current",
    description: "On this phone: get the user's approximate current location.",
    inputSchema: { requiredFields: [] },
    mockHints: ["where am i", "my location", "meri location"],
  },
  {
    id: "camera.capture_photo",
    description: "On this phone: open the camera to take a photo now and attach it to this chat (\"take a photo\", \"selfie lo\").",
    inputSchema: { requiredFields: [] },
    mockHints: ["take a photo", "take a picture", "selfie", "photo khincho"],
  },
  {
    id: "photos.pick_photo",
    description: "On this phone: let the user pick one photo to use in this chat.",
    inputSchema: { requiredFields: [] },
    mockHints: ["pick a photo", "choose a photo"],
  },
  {
    id: "photos.describe_photo",
    description: "On this phone: let the user pick a photo, then describe what is in it.",
    inputSchema: { requiredFields: [] },
    mockHints: ["describe a photo", "describe this photo"],
  },
  {
    id: "files.pick_document",
    description: "On this phone: let the user pick one document to read in this chat.",
    inputSchema: { requiredFields: [] },
    mockHints: ["pick a file", "pick a document", "choose a file"],
  },
  {
    id: "notifications.read_recent",
    description: "On this phone: read a privacy-filtered summary of the user's current notifications.",
    inputSchema: { requiredFields: [] },
    mockHints: ["my notifications", "notifications padho"],
  },
  {
    id: "notifications.speak_on",
    description: "On this phone: start reading new notifications aloud (with the user's privacy rules).",
    inputSchema: { requiredFields: [] },
    mockHints: ["speak my notifications", "notifications bolo"],
  },
  {
    id: "notifications.speak_off",
    description: "On this phone: stop reading notifications aloud.",
    inputSchema: { requiredFields: [] },
    mockHints: ["stop speaking notifications", "notification mat bolo"],
  },
  {
    id: "usage.screen_time",
    description: "On this phone: today's screen time and the most-used apps.",
    inputSchema: { requiredFields: [] },
    mockHints: ["screen time"],
  },
  {
    id: "device.global_action",
    description:
      "On this phone (accessibility): press BACK or HOME, open RECENTS, the NOTIFICATIONS shade or QUICK_SETTINGS, or " +
      "LOCK_SCREEN. action is one of those names.",
    inputSchema: { requiredFields: ["action"], properties: { action: "string" } },
    mockHints: ["go home", "go back", "lock the screen", "recent apps", "quick settings"],
  },
  {
    id: "screen.read",
    description: "On this phone (accessibility): read the visible text of the app the user is in.",
    inputSchema: { requiredFields: [] },
    mockHints: ["read my screen", "screen padho"],
  },
  {
    id: "screen.tap",
    description: "On this phone (accessibility): tap one labelled button in the app the user is in. label is the button's text.",
    inputSchema: { requiredFields: ["label"], properties: { label: "string" } },
    mockHints: ["tap ", "button dabao"],
  },
  {
    id: "assistant.setup",
    description: "On this phone: start making ZARVIS the phone's default digital assistant.",
    inputSchema: { requiredFields: [] },
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

/** The phone actions to offer the planner: the catalogue entries the client said it can run, in catalogue order. */
export function deviceActionTools(clientActions: readonly string[] | undefined): ToolDefinition[] {
  if (!clientActions?.length) return [];
  const wanted = new Set(clientActions);
  return DEVICE_ACTIONS.filter((action) => wanted.has(action.id)).map((action) => ({
    name: action.id,
    description: action.description,
    inputSchema: action.inputSchema,
  }));
}

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
