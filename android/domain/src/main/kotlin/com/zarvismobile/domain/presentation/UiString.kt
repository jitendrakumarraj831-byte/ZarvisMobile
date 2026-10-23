package com.zarvismobile.domain.presentation

import java.util.Locale

/**
 * Text the app shows on screen, in English and Hindi, side by side.
 *
 * Every entry has both languages, so a label can never exist without its Hindi counterpart (the compiler
 * refuses a one-language entry) and `UiStringTest` checks the rest: the Hindi is Devanagari, and a `%s` or
 * `%d` in one language is in the other. Wording follows the website (web/i18n.js) wherever the same phrase
 * exists there, so the two clients call things the same names.
 *
 * Only some screens use this so far (see `LANGUAGE_SCOPE_BODY`, which tells the user which). A screen that
 * still has plain English literals is not translated, and the Language page says so rather than claiming
 * otherwise. Add the screen to that text when it starts using this.
 */
enum class UiString(val en: String, val hi: String) {
    // ---- Bottom navigation ------------------------------------------------------------------
    NAV_HOME("Home", "होम"),
    NAV_CHAT("Chat", "चैट"),
    // "Skills" on the tab: "Capabilities" does not fit five tabs on a 360dp phone (it pushed Work's label out). The page keeps its title.
    NAV_CAPABILITIES("Skills", "क्षमताएँ"),
    NAV_TASKS("Tasks", "कार्य"),
    NAV_WORK("Work", "काम"),

    // ---- Shared ---------------------------------------------------------------------------
    COMMON_BACK("Back", "वापस"),
    COMMON_TRY_AGAIN("Try again", "फिर कोशिश करें"),
    COMMON_REFRESH("Refresh", "ताज़ा करें"),
    COMMON_CANCEL("Cancel", "रद्द करें"),
    COMMON_DELETE("Delete", "हटाएँ"),
    COMMON_OPEN("Open", "खोलें"),
    COMMON_LOADING("Loading…", "लोड हो रहा है…"),
    COMMON_SELECTED("Selected", "चुना गया"),
    COMMON_SETTINGS("Settings", "सेटिंग्स"),
    COMMON_OK("OK", "ठीक है"),
    COMMON_OPEN_NAMED("Open %s", "%s खोलें"),
    COMMON_PLANS_QUOTAS("Plans & quotas", "प्लान और कोटा"),

    // ---- Home -----------------------------------------------------------------------------
    HOME_TAGLINE("AI ASSISTANT", "AI असिस्टेंट"),
    HOME_INTRO("Ask a question, speak, or start a task. Phone actions stay on this device.", "सवाल पूछें, बोलें या कोई काम शुरू करें। फ़ोन के काम इसी डिवाइस पर रहते हैं।"),
    HOME_CAT_WEB("Web", "वेब"),
    HOME_CAT_DOCUMENTS("Documents", "दस्तावेज़"),
    HOME_CAT_DEVELOPER("Developer", "डेवलपर"),
    HOME_CAT_BUSINESS("Business", "बिज़नेस"),
    HOME_CAT_CREATIVE("Creative", "क्रिएटिव"),
    HOME_CAT_AUTOMATION("Automation", "ऑटोमेशन"),
    HOME_CAT_RESEARCH("Research", "रिसर्च"),
    HOME_CAPABILITIES_TITLE("What can you do?", "आप क्या कर सकते हैं?"),
    HOME_CAPABILITIES_BODY("See every skill ZARVIS currently has, grouped by category.", "ZARVIS की सभी मौजूदा स्किल श्रेणी के अनुसार देखें।"),
    HOME_BROWSE_SKILLS("Browse skills (%d)", "स्किल देखें (%d)"),
    HOME_SUBSCRIPTION("Subscription", "सब्सक्रिप्शन"),
    HOME_PLAN_LINE("Plan: %s · credits left: %d", "प्लान: %s · बचे क्रेडिट: %d"),
    HOME_MANAGE_SUBSCRIPTION("Manage subscription", "सब्सक्रिप्शन देखें"),
    HOME_RECENT_TASKS("Recent Tasks", "हाल के कार्य"),
    HOME_SEE_ALL("See all", "सभी देखें"),
    HOME_NO_TASKS("No tasks yet — ask ZARVIS to do something to get started.", "अभी कोई कार्य नहीं — शुरू करने के लिए ZARVIS से कुछ करने को कहें।"),
    HOME_PHONE_AGENT("Phone Agent", "फ़ोन एजेंट"),
    HOME_PHONE_AGENT_BODY(
        "Open apps, find contacts, confirmed calls, reminders, pickers, camera, location, and settings shortcuts on this phone.",
        "इस फ़ोन पर ऐप खोलें, संपर्क ढूँढें, पुष्टि के बाद कॉल करें, रिमाइंडर, पिकर, कैमरा, लोकेशन और सेटिंग शॉर्टकट इस्तेमाल करें।",
    ),
    HOME_OPEN_PHONE_AGENT("Open Phone Agent", "फ़ोन एजेंट खोलें"),
    HOME_VOICE_ASSISTANT("Voice Assistant", "वॉइस असिस्टेंट"),
    HOME_DEVELOPER_AGENT("Developer Agent", "डेवलपर एजेंट"),
    HOME_ERROR("Couldn't load your skills, plan and tasks. Check your connection and try again.", "आपकी स्किल, प्लान और कार्य लोड नहीं हो सके। कनेक्शन जाँचें और फिर कोशिश करें।"),

    // ---- Work -----------------------------------------------------------------------------
    WORK_TITLE("Work", "काम"),
    WORK_INTRO(
        "What you can do from this phone. Items marked “Website only” are not in the app yet.",
        "इस फ़ोन से आप क्या कर सकते हैं। “सिर्फ़ वेबसाइट पर” वाली चीज़ें अभी ऐप में नहीं हैं।",
    ),
    WORK_ON_THE_WEBSITE("On the website", "वेबसाइट पर"),
    WORK_ON_THIS_PHONE("On this phone", "इस फ़ोन पर"),
    WORK_AVAILABILITY_AVAILABLE("Available now", "अभी उपलब्ध"),
    WORK_AVAILABILITY_ANDROID("Android only", "सिर्फ़ Android पर"),
    WORK_AVAILABILITY_CHAT("Works in Chat", "चैट में चलता है"),
    WORK_AVAILABILITY_WEBSITE("Website only", "सिर्फ़ वेबसाइट पर"),
    WORK_TASKS_TITLE("Tasks", "कार्य"),
    WORK_TASKS_BODY("Your tasks with their real status.", "आपके कार्य, उनकी असली स्थिति के साथ।"),
    WORK_MEMORY_TITLE("Memory", "मेमोरी"),
    WORK_MEMORY_BODY(
        "What you saved for ZARVIS to remember about you. Add to it, pause items, and delete what you don't want kept.",
        "आपने ZARVIS के याद रखने के लिए अपने बारे में जो सहेजा है। उसमें जोड़ें, आइटम रोकें, और जो नहीं रखना चाहते उसे हटाएँ।",
    ),
    WORK_USAGE_TITLE("Usage & metrics", "उपयोग और मेट्रिक्स"),
    WORK_USAGE_BODY("Response times measured on this phone, and your task log.", "इस फ़ोन पर नापे गए जवाब के समय, और आपका कार्य लॉग।"),
    WORK_PLANS_TITLE("Plans & credits", "प्लान और क्रेडिट"),
    WORK_PLANS_BODY("Your plan and credits. Checkout is not connected on this phone.", "आपका प्लान और क्रेडिट। इस फ़ोन पर भुगतान अभी जुड़ा नहीं है।"),
    WORK_DEVELOPER_TITLE("Developer Agent", "डेवलपर एजेंट"),
    WORK_DEVELOPER_BODY("Read-only analysis of a GitHub repository. Changes stay on the confirmed server path.", "GitHub रिपॉज़िटरी का सिर्फ़-पढ़ने वाला विश्लेषण। बदलाव पुष्टि वाले सर्वर रास्ते पर ही रहते हैं।"),
    WORK_PHONE_TITLE("Phone Agent", "फ़ोन एजेंट"),
    WORK_PHONE_BODY("Open apps, find contacts, and place confirmed calls on this phone.", "इस फ़ोन पर ऐप खोलें, संपर्क ढूँढें और पुष्टि के बाद कॉल करें।"),
    WORK_RESEARCH_TITLE("Research", "रिसर्च"),
    WORK_RESEARCH_BODY("Search and structured questions run in Chat.", "खोज और संरचित सवाल चैट में चलते हैं।"),
    WORK_CREATIVE_TITLE("Creative", "क्रिएटिव"),
    WORK_CREATIVE_BODY("Writing skills are live. Image generation is not.", "लिखने की स्किल चालू हैं। इमेज बनाना अभी चालू नहीं है।"),
    WORK_BUSINESS_TITLE("Business", "बिज़नेस"),
    WORK_BUSINESS_BODY("Draft a post, reply, or invoice. Nothing is sent.", "पोस्ट, जवाब या इनवॉइस का ड्राफ़्ट बनाएँ। कुछ भेजा नहीं जाता।"),
    WORK_FILES_TITLE("Files", "फ़ाइलें"),
    WORK_FILES_BODY("Paste the text into Chat. The file library and uploads are on the website.", "टेक्स्ट चैट में चिपकाएँ। फ़ाइल लाइब्रेरी और अपलोड वेबसाइट पर हैं।"),
    WORK_SETTINGS_TITLE("Settings", "सेटिंग्स"),
    WORK_SETTINGS_BODY("Language, appearance, voice, and account.", "भाषा, दिखावट, वॉइस और खाता।"),
    WORK_PROJECTS_TITLE("Projects", "प्रोजेक्ट"),
    WORK_PROJECTS_BODY("Projects, saved files and research notes are on the website. They are not in this app yet.", "प्रोजेक्ट, सहेजी फ़ाइलें और रिसर्च नोट वेबसाइट पर हैं। वे अभी इस ऐप में नहीं हैं।"),
    WORK_AGENTS_TITLE("Agents", "एजेंट"),
    WORK_AGENTS_BODY("The agent pages (Personal, Research, Documents and more) are on the website. They are not in this app yet.", "एजेंट पेज (पर्सनल, रिसर्च, दस्तावेज़ और अन्य) वेबसाइट पर हैं। वे अभी इस ऐप में नहीं हैं।"),
    WORK_SUMMARY_TASKS("Tasks: %d", "कार्य: %d"),
    WORK_SUMMARY_TASKS_NONE("No tasks yet", "अभी कोई कार्य नहीं"),
    WORK_SUMMARY_MEMORY("%d saved", "%d सहेजे गए"),
    WORK_SUMMARY_MEMORY_NONE("Nothing saved", "कुछ नहीं सहेजा"),
    WORK_SUMMARY_MEMORY_PAUSED("Paused", "रुका हुआ"),
    WORK_SUMMARY_PLAN("%s · credits: %d", "%s · क्रेडिट: %d"),
    WORK_SUMMARY_UNAVAILABLE("Couldn't load", "लोड नहीं हो सका"),

    // ---- Tasks (the Activity tab and Work > Tasks) -----------------------------------------
    TASKS_TITLE("Activity", "गतिविधि"),
    TASKS_TITLE_WORK("Tasks", "कार्य"),
    TASKS_SUBTITLE(
        "A task shows its real status. Nothing runs by itself, and this phone can't start a step yet; use the website for that.",
        "कार्य अपनी असली स्थिति दिखाता है। कुछ भी अपने-आप नहीं चलता, और यह फ़ोन अभी कोई चरण शुरू नहीं कर सकता; इसके लिए वेबसाइट इस्तेमाल करें।",
    ),
    TASKS_ABOUT("About tasks", "कार्यों के बारे में"),
    TASKS_EMPTY_TITLE("No tasks yet", "अभी कोई कार्य नहीं"),
    TASKS_EMPTY("Ask ZARVIS to create a workflow, then control it here.", "ZARVIS से वर्कफ़्लो बनवाएँ, फिर उसे यहाँ संभालें।"),
    TASKS_ERROR("Couldn't load your tasks. Check your connection and try again.", "आपके कार्य लोड नहीं हो सके। कनेक्शन जाँचें और फिर कोशिश करें।"),
    TASKS_STATUS_LINE("Status: %s · %s", "स्थिति: %s · %s"),
    TASKS_NOT_AUTOMATIC("Automatic task execution isn't available yet. Nothing runs on its own.", "अपने-आप कार्य चलना अभी उपलब्ध नहीं है। कुछ भी अपने-आप नहीं चलता।"),
    TASKS_ACTION_ERROR("That didn't go through. Check your connection and try again.", "यह नहीं हो सका। कनेक्शन जाँचें और फिर कोशिश करें।"),
    TASKS_PAUSE("Pause", "रोकें"),
    TASKS_CANCEL("Cancel", "रद्द करें"),

    // Task states, named as on the website (web/workspace.js LIFECYCLE_LABEL).
    TASK_QUEUED("Queued · not started", "कतार में · शुरू नहीं हुआ"),
    TASK_RUNNING("Running", "चल रहा है"),
    TASK_EXECUTING("Running a tool", "टूल चल रहा है"),
    TASK_VERIFYING("Checking the result", "नतीजा जाँचा जा रहा है"),
    TASK_WAITING("Waiting for you", "आपका इंतज़ार है"),
    TASK_CONFIRMATION("Needs your confirmation", "आपकी पुष्टि चाहिए"),
    TASK_PAUSED("Paused", "रुका हुआ"),
    TASK_COMPLETED("Completed", "पूरा हुआ"),
    TASK_FAILED("Failed", "विफल"),
    TASK_CANCELLED("Cancelled", "रद्द किया गया"),
    TASK_BLOCKED("Blocked", "अटका हुआ"),

    RISK_LOW("Low risk", "कम जोखिम"),
    RISK_MEDIUM("Medium risk", "मध्यम जोखिम"),
    RISK_HIGH("High risk", "ज़्यादा जोखिम"),
    RISK_VERY_HIGH("Very high risk", "बहुत ज़्यादा जोखिम"),

    // ---- Usage & metrics ------------------------------------------------------------------
    METRICS_TITLE("System Metrics", "सिस्टम मेट्रिक्स"),
    METRICS_SUBTITLE("Latency measured live on this device, and your current task log.", "इस डिवाइस पर लाइव नापा गया जवाब का समय, और आपका मौजूदा कार्य लॉग।"),
    METRICS_AVG_LATENCY("Avg Latency", "औसत समय"),
    METRICS_TURNS("Turns Logged", "दर्ज बातचीत"),
    METRICS_SUCCESS("Success Rate", "सफलता दर"),
    METRICS_LIVE_LATENCY("Live API Latency", "लाइव जवाब का समय"),
    METRICS_NO_TURNS("No turns yet this session — ask ZARVIS something in Chat and it shows up here instantly.", "इस सेशन में अभी कोई बातचीत नहीं — चैट में ZARVIS से कुछ पूछें, वह यहाँ तुरंत दिखेगा।"),
    METRICS_TASK_LOG("Task Log", "कार्य लॉग"),
    METRICS_TASKS_ERROR("Couldn't load the task log.", "कार्य लॉग लोड नहीं हो सका।"),
    METRICS_SLOWEST("Slowest", "सबसे धीमा"),

    // ---- Chat -----------------------------------------------------------------------------
    CHAT_TITLE("Chat with ZARVIS", "ZARVIS से चैट"),
    CHAT_NEW("New chat", "नई चैट"),
    CHAT_DELETE_TITLE("Delete this chat?", "यह चैट हटाएँ?"),
    CHAT_DELETE_BODY(
        "This chat and all its messages will be permanently deleted from your ZARVIS account, on every device. This can't be undone.",
        "यह चैट और इसके सभी संदेश आपके ZARVIS खाते से, हर डिवाइस से, हमेशा के लिए हटा दिए जाएँगे। इसे वापस नहीं किया जा सकता।",
    ),
    CHAT_DELETED("Chat deleted.", "चैट हटा दी गई।"),
    CHAT_DELETE_FAILED(
        "Couldn't delete this chat. Check your connection and try again.",
        "यह चैट हटाई नहीं जा सकी। अपना कनेक्शन जाँचें और फिर कोशिश करें।",
    ),
    CHAT_COMPOSER_HINT("Type your task", "अपना काम लिखें"),
    CHAT_STATE_IDLE("Tap the orb or type to start", "शुरू करने के लिए ऑर्ब दबाएँ या लिखें"),
    CHAT_STATE_LISTENING("Listening…", "सुन रहा है…"),
    CHAT_STATE_WORKING("Working…", "काम हो रहा है…"),
    CHAT_STATE_DONE("Done", "हो गया"),
    CHAT_STATE_SPEAKING("Speaking…", "बोल रहा है…"),
    CHAT_STATE_ERROR("Something went wrong — try again", "कुछ गड़बड़ हुई — फिर कोशिश करें"),
    CHAT_PROGRESS_SENDING("Sending to ZARVIS…", "ZARVIS को भेजा जा रहा है…"),
    CHAT_PROGRESS_SLOW(
        "The server is taking longer than usual — it may be starting up, which can take up to a minute.",
        "सर्वर को सामान्य से ज़्यादा समय लग रहा है — शायद वह शुरू हो रहा है, इसमें एक मिनट तक लग सकता है।",
    ),
    CHAT_PROGRESS_THINKING("Thinking…", "सोच रहा है…"),
    CHAT_PROGRESS_WORKING("Working: %s…", "काम चल रहा है: %s…"),
    CHAT_PROGRESS_WORKING_PLAIN("Working on it…", "काम चल रहा है…"),
    CHAT_PROGRESS_ON_PHONE("Doing it on your phone…", "आपके फ़ोन पर किया जा रहा है…"),
    CHAT_STOPPED("Stopped before the reply arrived.", "जवाब आने से पहले रोका गया।"),
    CHAT_EMPTY_TITLE("What can I do for you?", "मैं आपके लिए क्या करूँ?"),
    CHAT_EMPTY_BODY(
        "Type below or tap the orb to speak. I can open apps, draft messages, set reminders, search and answer questions.",
        "नीचे लिखें या बोलने के लिए ऑर्ब दबाएँ। मैं ऐप खोल सकता हूँ, मैसेज का ड्राफ़्ट बना सकता हूँ, रिमाइंडर लगा सकता हूँ, खोज सकता हूँ और सवालों के जवाब दे सकता हूँ।",
    ),
    CHAT_SUGGEST_CAMERA("Open the camera", "कैमरा खोलो"),
    CHAT_SUGGEST_REMINDER("Remind me in 10 minutes to drink water", "10 मिनट बाद पानी पीने की याद दिलाना"),
    CHAT_SUGGEST_WRITE("Write a short birthday wish for my friend", "मेरे दोस्त के लिए जन्मदिन की एक छोटी शुभकामना लिखो"),
    CHAT_STATUS_COMPLETED("✓ Completed", "✓ पूरा हुआ"),
    CHAT_STATUS_DECLINED("Not done — declined", "नहीं हुआ — मना किया गया"),
    CHAT_STATUS_PERMISSION("Needs permission", "अनुमति चाहिए"),
    CHAT_STATUS_USER_ACTION("Your action needed", "आपकी कार्रवाई चाहिए"),
    CHAT_STATUS_CONFIRMATION("Waiting for your confirmation", "आपकी पुष्टि का इंतज़ार"),
    CHAT_STATUS_UNSUPPORTED("Not available", "उपलब्ध नहीं"),
    CHAT_STATUS_FAILED("Failed", "विफल"),
    CHAT_INTERRUPTED_TITLE("ZARVIS was closed before this finished:", "यह पूरा होने से पहले ZARVIS बंद हो गया:"),
    CHAT_INTERRUPTED_BODY("Nothing was done. Continuing asks for access and confirmation again.", "कुछ नहीं हुआ। जारी रखने पर अनुमति और पुष्टि फिर से माँगी जाएगी।"),
    CHAT_CONTINUE("Continue", "जारी रखें"),
    CHAT_DISMISS("Dismiss", "हटाएँ"),

    // Why a message got no answer (TurnFailures): each says only what is known to have happened.
    CHAT_FAIL_OFFLINE(
        "I couldn't reach ZARVIS, so nothing was done. Check your connection and try again.",
        "ZARVIS तक पहुँच नहीं हो सकी, इसलिए कुछ नहीं हुआ। अपना कनेक्शन जाँचें और फिर कोशिश करें।",
    ),
    CHAT_FAIL_INTERRUPTED(
        "The connection dropped while ZARVIS was working on this, so part of it may have run. Try again: it is sent under the same id, so ZARVIS can reuse what already finished.",
        "ZARVIS इस पर काम कर रहा था तभी कनेक्शन टूट गया, इसलिए इसका कुछ हिस्सा हो चुका हो सकता है। फिर कोशिश करें: यह उसी पहचान के साथ भेजा जाएगा, ताकि जो पूरा हो चुका है उसे ZARVIS दोबारा इस्तेमाल कर सके।",
    ),
    CHAT_FAIL_SERVER(
        "ZARVIS ran into a problem on its side and couldn't finish this. Please try again.",
        "ZARVIS की तरफ़ कोई समस्या आई और यह पूरा नहीं हो सका। कृपया फिर कोशिश करें।",
    ),
    CHAT_FAIL_BUSY(
        "ZARVIS is still working on this same message. Wait a moment, then try again.",
        "ZARVIS अभी इसी संदेश पर काम कर रहा है। थोड़ा रुकें, फिर कोशिश करें।",
    ),
    CHAT_FAIL_REJECTED(
        "ZARVIS couldn't accept this request as it is, so nothing was done. Try rephrasing it.",
        "ZARVIS इस अनुरोध को इस रूप में स्वीकार नहीं कर सका, इसलिए कुछ नहीं हुआ। इसे दूसरे शब्दों में लिखकर देखें।",
    ),
    CHAT_FAIL_SESSION("Your session has ended. Sign in again to continue.", "आपका सत्र समाप्त हो गया है। जारी रखने के लिए फिर से साइन इन करें।"),
    CHAT_FAIL_UNEXPECTED(
        "Something went wrong in the app, so this was not finished. Please try again.",
        "ऐप में कुछ गड़बड़ हुई, इसलिए यह पूरा नहीं हुआ। कृपया फिर कोशिश करें।",
    ),
    CHAT_RETRY_NAMED("Try again: %s", "फिर कोशिश करें: %s"),

    // Voice input (SpeechErrors) and the spoken reply.
    VOICE_NOT_HEARD("I didn't catch that. Tap the mic and speak again, or type.", "मैं सुन नहीं पाया। माइक दबाकर फिर से बोलें, या लिखें।"),
    VOICE_NETWORK(
        "Voice input couldn't reach the phone's speech service. Check your connection, or type instead.",
        "बोलकर लिखना फ़ोन की स्पीच सेवा तक नहीं पहुँच सका। कनेक्शन जाँचें, या लिखकर भेजें।",
    ),
    VOICE_AUDIO("The microphone couldn't record. Try again, or type instead.", "माइक्रोफ़ोन रिकॉर्ड नहीं कर सका। फिर कोशिश करें, या लिखकर भेजें।"),
    VOICE_BUSY("The phone's speech service is busy. Wait a moment and try again.", "फ़ोन की स्पीच सेवा अभी व्यस्त है। थोड़ा रुककर फिर कोशिश करें।"),
    VOICE_PERMISSION_OFF(
        "Microphone access is off, so voice input can't start. You can type instead.",
        "माइक्रोफ़ोन की अनुमति बंद है, इसलिए बोलकर लिखना शुरू नहीं हो सकता। आप लिखकर भेज सकते हैं।",
    ),
    VOICE_LANGUAGE(
        "The phone's speech service can't listen in this language. Change the app language in Settings, or type instead.",
        "फ़ोन की स्पीच सेवा इस भाषा में नहीं सुन सकती। सेटिंग्स में ऐप की भाषा बदलें, या लिखकर भेजें।",
    ),
    VOICE_UNAVAILABLE("Voice input isn't available on this phone. You can type instead.", "इस फ़ोन पर बोलकर लिखना उपलब्ध नहीं है। आप लिखकर भेज सकते हैं।"),
    VOICE_FAILED("Voice input stopped unexpectedly. Try again, or type instead.", "बोलकर लिखना अचानक रुक गया। फिर कोशिश करें, या लिखकर भेजें।"),
    VOICE_DECLINED("Voice input stays off. You can type instead.", "बोलकर लिखना बंद रहेगा। आप लिखकर भेज सकते हैं।"),
    VOICE_PLAYBACK_FAILED("Voice playback failed — the reply is shown as text.", "आवाज़ में जवाब नहीं चल सका — जवाब लिखा हुआ दिख रहा है।"),

    // ---- Capabilities ---------------------------------------------------------------------
    CAPABILITIES_TITLE("Capabilities", "क्षमताएँ"),
    CAPABILITIES_KICKER("AI AGENT HUB", "AI एजेंट हब"),
    CAPABILITIES_INTRO("Everything ZARVIS can do right now, grouped by category.", "ZARVIS अभी जो कुछ कर सकता है, श्रेणी के अनुसार।"),
    CAPABILITIES_BROWSE_BY_PRODUCT("Browse by product", "प्रोडक्ट के अनुसार देखें"),
    CAPABILITIES_SKILLS_NOW("Skills available right now", "अभी उपलब्ध स्किल"),
    CAPABILITIES_RUN("Run Agent", "एजेंट चलाएँ"),
    CAPABILITIES_ERROR("Couldn't load the skill list. Check your connection and try again.", "स्किल की सूची लोड नहीं हो सकी। कनेक्शन जाँचें और फिर कोशिश करें।"),

    // ---- Settings -------------------------------------------------------------------------
    SETTINGS_INTRO("Personalize the ZARVIS experience using real app, OS and backend capabilities.", "असली ऐप, OS और बैकएंड क्षमताओं से ZARVIS को अपने हिसाब से बनाएँ।"),
    SETTINGS_CURRENT_SETUP("Current setup", "मौजूदा सेटअप"),
    SETTINGS_LANGUAGE_LINE("Language: %s", "भाषा: %s"),
    SETTINGS_APPEARANCE_LINE("Appearance: %s", "दिखावट: %s"),
    SETTINGS_DARK("Queen Dark", "क्वीन डार्क"),
    SETTINGS_QUEEN_LIGHT("Queen Light", "क्वीन लाइट"),
    SETTINGS_PAGE_ACCOUNT("Account", "खाता"),
    SETTINGS_PAGE_PERMISSIONS("Permissions & Device Access", "अनुमतियाँ और डिवाइस एक्सेस"),
    SETTINGS_PAGE_VOICE("Voice", "वॉइस"),
    SETTINGS_PAGE_LANGUAGE("Language", "भाषा"),
    SETTINGS_PAGE_APPEARANCE("Appearance", "दिखावट"),
    SETTINGS_PAGE_AI("AI", "AI"),
    SETTINGS_PAGE_NOTIFICATIONS("Notifications", "सूचनाएँ"),
    SETTINGS_PAGE_PRIVACY("Privacy", "गोपनीयता"),
    SETTINGS_PAGE_SECURITY("Security", "सुरक्षा"),
    SETTINGS_PAGE_DATA("Data", "डेटा"),
    SETTINGS_PAGE_MEMORY("Memory", "मेमोरी"),
    SETTINGS_PAGE_PROTECTION("Rules & Protection", "नियम और सुरक्षा"),
    SETTINGS_PAGE_DEVELOPER("Developer Agent", "डेवलपर एजेंट"),
    SETTINGS_SUB_ACCOUNT("Guest, linked email, sign in and out", "गेस्ट, जुड़ा ईमेल, साइन इन और साइन आउट"),
    SETTINGS_SUB_PERMISSIONS("What ZARVIS can access, live from Android", "ZARVIS क्या एक्सेस कर सकता है, Android से लाइव"),
    SETTINGS_SUB_VOICE("Speech recognition and spoken replies", "बोलकर इनपुट और बोले गए जवाब"),
    SETTINGS_SUB_LANGUAGE("English or Hindi", "अंग्रेज़ी या हिंदी"),
    SETTINGS_SUB_APPEARANCE("Queen dark / light theme", "क्वीन डार्क / लाइट थीम"),
    SETTINGS_SUB_AI("Current orchestration behavior", "मौजूदा ऑर्केस्ट्रेशन व्यवहार"),
    SETTINGS_SUB_NOTIFICATIONS("Mode, spoken notifications, quiet hours, exclusions", "मोड, बोली जाने वाली सूचनाएँ, शांत घंटे, बहिष्करण"),
    SETTINGS_SUB_PRIVACY("Account and privacy controls", "खाता और गोपनीयता नियंत्रण"),
    SETTINGS_SUB_SECURITY("Secure tokens and local session", "सुरक्षित टोकन और लोकल सेशन"),
    SETTINGS_SUB_DATA("Server data and deletion", "सर्वर डेटा और हटाना"),
    SETTINGS_SUB_MEMORY("What ZARVIS saved about you: view and delete", "ZARVIS ने आपके बारे में क्या सहेजा: देखें और हटाएँ"),
    SETTINGS_SUB_PROTECTION("What this build actually enforces", "यह बिल्ड असल में क्या लागू करता है"),
    SETTINGS_SUB_DEVELOPER("Repository analysis", "रिपॉज़िटरी विश्लेषण"),
    SETTINGS_SUBPAGE_KICKER("ZARVIS settings", "ZARVIS सेटिंग्स"),
    LANGUAGE_ENGLISH_SUB("Menus and labels, voice input and read-aloud", "मेन्यू और लेबल, बोलकर लिखना और ज़ोर से पढ़ना"),
    LANGUAGE_HINDI_SUB("Menus and labels, voice input and read-aloud", "मेन्यू और लेबल, बोलकर लिखना और ज़ोर से पढ़ना"),
    LANGUAGE_SCOPE_TITLE("What Hindi changes today", "आज हिंदी में क्या बदलता है"),
    LANGUAGE_SCOPE_BODY(
        "Hindi switches the menus, titles and buttons on Home, Chat, Work, Tasks, Memory, the Settings list, Appearance, Voice and this page, the sign-out and delete-account questions, and the welcome pages, and Chat's own messages about failed requests and voice input. It also sets the language for voice input and read-aloud. " +
            "It does not decide the language of your conversation: ZARVIS answers in the language you write or speak in, and uses this setting only when that is not clear, such as a plain \"hi\". " +
            "Error messages outside Chat, longer explanations, Permissions & Device Access, Plans, Developer Agent and the other Settings pages (AI, Notifications, Privacy, Data, Rules & Protection) are still in English.",
        "हिंदी चुनने पर होम, चैट, काम, कार्य, मेमोरी, सेटिंग्स की सूची, दिखावट, वॉइस और यह पन्ना, साइन आउट और खाता हटाने के सवाल, स्वागत पन्नों के मेन्यू, शीर्षक और बटन, तथा चैट में अधूरे अनुरोधों और बोलकर लिखने के संदेश हिंदी में हो जाते हैं। साथ ही बोलकर लिखने और ज़ोर से पढ़ने की भाषा भी हिंदी हो जाती है। " +
            "यह आपकी बातचीत की भाषा तय नहीं करता: ZARVIS उसी भाषा में जवाब देता है जिसमें आप लिखते या बोलते हैं, और यह सेटिंग तभी काम आती है जब भाषा साफ़ न हो, जैसे सिर्फ़ \"hi\"। " +
            "चैट के बाहर के त्रुटि संदेश, लंबे विवरण, अनुमतियाँ और डिवाइस एक्सेस, प्लान, डेवलपर एजेंट और सेटिंग्स के बाकी पन्ने (AI, सूचनाएँ, गोपनीयता, डेटा, नियम और सुरक्षा) अभी अंग्रेज़ी में हैं।",
    ),

    // ---- Memory (Settings > Memory and Work > Memory) -------------------------------------
    MEMORY_TITLE("Memory", "मेमोरी"),
    MEMORY_USE_TITLE("Use saved memory in replies", "जवाबों में सहेजी मेमोरी इस्तेमाल करें"),
    MEMORY_USE_ON("ZARVIS may use what is saved below. It never saves anything by itself.", "नीचे सहेजी बातों का ZARVIS इस्तेमाल कर सकता है। वह अपने-आप कुछ नहीं सहेजता।"),
    MEMORY_USE_OFF("Paused. Everything stays saved, but ZARVIS does not use it.", "रुका हुआ। सब कुछ सहेजा रहता है, पर ZARVIS उसका इस्तेमाल नहीं करता।"),
    MEMORY_PERSONAL("Personal memory", "निजी मेमोरी"),
    MEMORY_PERSONAL_HINT("Facts and preferences you chose to save. At most the newest %d active items are given to ZARVIS.", "आपकी चुनी हुई बातें और पसंद। ZARVIS को ज़्यादा से ज़्यादा सबसे नए %d चालू आइटम दिए जाते हैं।"),
    MEMORY_PERSONAL_EMPTY("Nothing saved", "कुछ नहीं सहेजा"),
    MEMORY_PERSONAL_EMPTY_BODY(
        "ZARVIS has no personal memory of you. Add something above; items you save on the website show up here too.",
        "ZARVIS के पास आपकी कोई निजी मेमोरी नहीं है। ऊपर कुछ जोड़ें; वेबसाइट पर सहेजी बातें भी यहाँ दिखती हैं।",
    ),
    MEMORY_PROJECT("Project memory", "प्रोजेक्ट मेमोरी"),
    MEMORY_PROJECT_HINT("Kept inside each project on the website and used only in that project's chats. You can delete items here.", "वेबसाइट पर हर प्रोजेक्ट के अंदर रखी जाती है और सिर्फ़ उसी प्रोजेक्ट की चैट में इस्तेमाल होती है। आइटम यहाँ हटा सकते हैं।"),
    MEMORY_PROJECT_EMPTY("No project memory", "कोई प्रोजेक्ट मेमोरी नहीं"),
    MEMORY_USED("Used in replies", "जवाबों में इस्तेमाल"),
    MEMORY_ITEM_PAUSED("Paused", "रुका हुआ"),
    MEMORY_DELETE_ITEM("Delete this item", "यह आइटम हटाएँ"),
    MEMORY_DELETE_ITEM_NAMED("Delete: %s", "हटाएँ: %s"),
    MEMORY_FORGET_ALL("Forget all personal memory", "सारी निजी मेमोरी भूल जाएँ"),
    MEMORY_FORGET_TITLE("Forget all personal memory?", "सारी निजी मेमोरी भूल जाएँ?"),
    MEMORY_FORGET_BODY("All personal memory (%d saved) will be deleted from the server. Project memory is not touched.", "सारी निजी मेमोरी (%d सहेजी) सर्वर से हटा दी जाएगी। प्रोजेक्ट मेमोरी को छुआ नहीं जाएगा।"),
    MEMORY_FORGET_CONFIRM("Forget everything", "सब कुछ भूल जाएँ"),
    MEMORY_DELETE_TITLE("Delete this memory?", "यह मेमोरी हटाएँ?"),
    MEMORY_DELETE_BODY("It is deleted from the server and ZARVIS will no longer use it.", "यह सर्वर से हट जाएगी और ZARVIS इसका इस्तेमाल नहीं करेगा।"),
    MEMORY_CONTEXT_TITLE("Conversation context", "बातचीत का संदर्भ"),
    MEMORY_CONTEXT_BODY(
        "In a chat, ZARVIS reads the last %d messages of that chat. Chats are stored on the server with your account. A new chat starts without them.",
        "चैट में ZARVIS उस चैट के आखिरी %d संदेश पढ़ता है। चैट आपके खाते के साथ सर्वर पर रहती हैं। नई चैट इनके बिना शुरू होती है।",
    ),
    MEMORY_LOAD_ERROR("Couldn't load your memory", "आपकी मेमोरी लोड नहीं हो सकी"),
    MEMORY_ACTION_ERROR("That didn't work. Check your connection and try again.", "यह नहीं हो सका। कनेक्शन जाँचें और फिर कोशिश करें।"),
    MEMORY_FORGOT("Items forgotten: %d", "भूले गए आइटम: %d"),
    MEMORY_ADD_TITLE("Add to memory", "मेमोरी में जोड़ें"),
    MEMORY_ADD_HINT("Something ZARVIS should remember about you, e.g. I'm vegetarian", "कुछ जो ZARVIS आपके बारे में याद रखे, जैसे मैं शाकाहारी हूँ"),
    MEMORY_ADD_SAVE("Save to memory", "मेमोरी में सहेजें"),
    MEMORY_ADD_TOO_LONG("A memory can be at most %d characters.", "एक मेमोरी में ज़्यादा से ज़्यादा %d अक्षर हो सकते हैं।"),
    MEMORY_ADDED("Saved to your personal memory.", "आपकी निजी मेमोरी में सहेज लिया।"),
    MEMORY_ITEM_USE("Use in replies", "जवाबों में इस्तेमाल करें"),
    MEMORY_ITEM_USE_NAMED("Use in replies: %s", "जवाबों में इस्तेमाल करें: %s"),

    // ---- Welcome pages --------------------------------------------------------------------
    ONBOARDING_1_TITLE("Meet ZARVIS", "ZARVIS से मिलिए"),
    ONBOARDING_1_BODY(
        "Tell your AI what you want done — in English, Hindi, or Hinglish. It plans the work and gets it done.",
        "अपने AI को बताएँ कि क्या करवाना है — अंग्रेज़ी, हिंदी या हिंग्लिश में। वह काम की योजना बनाता है और उसे पूरा करता है।",
    ),
    ONBOARDING_2_TITLE("Speak or type", "बोलें या लिखें"),
    ONBOARDING_2_BODY(
        "Tap the orb and talk, or type your task. ZARVIS understands natural language — no commands to learn.",
        "ऑर्ब दबाकर बोलें, या अपना काम लिखें। ZARVIS सामान्य भाषा समझता है — कोई कमांड सीखने की ज़रूरत नहीं।",
    ),
    ONBOARDING_3_TITLE("Skills, not menus", "स्किल, मेन्यू नहीं"),
    ONBOARDING_3_BODY(
        "ZARVIS uses specific skills to get things done — search, documents, reminders, and more, growing over time.",
        "ZARVIS काम पूरा करने के लिए ख़ास स्किल इस्तेमाल करता है — खोज, दस्तावेज़, रिमाइंडर और भी बहुत कुछ, जो समय के साथ बढ़ता है।",
    ),
    ONBOARDING_4_TITLE("You're always in control", "कंट्रोल हमेशा आपके पास"),
    ONBOARDING_4_BODY(
        "Anything risky always asks for your confirmation first. Permissions are requested only when needed, never all at once.",
        "जोखिम वाला हर काम पहले आपकी पुष्टि माँगता है। अनुमतियाँ सिर्फ़ ज़रूरत पड़ने पर माँगी जाती हैं, एक साथ नहीं।",
    ),
    ONBOARDING_5_TITLE("Your data, your rules", "आपका डेटा, आपके नियम"),
    ONBOARDING_5_BODY(
        "You can see what ZARVIS has saved about you and delete it in Settings › Memory. You can also delete your account and its server data. There is no data export yet.",
        "ZARVIS ने आपके बारे में जो सहेजा है उसे आप सेटिंग्स › मेमोरी में देख और हटा सकते हैं। आप अपना खाता और उसका सर्वर डेटा भी हटा सकते हैं। डेटा एक्सपोर्ट अभी नहीं है।",
    ),
    ONBOARDING_6_TITLE("Start free", "मुफ़्त में शुरू करें"),
    ONBOARDING_6_BODY(
        "Your trial unlocks a taste of everything ZARVIS can do. Upgrade any time for more.",
        "आपका ट्रायल ZARVIS की हर चीज़ की झलक देता है। और चाहिए तो कभी भी अपग्रेड करें।",
    ),
    ONBOARDING_SKIP("Skip", "छोड़ें"),
    ONBOARDING_NEXT("Next", "आगे"),
    ONBOARDING_START("Get started", "शुरू करें"),

    // ---- Accessibility labels (read aloud by TalkBack) ------------------------------------------
    A11Y_SPEAK("Speak", "बोलें"),
    A11Y_SEND("Send", "भेजें"),
    A11Y_ORB_IDLE("Tap to speak", "बोलने के लिए टैप करें"),
    A11Y_ORB_LISTENING("Listening", "सुन रहा है"),
    A11Y_ORB_UNDERSTANDING("Understanding your request", "आपका अनुरोध समझ रहा है"),
    A11Y_ORB_PLANNING("Planning", "योजना बना रहा है"),
    A11Y_ORB_WORKING("Working on it", "काम हो रहा है"),
    A11Y_ORB_DONE("Done", "हो गया"),
    A11Y_ORB_SPEAKING("Speaking", "बोल रहा है"),
    A11Y_ORB_ERROR("Something went wrong", "कुछ गड़बड़ हुई"),

    // ---- Settings > Appearance ------------------------------------------------------------
    APPEARANCE_DARK_TITLE("Dark theme", "डार्क थीम"),
    APPEARANCE_DARK_ON("Queen Dark is active", "क्वीन डार्क चालू है"),
    APPEARANCE_DARK_OFF("Queen Light is active", "क्वीन लाइट चालू है"),
    APPEARANCE_DEFAULT_NOTE("Queen Dark is the default appearance.", "क्वीन डार्क डिफ़ॉल्ट दिखावट है।"),
    APPEARANCE_MOTION_TITLE("Animations", "एनिमेशन"),
    APPEARANCE_MOTION_BODY(
        "The background's gold rays, glitter and stars move slowly, and the glowing orb moves while ZARVIS is listening, working or speaking. Everything stands still when Lightweight mode or Android's \"Remove animations\" is on.",
        "पृष्ठभूमि की सुनहरी किरणें, चमक और सितारे धीरे-धीरे चलते हैं, और चमकता ऑर्ब तब हिलता है जब ZARVIS सुन रहा हो, काम कर रहा हो या बोल रहा हो। हल्का मोड या Android में “एनिमेशन हटाएँ” चालू होने पर सब कुछ स्थिर रहता है।",
    ),
    APPEARANCE_LITE_TITLE("Lightweight mode", "हल्का मोड"),
    APPEARANCE_LITE_ON("The background and the orb hold still", "पृष्ठभूमि और ऑर्ब स्थिर रहते हैं"),
    APPEARANCE_LITE_OFF("Gold rays, glitter and stars move slowly", "सुनहरी किरणें, चमक और सितारे धीरे-धीरे चलते हैं"),

    // ---- Settings > Voice -----------------------------------------------------------------
    VOICE_INPUT_TITLE("Voice input", "वॉइस इनपुट"),
    VOICE_INPUT_BODY(
        "Android speech recognition, started only when you tap the microphone. No wake word.",
        "Android की स्पीच रिकग्निशन, सिर्फ़ तब शुरू होती है जब आप माइक्रोफ़ोन पर टैप करते हैं। कोई वेक वर्ड नहीं।",
    ),
    VOICE_SPEAK_TITLE("Speak replies aloud", "जवाब ज़ोर से सुनाएँ"),
    VOICE_SPEAK_ON("Replies are spoken with a neural voice", "जवाब न्यूरल आवाज़ में सुनाए जाते हैं"),
    VOICE_SPEAK_OFF("Off — replies are shown as text only", "बंद — जवाब सिर्फ़ टेक्स्ट में दिखते हैं"),
    VOICE_OUTPUT_TITLE("Voice output", "वॉइस आउटपुट"),
    VOICE_OUTPUT_BODY(
        "Spoken replies are made on ZARVIS's server with a neural voice. If voice fails, the reply stays on screen as text.",
        "बोले गए जवाब ZARVIS के सर्वर पर न्यूरल आवाज़ से बनते हैं। आवाज़ न चले तो जवाब स्क्रीन पर टेक्स्ट में रहता है।",
    ),
    VOICE_STYLE("Voice style", "आवाज़ की शैली"),
    VOICE_TAP_TO_USE("Tap to use this voice", "यह आवाज़ चुनने के लिए टैप करें"),

    // ---- Settings > Account, sign out and delete -------------------------------------------
    SIGN_OUT("Sign out", "साइन आउट"),
    SIGN_OUT_TITLE("Sign out?", "साइन आउट करें?"),
    SIGN_OUT_GUEST_BODY(
        "This is a guest account with no sign-in email. After signing out you can't get back into it. Link an email first if you want to keep it.",
        "यह बिना साइन-इन ईमेल वाला गेस्ट खाता है। साइन आउट के बाद आप इसमें वापस नहीं जा पाएँगे। इसे रखना चाहते हैं तो पहले ईमेल जोड़ें।",
    ),
    SIGN_OUT_BODY(
        "This ends the session on this device. Sign in again with your email to continue.",
        "यह इस डिवाइस का सेशन खत्म करता है। जारी रखने के लिए अपने ईमेल से फिर साइन इन करें।",
    ),
    SIGN_OUT_CARD_BODY(
        "Ends this device's session on the server. Your account and its data are not deleted.",
        "यह सर्वर पर इस डिवाइस का सेशन खत्म करता है। आपका खाता और उसका डेटा नहीं हटता।",
    ),
    DELETE_ACCOUNT("Delete account", "खाता हटाएँ"),
    DELETE_ACCOUNT_TITLE("Delete your account?", "अपना खाता हटाएँ?"),
    DELETE_ACCOUNT_BODY(
        "This permanently deletes your account, tasks, and usage history from the server. This cannot be undone.",
        "यह आपका खाता, कार्य और उपयोग का इतिहास सर्वर से हमेशा के लिए हटा देता है। इसे वापस नहीं किया जा सकता।",
    ),
    DELETE_ACCOUNT_CARD_BODY(
        "Permanently delete the authenticated account and its server-side task/usage data.",
        "साइन-इन किया हुआ खाता और सर्वर पर उसका कार्य/उपयोग डेटा हमेशा के लिए हटाएँ।",
    ),
    DELETE_ACCOUNT_BUSY("Deleting…", "हटा रहा है…"),
    DELETE_ACCOUNT_FAILED(
        "Couldn't delete the account. Check the connection and try again.",
        "खाता नहीं हट सका। कनेक्शन जाँचें और फिर कोशिश करें।",
    ),
    // Plans & quotas (Work › Plans).
    PLANS_SUBTITLE("Your plan, your credits, and what each plan includes.", "आपका प्लान, आपके क्रेडिट, और हर प्लान में क्या शामिल है।"),
    PLANS_CURRENT("Current plan", "मौजूदा प्लान"),
    PLANS_CREDITS_LEFT("credits left", "क्रेडिट बाकी"),
    PLANS_TRIAL_ENDS("Trial ends %s", "ट्रायल %s को खत्म होगा"),
    PLANS_ERROR("Couldn't load your plan. Check your connection and try again.", "आपका प्लान लोड नहीं हो सका। अपना कनेक्शन जाँचें और फिर से कोशिश करें।"),
    PLANS_MONTHLY("Monthly", "मासिक"),
    PLANS_YEARLY("Yearly", "वार्षिक"),
    PLANS_RECOMMENDED("Recommended", "सुझाया गया"),
    PLANS_YOUR_PLAN("Your plan", "आपका प्लान"),
    PLANS_FREE_TAGLINE("Get started with zero commitment.", "बिना किसी वादे के शुरू करें।"),
    PLANS_FREE_1("Low-risk, low-cost skills", "कम जोखिम और कम लागत वाली स्किल्स"),
    PLANS_FREE_2("Voice and text in English, Hindi and Hinglish", "अंग्रेज़ी, हिंदी और हिंग्लिश में आवाज़ और टेक्स्ट"),
    PLANS_FREE_3("Standard response speed", "सामान्य जवाब की गति"),
    PLANS_PRO_TAGLINE("Full access to every skill ZARVIS ships.", "ZARVIS की हर स्किल का पूरा इस्तेमाल।"),
    PLANS_PRO_1("Every skill, at every risk level", "हर स्किल, हर जोखिम स्तर पर"),
    PLANS_PRO_2("A higher usage and credit limit", "ज़्यादा इस्तेमाल और क्रेडिट की सीमा"),
    PLANS_PRO_3("Priority in the request queue", "अनुरोधों की कतार में प्राथमिकता"),
    PLANS_BILLED_MONTHLY("Billed monthly · pricing coming soon", "मासिक बिलिंग · कीमत जल्द आएगी"),
    PLANS_BILLED_YEARLY("Billed yearly · pricing coming soon", "वार्षिक बिलिंग · कीमत जल्द आएगी"),
    PLANS_UPGRADE_TITLE("Upgrading", "अपग्रेड करना"),
    PLANS_UPGRADE_BODY(
        "Purchases through Google Play are not switched on in this build yet, so nothing can be bought or charged here. The server side is ready.",
        "इस बिल्ड में Google Play से खरीदारी अभी चालू नहीं है, इसलिए यहाँ कुछ खरीदा या चार्ज नहीं किया जा सकता। सर्वर की तरफ़ से तैयारी पूरी है।",
    ),
    PLANS_UPGRADE_BUTTON("Upgrade (coming soon)", "अपग्रेड (जल्द आ रहा है)"),
    ;

    /** The text in [locale] (`"hi"` or `"hi-IN"`; anything else is English). */
    fun text(locale: String): String = if (isHindi(locale)) hi else en

    /** The text in [locale] with `%s` / `%d` filled in. Digits stay Latin so they match the website. */
    fun format(locale: String, vararg args: Any): String = String.format(Locale.ROOT, text(locale), *args)

    companion object {
        fun isHindi(locale: String): Boolean = locale.equals("hi", ignoreCase = true) || locale.startsWith("hi-", ignoreCase = true)
    }
}
