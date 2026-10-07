/* Interface translations (English to Hindi) and the small translator that applies them.

   The app builds its screens in English. When the language is Hindi, every string listed here is
   swapped at the DOM level (and swapped back when the language returns to English), so there is
   one place to read, add and test a translation. Text the user wrote (chat messages, task goals,
   file names) is never touched, and long-form pages that are not listed stay in English.

   Generated list: keys are the exact English strings with whitespace collapsed. To add one, add a
   line to the entries below (key, then its Hindi) and keep the unit test green. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ZarvisI18n = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var HI = {
    "Home": "होम",
    "Chat": "चैट",
    "Activity": "गतिविधि",
    "Capabilities": "क्षमताएँ",
    "Developer access": "डेवलपर एक्सेस",
    "Developer Agent": "डेवलपर एजेंट",
    "Metrics": "मेट्रिक्स",
    "Plans": "प्लान",
    "Settings": "सेटिंग्स",
    "Profile": "प्रोफ़ाइल",
    "Search ZARVIS": "ZARVIS में खोजें",
    "Search": "खोजें",
    "Search (Ctrl K)": "खोजें (Ctrl K)",
    "Main": "मुख्य",
    "Menu": "मेन्यू",
    "Close menu": "मेन्यू बंद करें",
    "ZARVIS AI home": "ZARVIS AI होम",
    "Notifications": "सूचनाएँ",
    "Account menu": "खाता मेनू",
    "Account": "खाता",
    "Back to Settings": "सेटिंग्स पर वापस",
    "Back to Capabilities": "क्षमताओं पर वापस",
    "Back to Home": "होम पर वापस",
    "What can I help with today?": "आज मैं आपकी क्या मदद कर सकता हूँ?",
    "Ask ZARVIS": "ZARVIS से पूछें",
    "Image": "इमेज",
    "Voice": "वॉइस",
    "Files": "फ़ाइलें",
    "Tap to Speak": "बोलने के लिए छुएँ",
    "Tap to speak": "बोलने के लिए छुएँ",
    "Quick actions": "त्वरित कार्य",
    "ZARVIS AI — talk by voice": "ZARVIS AI — बोलकर बात करें",
    "Type your request…": "अपना अनुरोध लिखें…",
    "Send to chat": "चैट में भेजें",
    "Start": "शुरू करें",
    "Research a topic": "किसी विषय पर रिसर्च",
    "Write a message": "संदेश लिखें",
    "Summarize a file": "फ़ाइल का सार",
    "Plan a task": "कार्य की योजना बनाएँ",
    "Business draft": "बिज़नेस ड्राफ्ट",
    "Analyze a repo": "रेपो का विश्लेषण",
    "All capabilities": "सभी क्षमताएँ",
    "Recent Activity": "हाल की गतिविधि",
    "View all": "सभी देखें",
    "Nothing yet": "अभी कुछ नहीं",
    "Your conversations and actions will appear here.": "आपकी बातचीत और कार्य यहाँ दिखेंगे।",
    "Couldn't load your activity": "आपकी गतिविधि लोड नहीं हो सकी",
    "Check your connection and try again.": "कनेक्शन जाँचें और फिर कोशिश करें।",
    "Try again": "फिर कोशिश करें",
    "New Chat": "नई चैट",
    "Message ZARVIS": "ZARVIS को संदेश भेजें",
    "Start a new conversation": "नई बातचीत शुरू करें",
    "Speak to ZARVIS": "ZARVIS से बोलें",
    "Suggestions": "सुझाव",
    "Conversation": "बातचीत",
    "Attach a document": "डॉक्यूमेंट अटैच करें",
    "Attach an image": "इमेज अटैच करें",
    "Copy": "कॉपी",
    "Regenerate": "दोबारा बनाएँ",
    "Download": "डाउनलोड",
    "Listen": "सुनें",
    "Completed": "पूरा हुआ",
    "Your recent conversations & tasks.": "आपकी हाल की बातचीत और कार्य।",
    "Refresh": "ताज़ा करें",
    "Search activity": "गतिविधि खोजें",
    "Filter activity": "गतिविधि फ़िल्टर करें",
    "All": "सभी",
    "Chats": "चैट",
    "Tasks": "कार्य",
    "Images": "इमेज",
    "Developer": "डेवलपर",
    "This session": "इस सत्र में",
    "Nothing yet this session": "इस सत्र में अभी कुछ नहीं",
    "Ask ZARVIS something and it shows up here.": "ZARVIS से कुछ पूछिए, वह यहाँ दिखेगा।",
    "Start a chat": "चैट शुरू करें",
    "Tracked tasks": "ट्रैक किए गए कार्य",
    "New task": "नया कार्य",
    "Tasks record steps and status. Pause, resume and cancel change the status; they don't run the steps.": "कार्य में चरण और स्थिति दर्ज होती है। रोकना, फिर चालू करना और रद्द करना सिर्फ़ स्थिति बदलते हैं; वे चरण नहीं चलाते।",
    "No tracked tasks": "कोई ट्रैक किया गया कार्य नहीं",
    "Ask ZARVIS to plan a goal and it will appear here.": "ZARVIS से कोई लक्ष्य प्लान करवाइए, वह यहाँ दिखेगा।",
    "No activity matches": "कोई गतिविधि मेल नहीं खाती",
    "Try a different filter or clear the search.": "दूसरा फ़िल्टर आज़माएँ या खोज हटाएँ।",
    "Pause": "रोकें",
    "Resume": "फिर चालू करें",
    "Cancel": "रद्द करें",
    "Retry": "फिर कोशिश करें",
    "Powerful AI tools in one place.": "एक ही जगह शक्तिशाली AI टूल।",
    "ready now": "अभी तैयार",
    "need your approval": "आपकी मंज़ूरी चाहिए",
    "limited or Android-only": "सीमित या सिर्फ़ Android",
    "not available": "उपलब्ध नहीं",
    "Capabilities by status": "स्थिति के हिसाब से क्षमताएँ",
    "Filter capabilities": "क्षमताएँ फ़िल्टर करें",
    "Media": "मीडिया",
    "Productivity": "उत्पादकता",
    "Automation": "ऑटोमेशन",
    "Ask anything, get answers": "कुछ भी पूछें, जवाब पाएँ",
    "Web search": "वेब खोज",
    "Live, sourced results": "लाइव, स्रोत सहित नतीजे",
    "Try": "आज़माएँ",
    "Research writing": "रिसर्च लेखन",
    "Compare, report, outline": "तुलना, रिपोर्ट, रूपरेखा",
    "Voice input": "वॉइस इनपुट",
    "Talk naturally": "सहज रूप से बोलें",
    "Talk": "बोलें",
    "Spoken replies": "बोलकर जवाब",
    "Hear replies aloud": "जवाब बोलकर सुनें",
    "Image understanding": "इमेज समझना",
    "Ask about photos": "फ़ोटो के बारे में पूछें",
    "Upload": "अपलोड",
    "Image generation": "इमेज बनाना",
    "Not available": "उपलब्ध नहीं",
    "Not part of this version": "इस संस्करण का हिस्सा नहीं",
    "Document summaries": "डॉक्यूमेंट सार",
    "PDF, Docs, text files": "PDF, Docs, टेक्स्ट फ़ाइलें",
    "Status only": "सिर्फ़ स्थिति",
    "Plan goals in steps": "लक्ष्य को चरणों में बाँटें",
    "Create": "बनाएँ",
    "Phone Agent": "फ़ोन एजेंट",
    "Android app actions": "Android ऐप के काम",
    "Details": "विवरण",
    "Repository analysis": "रिपॉज़िटरी विश्लेषण",
    "Read-only repo report": "सिर्फ़ पढ़ने वाली रेपो रिपोर्ट",
    "Pull requests": "Pull request",
    "PRO · approval": "PRO · मंज़ूरी",
    "Implement after approval": "मंज़ूरी के बाद लागू करें",
    "Writing": "लेखन",
    "Messages, poems, ideas": "संदेश, कविताएँ, विचार",
    "Write": "लिखें",
    "Business drafts": "बिज़नेस ड्राफ्ट",
    "Draft only": "सिर्फ़ ड्राफ्ट",
    "Replies, posts, invoices": "जवाब, पोस्ट, इनवॉइस",
    "Draft": "ड्राफ्ट",
    "Open details": "विवरण खोलें",
    "All skills on this account": "इस खाते की सभी स्किल",
    "Needs upgrade": "अपग्रेड चाहिए",
    "Available now": "अभी उपलब्ध",
    "Android app": "Android ऐप",
    "Ask anything in English, Hindi or Hinglish; follow-ups keep context.": "अंग्रेज़ी, हिंदी या हिंग्लिश में कुछ भी पूछें; अगले सवालों में संदर्भ बना रहता है।",
    "Live, sourced results when the provider can ground them.": "जब प्रदाता आधार दे सके, तब लाइव, स्रोत सहित नतीजे।",
    "Compare, report and outline — labelled when not from a live source.": "तुलना, रिपोर्ट और रूपरेखा — लाइव स्रोत न हो तो साफ़ लिखा होता है।",
    "Choose the best plan for you.": "अपने लिए सबसे अच्छा प्लान चुनें।",
    "Current plan": "मौजूदा प्लान",
    "Credits": "क्रेडिट",
    "Trial": "ट्रायल",
    "Payments": "भुगतान",
    "Not enabled": "चालू नहीं",
    "Online payments aren't enabled on this server yet, so plans can't be bought here. Prices below are what Pro will cost.": "इस सर्वर पर ऑनलाइन भुगतान अभी चालू नहीं हैं, इसलिए यहाँ प्लान खरीदे नहीं जा सकते। नीचे की कीमतें Pro की होंगी।",
    "Choose your plan": "अपना प्लान चुनें",
    "Monthly": "मासिक",
    "Yearly": "वार्षिक",
    "Free": "फ्री",
    "forever": "हमेशा",
    "Everything you need to get started.": "शुरू करने के लिए ज़रूरी सब कुछ।",
    "Conversation and voice in English, Hindi and Hinglish": "अंग्रेज़ी, हिंदी और हिंग्लिश में बातचीत और वॉइस",
    "Documents, research, writing and business drafts": "डॉक्यूमेंट, रिसर्च, लेखन और बिज़नेस ड्राफ्ट",
    "Tracked tasks and Developer Agent analysis": "ट्रैक किए गए कार्य और डेवलपर एजेंट का विश्लेषण",
    "Most popular": "सबसे लोकप्रिय",
    "/ month": "/ माह",
    "Every skill ZARVIS ships.": "ZARVIS की हर स्किल।",
    "1,000 credits per month": "हर माह 1,000 क्रेडिट",
    "Everything in Free": "फ्री की सारी सुविधाएँ",
    "Developer Agent pull requests, after your approval": "आपकी मंज़ूरी के बाद डेवलपर एजेंट के pull request",
    "Access to every current skill": "हर मौजूदा स्किल तक पहुँच",
    "Payments not enabled yet": "भुगतान अभी चालू नहीं",
    "Debit & credit cards": "डेबिट और क्रेडिट कार्ड",
    "Netbanking": "नेटबैंकिंग",
    "Wallets": "वॉलेट",
    "Payments are processed securely by Razorpay in INR. ZARVIS never sees your card or UPI details.": "भुगतान Razorpay द्वारा INR में सुरक्षित रूप से होता है। ZARVIS आपका कार्ड या UPI विवरण कभी नहीं देखता।",
    "Billing period": "बिलिंग अवधि",
    "Accepted payment methods": "स्वीकार्य भुगतान तरीके",
    "Customize your Zarvis experience.": "अपना Zarvis अनुभव अपने हिसाब से बनाएँ।",
    "Guest account. Link an email to keep it.": "गेस्ट खाता। इसे रखने के लिए ईमेल जोड़ें।",
    "Guest": "गेस्ट",
    "Assistant": "असिस्टेंट",
    "Privacy & security": "गोपनीयता और सुरक्षा",
    "Advanced": "उन्नत",
    "Subscription": "सब्सक्रिप्शन",
    "Plan and credits": "प्लान और क्रेडिट",
    "Spoken replies and voice": "बोलकर जवाब और आवाज़",
    "Language": "भाषा",
    "Interface and request language": "इंटरफ़ेस और अनुरोध की भाषा",
    "Appearance": "दिखावट",
    "Dark or light": "डार्क या लाइट",
    "Model provider and behaviour": "मॉडल प्रदाता और व्यवहार",
    "Memory": "मेमोरी",
    "Saved conversation": "सहेजी गई बातचीत",
    "Alerts and reminders": "अलर्ट और रिमाइंडर",
    "Permissions & Device Access": "अनुमतियाँ और डिवाइस एक्सेस",
    "What ZARVIS can access on web and Android": "वेब और Android पर ZARVIS क्या एक्सेस कर सकता है",
    "Privacy": "गोपनीयता",
    "Confirmations and account deletion": "पुष्टि और खाता हटाना",
    "Security": "सुरक्षा",
    "Session and sign out": "सत्र और साइन आउट",
    "Data": "डेटा",
    "Stored data and deletion": "संग्रहित डेटा और हटाना",
    "Developer Agent, GitHub and Metrics": "डेवलपर एजेंट, GitHub और मेट्रिक्स",
    "Off": "बंद",
    "On": "चालू",
    "Dark": "डार्क",
    "Light": "लाइट",
    "New": "नई",
    "Not configured": "सेट नहीं",
    "Guest session": "गेस्ट सत्र",
    "Not connected": "जुड़ा नहीं",
    "Saved": "सहेजी गई",
    "Signed in": "साइन इन",
    "Public repos": "सार्वजनिक रेपो",
    "GitHub connected": "GitHub जुड़ा है",
    "Your account, email link and sign-in": "आपका खाता, ईमेल लिंक और साइन-इन",
    "Guest account on this browser. It has no sign-in email yet, so it only exists here. Link an email to use the same account on your phone or another browser.": "इस ब्राउज़र पर गेस्ट खाता। इसमें अभी साइन-इन ईमेल नहीं है, इसलिए यह सिर्फ़ यहीं है। अपने फ़ोन या किसी दूसरे ब्राउज़र पर यही खाता इस्तेमाल करने के लिए ईमेल जोड़ें।",
    "Link an email": "ईमेल जोड़ें",
    "Keeps this guest account — conversations, tasks and credits — and lets you sign in on your phone or another browser.": "यह गेस्ट खाता — बातचीत, कार्य और क्रेडिट — सुरक्षित रखता है, और आपको फ़ोन या दूसरे ब्राउज़र पर साइन इन करने देता है।",
    "Email": "ईमेल",
    "Password (8+ characters)": "पासवर्ड (8+ अक्षर)",
    "Link email": "ईमेल जोड़ें",
    "Or sign in to a different account": "या किसी दूसरे खाते में साइन इन करें",
    "Signing in switches this browser to that account. This guest account's data is not merged.": "साइन इन करने पर यह ब्राउज़र उस खाते पर चला जाएगा। इस गेस्ट खाते का डेटा उसमें नहीं मिलाया जाता।",
    "Password": "पासवर्ड",
    "Sign in": "साइन इन",
    "ZARVIS reads replies aloud with Gemini TTS. A voice request turns this on.": "ZARVIS Gemini TTS से जवाब बोलकर सुनाता है। वॉइस अनुरोध करने पर यह चालू हो जाता है।",
    "Sent with each speech request.": "हर बोलने के अनुरोध के साथ भेजी जाती है।",
    "Listening": "सुनना",
    "Starts only when you tap the orb or microphone. There is no wake word.": "सिर्फ़ तब शुरू होता है जब आप orb या माइक्रोफ़ोन को छूते हैं। कोई वेक वर्ड नहीं है।",
    "Gemini voice": "Gemini आवाज़",
    "Interface language and the locale sent with each request.": "इंटरफ़ेस की भाषा और हर अनुरोध के साथ भेजी जाने वाली भाषा।",
    "Long descriptions on some pages are still in English.": "कुछ pages के लंबे विवरण अभी English में हैं।",
    "Provider": "प्रदाता",
    "No AI provider is configured on this server, so answers are limited.": "इस सर्वर पर कोई AI प्रदाता सेट नहीं है, इसलिए जवाब सीमित हैं।",
    "Google Gemini is answering your requests.": "Google Gemini आपके अनुरोधों का जवाब दे रहा है।",
    "Couldn't reach the server to check.": "जाँचने के लिए सर्वर तक नहीं पहुँच सका।",
    "Tools": "टूल",
    "ZARVIS picks a skill when one fits — search, documents, writing, tasks or developer work — and shows the result in the chat.": "जब कोई स्किल ठीक बैठती है — खोज, डॉक्यूमेंट, लेखन, कार्य या डेवलपर काम — तो ZARVIS उसे चुनता है और नतीजा चैट में दिखाता है।",
    "Confirmations": "पुष्टि",
    "Higher-risk actions return a one-time confirmation for that exact action. Nothing runs until you approve it.": "ज़्यादा जोखिम वाले काम पर उसी काम के लिए एक बार की पुष्टि माँगी जाती है। आपकी मंज़ूरी के बिना कुछ नहीं चलता।",
    "Your current conversation is stored on the server with your account and restored on your devices.": "आपकी मौजूदा बातचीत आपके खाते के साथ सर्वर पर सहेजी जाती है और आपके डिवाइस पर वापस आ जाती है।",
    "Start fresh": "नए सिरे से शुरू करें",
    "Begins a new conversation. The previous one stays on the server.": "नई बातचीत शुरू करता है। पिछली बातचीत सर्वर पर बनी रहती है।",
    "New conversation": "नई बातचीत",
    "Long-term memory": "दीर्घकालिक मेमोरी",
    "ZARVIS doesn't keep a separate long-term memory profile in this version.": "इस संस्करण में ZARVIS अलग से दीर्घकालिक मेमोरी प्रोफ़ाइल नहीं रखता।",
    "Web notifications aren't used. Task status stays in Activity.": "वेब सूचनाएँ इस्तेमाल नहीं होतीं। कार्य की स्थिति गतिविधि में रहती है।",
    "On the web": "वेब पर",
    "On Android": "Android पर",
    "Reminders are delivered by Android. Reading or speaking your notifications needs Notification access, which you control in Permissions.": "रिमाइंडर Android भेजता है। आपकी सूचनाएँ पढ़ने या बोलने के लिए नोटिफ़िकेशन एक्सेस चाहिए, जिसे आप अनुमतियाँ में नियंत्रित करते हैं।",
    "Protections that are enforced": "लागू की गई सुरक्षाएँ",
    "One-time confirmations.": "एक बार की पुष्टि।",
    "Actions like opening a pull request need your approval of that exact action. It works once, for your account, for 10 minutes.": "pull request खोलने जैसे काम के लिए उसी काम की आपकी मंज़ूरी चाहिए। यह सिर्फ़ एक बार, आपके खाते के लिए और 10 मिनट तक चलती है।",
    "Your own GitHub identity.": "आपकी अपनी GitHub पहचान।",
    "The Developer Agent uses the token you connect, never a shared server token.": "डेवलपर एजेंट वही टोकन इस्तेमाल करता है जो आप जोड़ते हैं, कभी कोई साझा सर्वर टोकन नहीं।",
    "Voice.": "वॉइस।",
    "Listening starts from a tap. There is no wake word.": "सुनना छूने से शुरू होता है। कोई वेक वर्ड नहीं है।",
    "Files.": "फ़ाइलें।",
    "A document is read only after you attach it.": "डॉक्यूमेंट तभी पढ़ा जाता है जब आप उसे अटैच करते हैं।",
    "Permanently removes this account and its stored tasks and conversations from the server.": "इस खाते और उसके सहेजे गए कार्य व बातचीत को सर्वर से हमेशा के लिए हटा देता है।",
    "Delete account": "खाता हटाएँ",
    "Session": "सत्र",
    "Refresh tokens rotate on every use. If an old one is replayed, the session is ended for your safety.": "रिफ़्रेश टोकन हर उपयोग पर बदलते हैं। अगर कोई पुराना टोकन दोबारा इस्तेमाल हो, तो आपकी सुरक्षा के लिए सत्र खत्म कर दिया जाता है।",
    "Sign out": "साइन आउट",
    "Ends this browser's session on the server.": "सर्वर पर इस ब्राउज़र का सत्र खत्म करता है।",
    "Stored on the server": "सर्वर पर सहेजा गया",
    "Account, conversation, tasks, credits and, if connected, your encrypted GitHub token.": "खाता, बातचीत, कार्य, क्रेडिट और, अगर जुड़ा हो, आपका एन्क्रिप्टेड GitHub टोकन।",
    "Export": "एक्सपोर्ट",
    "Not available in this version.": "इस संस्करण में उपलब्ध नहीं।",
    "Delete": "हटाएँ",
    "Removes the account and its data.": "खाते और उसके डेटा को हटाता है।",
    "See your plan, credits and what each plan includes. Checkout isn't connected yet.": "अपना प्लान, क्रेडिट और हर प्लान में क्या शामिल है, देखें। चेकआउट अभी जुड़ा नहीं है।",
    "Open Plans": "प्लान खोलें",
    "Shows the Developer Agent and Metrics in the app. Off by default. This only changes what is shown: GitHub still needs your own connection, and every change still needs your confirmation.": "ऐप में डेवलपर एजेंट और मेट्रिक्स दिखाता है। डिफ़ॉल्ट में बंद। यह सिर्फ़ दिखने वाली चीज़ें बदलता है: GitHub के लिए अब भी आपका अपना कनेक्शन चाहिए, और हर बदलाव पर आपकी पुष्टि।",
    "Analyze a repository or request a confirmed implementation with your own GitHub account.": "अपने GitHub खाते से रिपॉज़िटरी का विश्लेषण करें या पुष्टि के बाद बदलाव करवाएँ।",
    "Latency, health and task counts for this session.": "इस सत्र की देरी, सेहत और कार्यों की गिनती।",
    "Usage & Metrics": "उपयोग और मेट्रिक्स",
    "Open": "खोलें",
    "Track your AI usage and performance on this device.": "इस डिवाइस पर अपना AI उपयोग और प्रदर्शन देखें।",
    "Conversation turns": "बातचीत के दौर",
    "AI requests": "AI अनुरोध",
    "Voice requests": "वॉइस अनुरोध",
    "Files read": "पढ़ी गई फ़ाइलें",
    "Developer runs": "डेवलपर रन",
    "Plan": "प्लान",
    "Response time": "जवाब का समय",
    "Last 20 requests": "पिछले 20 अनुरोध",
    "Response times appear here after your first request.": "पहले अनुरोध के बाद जवाब के समय यहाँ दिखेंगे।",
    "Average": "औसत",
    "Requests": "अनुरोध",
    "Success": "सफल",
    "Service": "सेवा",
    "AI provider": "AI प्रदाता",
    "Server": "सर्वर",
    "Online": "ऑनलाइन",
    "Recent requests": "हाल के अनुरोध",
    "No requests yet this session. Ask ZARVIS something in Chat.": "इस सत्र में अभी कोई अनुरोध नहीं। चैट में ZARVIS से कुछ पूछें।",
    "Response time per request": "हर अनुरोध का जवाब का समय",
    "Analyze a GitHub repository, or open a pull request after you approve the exact change.": "GitHub रिपॉज़िटरी का विश्लेषण करें, या सटीक बदलाव को मंज़ूर करने के बाद pull request खोलें।",
    "Idle": "खाली",
    "Generate Code": "कोड बनाएँ",
    "Apps, websites, scripts": "ऐप, वेबसाइट, स्क्रिप्ट",
    "Debug & Fix": "डीबग और सुधार",
    "Find and fix issues": "गड़बड़ियाँ ढूँढें और ठीक करें",
    "Explain Code": "कोड समझाएँ",
    "Understand any code": "कोई भी कोड समझें",
    "Create Project": "प्रोजेक्ट बनाएँ",
    "Full project setup": "पूरा प्रोजेक्ट सेटअप",
    "Repository": "रिपॉज़िटरी",
    "Analysis": "विश्लेषण",
    "Implement": "लागू करें",
    "History": "इतिहास",
    "Task": "कार्य",
    "Read-only report. Nothing is changed.": "सिर्फ़ पढ़ने वाली रिपोर्ट। कुछ नहीं बदलता।",
    "Change to implement": "लागू करने वाला बदलाव",
    "Implement & open PR": "लागू करें और PR खोलें",
    "You approve the exact action first. PRO plan and your own GitHub account.": "पहले आप सटीक काम को मंज़ूर करते हैं। PRO प्लान और आपका अपना GitHub खाता चाहिए।",
    "Result": "नतीजा",
    "Run Analyze or Implement to see the result here.": "नतीजा यहाँ देखने के लिए विश्लेषण या लागू करें चलाएँ।",
    "Pipeline": "पाइपलाइन",
    "Analyze": "विश्लेषण",
    "Read-only repository report": "सिर्फ़ पढ़ने वाली रिपॉज़िटरी रिपोर्ट",
    "Available": "उपलब्ध",
    "Part of Implement": "लागू करने का हिस्सा",
    "Included": "शामिल",
    "Pull request after approval": "मंज़ूरी के बाद pull request",
    "Verify": "जाँच",
    "No separate verification agent": "अलग जाँच एजेंट नहीं",
    "Not supported": "समर्थित नहीं",
    "Not connected. Public repositories can be analyzed anonymously; private repositories and pull requests need your own token.": "जुड़ा नहीं है। सार्वजनिक रिपॉज़िटरी का विश्लेषण बिना खाते के हो सकता है; निजी रिपॉज़िटरी और pull request के लिए आपका अपना टोकन चाहिए।",
    "Personal access token": "पर्सनल एक्सेस टोकन",
    "Stored encrypted and never shown again.": "एन्क्रिप्ट करके सहेजा जाता है और दोबारा नहीं दिखाया जाता।",
    "Connect GitHub": "GitHub जोड़ें",
    "Recent Analysis": "हाल का विश्लेषण",
    "No runs yet.": "अभी कोई रन नहीं।",
    "Start a developer task in chat": "चैट में डेवलपर कार्य शुरू करें",
    "Developer sections": "डेवलपर अनुभाग",
    "Developer stages": "डेवलपर चरण",
    "Describe a bounded change, e.g. add a README badge": "सीमित बदलाव बताएँ, जैसे README में बैज जोड़ना",
    "Analyze Repository": "रिपॉज़िटरी का विश्लेषण करें",
    "Your session has ended": "आपका सत्र खत्म हो गया है",
    "You were signed out on the server. ZARVIS did not create a new account for you.": "आपको सर्वर पर साइन आउट कर दिया गया था। ZARVIS ने आपके लिए कोई नया खाता नहीं बनाया।",
    "Or start a new, empty guest account on this browser.": "या इस ब्राउज़र पर एक नया, खाली गेस्ट खाता शुरू करें।",
    "Start a new guest account": "नया गेस्ट खाता शुरू करें",
    "Sign in to ZARVIS": "ZARVIS में साइन इन करें",
    "Your chats, credits and plan are saved to your own ZARVIS account on our server, so they follow you to any phone or browser.": "आपकी चैट, क्रेडिट और प्लान हमारे सर्वर पर आपके अपने ZARVIS खाते में सहेजे जाते हैं, इसलिए वे हर फ़ोन या ब्राउज़र पर आपके साथ रहते हैं।",
    "or use email": "या ईमेल इस्तेमाल करें",
    "Create account": "खाता बनाएँ",
    "Continue as guest": "गेस्ट के रूप में जारी रखें",
    "ZARVIS only receives your name, email and photo from Google — never your Gmail, Drive or contacts. Guest chats live only in this browser.": "ZARVIS को Google से सिर्फ़ आपका नाम, ईमेल और फ़ोटो मिलता है — आपका Gmail, Drive या कॉन्टैक्ट कभी नहीं। गेस्ट चैट सिर्फ़ इसी ब्राउज़र में रहती हैं।",
    "Close": "बंद करें",
    "Confirm": "पुष्टि करें",
    "Actions": "कार्य",
    "Pages": "पेज",
    "Results": "नतीजे",
    "Close search": "खोज बंद करें",
    "Search pages, features, settings and activity…": "पेज, फ़ीचर, सेटिंग और गतिविधि खोजें…",
    "No matches. Try a feature, page or setting name.": "कोई मेल नहीं मिला। किसी फ़ीचर, पेज या सेटिंग का नाम आज़माएँ।",
    "New chat": "नई चैट",
    "Start a fresh conversation": "नई बातचीत शुरू करें",
    "Start voice input": "वॉइस इनपुट शुरू करें",
    "Attach a file": "फ़ाइल अटैच करें",
    "Summarize a document or ask about an image": "डॉक्यूमेंट का सार लें या इमेज के बारे में पूछें",
    "Switch to Light appearance": "लाइट दिखावट पर जाएँ",
    "Switch to Dark appearance": "डार्क दिखावट पर जाएँ",
    "Switch to Light": "लाइट पर जाएँ",
    "Switch to Dark": "डार्क पर जाएँ",
    "Install ZARVIS": "ZARVIS इंस्टॉल करें",
    "Add to your home screen": "होम स्क्रीन पर जोड़ें",
    "Profile & account": "प्रोफ़ाइल और खाता",
    "Email link and sign in": "ईमेल लिंक और साइन इन",
    "Plans & credits": "प्लान और क्रेडिट",
    "Your plan and usage": "आपका प्लान और उपयोग",
    "Analyze a repository": "रिपॉज़िटरी का विश्लेषण",
    "Voice, language, privacy": "वॉइस, भाषा, गोपनीयता",
    "Guest account": "गेस्ट खाता",
    "Link an email in Profile to keep this account on other devices.": "इस खाते को दूसरे डिवाइस पर रखने के लिए प्रोफ़ाइल में ईमेल जोड़ें।",
    "Recent activity": "हाल की गतिविधि",
    "Open Activity": "गतिविधि खोलें",
    "All conversations and tasks": "सारी बातचीत और कार्य",
    "You're all caught up. New conversations, files and tasks show up here.": "सब कुछ देख लिया गया है। नई बातचीत, फ़ाइलें और कार्य यहाँ दिखेंगे।",
    "Copied": "कॉपी हो गया",
    "Reviewing the result…": "नतीजा देख रहा हूँ…",
    "Copy failed": "कॉपी नहीं हो सका",
    "Back online": "फिर से ऑनलाइन",
    "Developer access on": "डेवलपर एक्सेस चालू",
    "Developer access off": "डेवलपर एक्सेस बंद",
    "Spoken replies on": "बोलकर जवाब चालू",
    "Spoken replies off": "बोलकर जवाब बंद",
    "Dark appearance": "डार्क दिखावट",
    "Light appearance": "लाइट दिखावट",
    "Couldn't reach ZARVIS. Check your connection.": "ZARVIS तक नहीं पहुँच सका। कनेक्शन जाँचें।",
    "Couldn't update the task. Try again.": "कार्य अपडेट नहीं हो सका। फिर कोशिश करें।",
    "Documents": "डॉक्यूमेंट",
    "Web": "वेब",
    "Business": "बिज़नेस",
    "Creative": "क्रिएटिव",
    "Research": "रिसर्च",
    "Low risk": "कम जोखिम",
    "Medium risk": "मध्यम जोखिम",
    "High risk": "उच्च जोखिम",
    "Run": "चलाएँ",
    "Tap the orb or microphone to speak. No wake word.": "बोलने के लिए orb या माइक्रोफ़ोन को छूएँ। कोई वेक वर्ड नहीं।",
    "ZARVIS reads replies aloud with a natural voice.": "ZARVIS स्वाभाविक आवाज़ में जवाब बोलकर सुनाता है।",
    "Attach a photo or screenshot and ask about it.": "फ़ोटो या स्क्रीनशॉट अटैच करें और उसके बारे में पूछें।",
    "Creating images isn't part of this version.": "इमेज बनाना इस संस्करण का हिस्सा नहीं है।",
    "PDF, DOCX and text files — summarize or ask questions.": "PDF, DOCX और टेक्स्ट फ़ाइलें — सार लें या सवाल पूछें।",
    "Break a goal into steps and track its status in Activity.": "लक्ष्य को चरणों में बाँटें और उसकी स्थिति गतिविधि में देखें।",
    "Open apps, find contacts and place confirmed calls.": "ऐप खोलें, कॉन्टैक्ट ढूँढें और पुष्टि के बाद कॉल करें।",
    "A read-only report on a GitHub repository.": "GitHub रिपॉज़िटरी की सिर्फ़ पढ़ने वाली रिपोर्ट।",
    "Implement a change after you approve the exact action.": "सटीक काम को मंज़ूर करने के बाद बदलाव लागू करें।",
    "Messages, poems and brainstorms in the tone you ask for.": "आपके बताए लहजे में संदेश, कविताएँ और विचार।",
    "Customer replies, social posts and invoice drafts. Never sent.": "ग्राहक को जवाब, सोशल पोस्ट और इनवॉइस के ड्राफ्ट। कभी भेजे नहीं जाते।",
    "just now": "अभी अभी",
    "File": "फ़ाइल",
    "RUNNING": "चल रहा है",
    "PENDING": "लंबित",
    "PAUSED": "रुका हुआ",
    "DONE": "पूरा",
    "FAILED": "विफल",
    "CANCELLED": "रद्द",
    "running": "चल रहा है",
    "pending": "लंबित",
    "paused": "रुका हुआ",
    "done": "पूरा",
    "failed": "विफल",
    "cancelled": "रद्द",
    "Ready — ask about it in Chat": "तैयार — चैट में इसके बारे में पूछें",
    "Conversation started": "बातचीत शुरू हुई"
  };

  /* Strings with a changing part (a date, a number, a name). */
  var PATTERNS = [
    [new RegExp("^Ends (.+)$"), "समाप्त: $1"],
    [new RegExp("^Save (\\d+)%$"), "$1% बचाएँ"],
    [new RegExp("^Go to (.+)$"), "$1 पर जाएँ"],
    [new RegExp("^Voice: (.+)$"), "आवाज़: $1"],
    [new RegExp("^Run (.+)$"), "$1 चलाएँ"],
    [new RegExp("^Using (.+)…$"), "$1 का उपयोग हो रहा है…"],
    [new RegExp("^(\\d+)m ago$"), "$1 मिनट पहले"],
    [new RegExp("^(\\d+)h ago$"), "$1 घंटे पहले"]
  ];

  function normalise(text) {
    return String(text).replace(/\s+/g, " ").trim();
  }

  /** The Hindi for an exact (normalised) string or one of the patterns, else undefined. */
  function lookup(key) {
    if (Object.prototype.hasOwnProperty.call(HI, key)) return HI[key];
    for (var i = 0; i < PATTERNS.length; i++) {
      if (PATTERNS[i][0].test(key)) return key.replace(PATTERNS[i][0], PATTERNS[i][1]);
    }
    return undefined;
  }

  /** Translate the parts of "Open — Conversation" or "Chat · 2m ago"; undefined when no part is listed. */
  function lookupParts(key, separator) {
    if (key.indexOf(separator) < 0) return undefined;
    var changed = false;
    var parts = key.split(separator).map(function (part) {
      var out = lookup(part);
      if (out === undefined) return part;
      changed = true;
      return out;
    });
    return changed ? parts.join(separator) : undefined;
  }

  /** The Hindi for `text`, or `text` unchanged when there is none or the language is not "hi". */
  function translate(text, lang) {
    if (lang !== "hi" || typeof text !== "string") return text;
    var key = normalise(text);
    if (!key) return text;
    var out = lookup(key);
    if (out === undefined) out = lookupParts(key, " — ");
    if (out === undefined) out = lookupParts(key, " · ");
    if (out === undefined) return text;
    return text.match(/^\s*/)[0] + out + text.match(/\s*$/)[0];
  }

  /* ---------------- DOM side (browser only) ---------------- */
  var USER_CONTENT = ".bubble, #conversation, .task-goal, [data-user-text], textarea, input, select, option, script, style, svg, code, pre, #developer-result";
  var ATTRIBUTES = ["aria-label", "title", "placeholder"];
  var current = "en";
  var observer = null;
  var touched = new Set();

  function inUserContent(el) {
    return !el || !!(el.closest && el.closest(USER_CONTENT));
  }

  function localizeText(node) {
    if (inUserContent(node.parentElement)) return;
    var value = node.nodeValue;
    if (node.__zt !== undefined && value === node.__zt) return; // already translated
    var out = translate(value, "hi");
    if (out === value) return;
    node.__zi = value;
    node.__zt = out;
    node.nodeValue = out;
    touched.add(node);
  }

  /* An element's own label is interface text unless it sits inside something the user wrote. */
  function attributeIsUserContent(el) {
    return el.matches(".bubble, .task-goal, [data-user-text]") || inUserContent(el.parentElement);
  }

  function localizeAttribute(el, name) {
    if (attributeIsUserContent(el)) return;
    var value = el.getAttribute(name);
    if (value === null) return;
    var record = el.__za && el.__za[name];
    if (record && value === record.tr) return;
    var out = translate(value, "hi");
    if (out === value) return;
    (el.__za = el.__za || {})[name] = { orig: value, tr: out };
    el.setAttribute(name, out);
    touched.add(el);
  }

  function localizeTree(rootNode) {
    if (!rootNode) return;
    if (rootNode.nodeType === 3) return localizeText(rootNode);
    if (rootNode.nodeType !== 1) return;
    var walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) localizeText(node);
    var withAttributes = rootNode.querySelectorAll("[aria-label],[title],[placeholder]");
    var list = [rootNode].concat(Array.prototype.slice.call(withAttributes));
    for (var i = 0; i < list.length; i++) for (var j = 0; j < ATTRIBUTES.length; j++) localizeAttribute(list[i], ATTRIBUTES[j]);
  }

  function restoreAll() {
    touched.forEach(function (item) {
      if (item.nodeType === 3) {
        if (item.__zt !== undefined && item.nodeValue === item.__zt) item.nodeValue = item.__zi;
        delete item.__zi;
        delete item.__zt;
      } else if (item.__za) {
        for (var name in item.__za) if (item.getAttribute(name) === item.__za[name].tr) item.setAttribute(name, item.__za[name].orig);
        delete item.__za;
      }
    });
    touched.clear();
  }

  function onMutations(records) {
    if (current !== "hi") return;
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      if (record.type === "childList") {
        for (var j = 0; j < record.addedNodes.length; j++) localizeTree(record.addedNodes[j]);
      } else if (record.type === "characterData") {
        localizeText(record.target);
      } else if (record.type === "attributes") {
        localizeAttribute(record.target, record.attributeName);
      }
    }
    observer.takeRecords(); // our own writes are not news
  }

  function setHiOnly(on) {
    var nodes = document.querySelectorAll("[data-hi-only]");
    for (var i = 0; i < nodes.length; i++) nodes[i].hidden = !on;
  }

  /** Switch the interface language ("hi" or anything else for English). */
  function apply(lang) {
    current = lang === "hi" ? "hi" : "en";
    if (typeof document === "undefined") return;
    if (current === "hi") {
      if (!observer) observer = new MutationObserver(onMutations);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });
      localizeTree(document.body);
      observer.takeRecords();
    } else {
      if (observer) observer.disconnect();
      restoreAll();
    }
    setHiOnly(current === "hi");
  }

  return { translate: translate, apply: apply, entries: HI, patterns: PATTERNS };
});
