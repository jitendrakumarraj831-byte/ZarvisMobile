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
    NAV_CAPABILITIES("Capabilities", "क्षमताएँ"),
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
    WORK_AVAILABILITY_AVAILABLE("Available now", "अभी उपलब्ध"),
    WORK_AVAILABILITY_ANDROID("Android only", "सिर्फ़ Android पर"),
    WORK_AVAILABILITY_CHAT("Works in Chat", "चैट में चलता है"),
    WORK_AVAILABILITY_WEBSITE("Website only", "सिर्फ़ वेबसाइट पर"),
    WORK_TASKS_TITLE("Tasks", "कार्य"),
    WORK_TASKS_BODY("Your tasks with their real status.", "आपके कार्य, उनकी असली स्थिति के साथ।"),
    WORK_MEMORY_TITLE("Memory", "मेमोरी"),
    WORK_MEMORY_BODY("What ZARVIS has saved about you. View it and delete what you don't want kept.", "ZARVIS ने आपके बारे में जो सहेजा है। उसे देखें और जो नहीं रखना चाहते उसे हटाएँ।"),
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
    TASKS_EMPTY("No tasks yet. Ask ZARVIS to create a workflow, then control it here.", "अभी कोई कार्य नहीं। ZARVIS से वर्कफ़्लो बनवाएँ, फिर उसे यहाँ संभालें।"),
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

    // ---- Chat -----------------------------------------------------------------------------
    CHAT_TITLE("Chat with ZARVIS", "ZARVIS से चैट"),
    CHAT_NEW("New chat", "नई चैट"),
    CHAT_COMPOSER_HINT("Type your task", "अपना काम लिखें"),
    CHAT_STATE_IDLE("Tap the orb or type to start", "शुरू करने के लिए ऑर्ब दबाएँ या लिखें"),
    CHAT_STATE_LISTENING("Listening…", "सुन रहा है…"),
    CHAT_STATE_WORKING("Working…", "काम हो रहा है…"),
    CHAT_STATE_DONE("Done", "हो गया"),
    CHAT_STATE_SPEAKING("Speaking…", "बोल रहा है…"),
    CHAT_STATE_ERROR("Something went wrong — try again", "कुछ गड़बड़ हुई — फिर कोशिश करें"),
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
    SETTINGS_DARK("Dark", "डार्क"),
    SETTINGS_AURORA_LIGHT("Aurora Light", "ऑरोरा लाइट"),
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
    SETTINGS_SUB_APPEARANCE("Aurora light / dark theme", "ऑरोरा लाइट / डार्क थीम"),
    SETTINGS_SUB_AI("Current orchestration behavior", "मौजूदा ऑर्केस्ट्रेशन व्यवहार"),
    SETTINGS_SUB_NOTIFICATIONS("Mode, spoken notifications, quiet hours, exclusions", "मोड, बोली जाने वाली सूचनाएँ, शांत घंटे, बहिष्करण"),
    SETTINGS_SUB_PRIVACY("Account and privacy controls", "खाता और गोपनीयता नियंत्रण"),
    SETTINGS_SUB_SECURITY("Secure tokens and local session", "सुरक्षित टोकन और लोकल सेशन"),
    SETTINGS_SUB_DATA("Server data and deletion", "सर्वर डेटा और हटाना"),
    SETTINGS_SUB_MEMORY("What ZARVIS saved about you: view and delete", "ZARVIS ने आपके बारे में क्या सहेजा: देखें और हटाएँ"),
    SETTINGS_SUB_PROTECTION("What this build actually enforces", "यह बिल्ड असल में क्या लागू करता है"),
    SETTINGS_SUB_DEVELOPER("Repository analysis", "रिपॉज़िटरी विश्लेषण"),
    SETTINGS_SUBPAGE_KICKER("ZARVIS settings", "ZARVIS सेटिंग्स"),
    LANGUAGE_ENGLISH_SUB("App labels and request language", "ऐप के लेबल और अनुरोध की भाषा"),
    LANGUAGE_HINDI_SUB("App labels and request language", "ऐप के लेबल और अनुरोध की भाषा"),
    LANGUAGE_SCOPE_TITLE("What Hindi changes today", "आज हिंदी में क्या बदलता है"),
    LANGUAGE_SCOPE_BODY(
        "Hindi switches the menus, titles and buttons on Home, Chat, Work, Tasks, Settings, Memory and the welcome pages, and ZARVIS is asked to reply in Hindi. " +
            "Longer explanations, Permissions & Device Access, Plans, Developer Agent and some Settings pages are still in English.",
        "हिंदी चुनने पर होम, चैट, काम, कार्य, सेटिंग्स, मेमोरी और स्वागत पन्नों के मेन्यू, शीर्षक और बटन हिंदी में हो जाते हैं, और ZARVIS से हिंदी में जवाब देने को कहा जाता है। " +
            "लंबे विवरण, अनुमतियाँ और डिवाइस एक्सेस, प्लान, डेवलपर एजेंट और कुछ सेटिंग्स पन्ने अभी अंग्रेज़ी में हैं।",
    ),

    // ---- Memory (Settings > Memory and Work > Memory) -------------------------------------
    MEMORY_TITLE("Memory", "मेमोरी"),
    MEMORY_USE_TITLE("Use saved memory in replies", "जवाबों में सहेजी मेमोरी इस्तेमाल करें"),
    MEMORY_USE_ON("ZARVIS may use what is saved below. It never saves anything by itself.", "नीचे सहेजी बातों का ZARVIS इस्तेमाल कर सकता है। वह अपने-आप कुछ नहीं सहेजता।"),
    MEMORY_USE_OFF("Paused. Everything stays saved, but ZARVIS does not use it.", "रुका हुआ। सब कुछ सहेजा रहता है, पर ZARVIS उसका इस्तेमाल नहीं करता।"),
    MEMORY_PERSONAL("Personal memory", "निजी मेमोरी"),
    MEMORY_PERSONAL_HINT("Facts and preferences you chose to save. At most the newest %d active items are given to ZARVIS.", "आपकी चुनी हुई बातें और पसंद। ZARVIS को ज़्यादा से ज़्यादा सबसे नए %d चालू आइटम दिए जाते हैं।"),
    MEMORY_PERSONAL_EMPTY("Nothing saved", "कुछ नहीं सहेजा"),
    MEMORY_PERSONAL_EMPTY_BODY("ZARVIS has no personal memory of you. Items you save on the website show up here.", "ZARVIS के पास आपकी कोई निजी मेमोरी नहीं है। वेबसाइट पर आप जो सहेजेंगे, वह यहाँ दिखेगा।"),
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
    ;

    /** The text in [locale] (`"hi"` or `"hi-IN"`; anything else is English). */
    fun text(locale: String): String = if (isHindi(locale)) hi else en

    /** The text in [locale] with `%s` / `%d` filled in. Digits stay Latin so they match the website. */
    fun format(locale: String, vararg args: Any): String = String.format(Locale.ROOT, text(locale), *args)

    companion object {
        fun isHindi(locale: String): Boolean = locale.equals("hi", ignoreCase = true) || locale.startsWith("hi-", ignoreCase = true)
    }
}
