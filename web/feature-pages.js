/* Capability detail pages. Copy is limited to skills that exist in this repository
   (see SKILLS.md). Rendered into #feature-root / #capability-hub by app.js. */
(function () {
  const CATALOG = [
    {
      id: "workspace",
      category: "AI & Conversation",
      title: "AI Workspace",
      summary: "A conversation that can use the skills ZARVIS already ships.",
      availability: "Available now",
      kind: "now",
      what: "Chat in natural language. ZARVIS keeps the current conversation so follow-up questions stay in context, and it can hand a request to a skill such as search, documents, or writing.",
      why: "One workspace covers questions, writing, files, and tasks without a separate app for each.",
      how: ["You type or speak a request.", "ZARVIS replies in the same chat.", "When a skill fits, the result appears in the thread.", "You can ask a follow-up in the same conversation."],
      canDo: ["English, Hindi, and Hinglish", "Follow-up questions in the same conversation", "Attach a file and ask about it", "Start a request by voice from the orb or microphone"],
      start: "Open Chat and type a request, or tap a prompt below. Edit it before you send.",
      permissions: "No permission is required to type. The microphone is requested only after you tap Speak.",
      limits: ["Replies depend on the configured AI provider.", "ZARVIS does not browse your device files unless you attach one."],
      examples: ["Explain this document", "Research this topic", "Create a business plan", "Help me write this message"],
      cta: "Start Chat",
      action: "chat",
      prompt: "",
    },
    {
      id: "voice",
      category: "Voice",
      title: "Voice Assistant",
      summary: "Speak a request. ZARVIS transcribes it, responds, and can read the reply aloud.",
      availability: "Available now",
      kind: "now",
      what: "Voice is a way to start the same chat. Speech-to-text fills the request. Spoken replies are optional and stay off until you turn them on.",
      why: "You can start a task without typing, including in Hindi or English.",
      how: ["Speak", "Understand", "AI decides", "Action or answer", "Voice response"],
      canDo: ["Tap the orb or microphone to start", "Tap again to stop listening", "Cancel a reply in progress with Stop", "See the state: Ready, Listening, Understanding, Speaking, or Error"],
      start: "Open Chat and tap the orb or the microphone. Listening starts only from that tap.",
      permissions: "The browser asks for microphone access the first time you tap Speak. ZARVIS does not listen in the background.",
      limits: ["There is no wake word and no continuous listening.", "Spoken replies must be turned on in Settings → Voice.", "Recognition quality depends on the device and browser."],
      examples: ["What's on my task list?", "Summarize this in Hindi", "Draft a short reply to a customer"],
      cta: "Try Voice",
      action: "voice",
      prompt: "",
    },
    {
      id: "phone",
      category: "Phone",
      title: "Phone Agent",
      summary: "Control supported phone actions using natural language.",
      availability: "Android app",
      kind: "android",
      what: "Phone Agent runs on-device Android skills. It can open an installed app, look up a contact, and place a call after you confirm. It does not control every Android setting.",
      why: "Common phone actions stay in the same conversation as the rest of ZARVIS, on a device that can actually perform them.",
      how: ["You say or type a supported command on the Android app.", "ZARVIS matches an on-device skill.", "If the action needs a permission or confirmation, it asks first.", "The phone performs only that action."],
      canDo: [],
      start: "On the Android app, open Phone Agent and try a command below. The website cannot place calls or open your apps.",
      permissions: "Calls need the Phone permission. Looking up a contact by name also needs Contacts. Opening an app needs package visibility, not a runtime permission.",
      limits: ["These actions are Android-only.", "The website can show the commands. It cannot run them.", "Unsupported system controls are not presented as working buttons."],
      examples: ["Open WhatsApp", "Find Mom's number", "Call 9876543210"],
      cta: "Try Phone Agent",
      action: "phone",
      prompt: "Open WhatsApp",
      phoneActions: [
        { title: "Open apps", description: "Launch an installed app by name.", example: "Open WhatsApp", permission: "No runtime permission. The app must be installed.", availability: "Available now", kind: "now" },
        { title: "Find contacts", description: "Look up a contact's number by name.", example: "Find Mom's number", permission: "Requires Contacts permission.", availability: "Requires permission", kind: "permission" },
        { title: "Make calls", description: "Call a number or a saved contact. ZARVIS asks you to confirm before the call is placed.", example: "Call 9876543210", permission: "Requires Phone permission. A contact name also needs Contacts.", availability: "Requires permission", kind: "permission" },
        { title: "System settings", description: "Changing Wi-Fi, Bluetooth, or other system settings is not implemented.", example: "—", permission: "Not applicable.", availability: "Not supported", kind: "unsupported" },
      ],
    },
    {
      id: "research",
      category: "Web & Research",
      title: "Web & Research",
      summary: "Search, compare, and outline a topic from the chat workspace.",
      availability: "Available now",
      kind: "now",
      what: "Web search looks up live results through the backend. Research skills write a comparison, report, or outline from general knowledge and say when that answer is not live-sourced.",
      why: "You can ask for a short answer or a structured overview without leaving the conversation.",
      how: ["Ask a question in Chat.", "Search is used when the request needs live web information.", "Compare, report, and outline skills reason over general knowledge.", "Those replies are labeled when they are not from a live source."],
      canDo: ["Web search", "Compare information", "Structured report", "Research outline of questions worth investigating"],
      start: "Tap a prompt, add your topic, and send it from Chat.",
      permissions: "No device permission. Search uses the configured backend provider.",
      limits: ["Research compare, report, and outline are not live web fetches.", "Search results depend on the provider configured on the server."],
      examples: ["Search the web for the latest information about: ", "Research this topic and give me a structured overview: ", "Compare these options: "],
      cta: "Start Research",
      action: "chat",
      prompt: "Research this topic and give me a structured overview, key points, and questions worth investigating: ",
    },
    {
      id: "documents",
      category: "Documents",
      title: "Documents & Files",
      summary: "Attach a file and ask ZARVIS to summarize or explain it.",
      availability: "Available now",
      kind: "now",
      what: "You choose a file. ZARVIS reads the text and can summarize it or answer questions about that text in the same chat.",
      why: "A long document can be reduced to the points you need, in the language you ask for.",
      how: ["Tap the attach control in Chat.", "Choose a supported file.", "The file name appears above the composer.", "Send your question. The attachment is included with that message."],
      canDo: ["Summarize", "Explain important points", "Ask follow-up questions about the attached text"],
      start: "Open Chat, attach a file, and send a question such as “Summarize this.”",
      permissions: "The file picker opens only when you tap Attach. Nothing is read from your device before that.",
      limits: ["Supported types include PDF, DOCX, TXT, MD, CSV, JSON, and common images (PNG, JPEG, WEBP).", "The attachment is sent with the next message, then cleared.", "Summary quality follows the configured AI provider."],
      examples: ["Summarize this document in simple language", "What are the action items in this file?", "Explain the important numbers"],
      cta: "Analyze a File",
      action: "attach",
      prompt: "I will attach a document. Summarize it clearly and explain the important points in simple language.",
    },
    {
      id: "creative",
      category: "Creative",
      title: "Creative Studio",
      summary: "Draft messages, poems, and idea lists in the tone you ask for.",
      availability: "Available now",
      kind: "now",
      what: "Creative skills write a message, a poem, or a brainstorm from your prompt. They use the same chat as everything else.",
      why: "A first draft is faster to edit than to start from a blank page.",
      how: ["Describe what you want, including tone and length.", "ZARVIS drafts it in Chat.", "Ask for a revision in the next message."],
      canDo: ["Write a message", "Write a poem", "Brainstorm ideas"],
      start: "Start from a prompt below and edit the details before sending.",
      permissions: "No device permission.",
      limits: ["Drafts are generated text, not a published post or a sent message.", "Output follows the configured AI provider, or an honestly labeled fallback when no provider key is set."],
      examples: ["Write a warm birthday message for a friend", "Brainstorm names for a weekend project", "Write a short poem about rain"],
      cta: "Create Something",
      action: "chat",
      prompt: "Help me create something polished. Start by asking what I want to make, then draft it for me.",
    },
    {
      id: "business",
      category: "Business",
      title: "Business",
      summary: "Draft a social post, a customer reply, or an invoice from details you provide.",
      availability: "Available now",
      kind: "now",
      what: "Business skills that exist today: a social post, a customer reply, and an invoice draft parsed from line items you type.",
      why: "Everyday business writing starts from a structured draft you can copy and edit.",
      how: ["Say which draft you need.", "Include the facts: product, customer, or line items.", "Review the draft in Chat before you use it."],
      canDo: ["Social post draft", "Customer reply draft", "Invoice draft from line items you provide"],
      start: "Open Chat with a business prompt and replace the placeholder with your details.",
      permissions: "No device permission. Drafts are not sent to customers or posted anywhere.",
      limits: ["ZARVIS does not publish, email, or collect payment.", "The invoice draft is a document, not a filed invoice.", "Do not treat a draft as legal or tax advice."],
      examples: ["Write a social post about our new workshop", "Reply politely to a customer who asked for a refund update", "Draft an invoice for these items: "],
      cta: "Open Business Tools",
      action: "chat",
      prompt: "Help me with a business task. I want a polished customer reply, social post, or invoice draft.",
    },
    {
      id: "developer",
      category: "Developer",
      title: "Developer Agent",
      summary: "Read a repository, then change it only after you confirm.",
      availability: "Available now",
      kind: "now",
      what: "Repository analysis is read-only. Implementation can create a branch and a pull request on GitHub, and it requires an explicit confirmation. It does not merge.",
      why: "You can inspect a project from chat, and keep code changes behind a confirmation step.",
      how: ["Share a repository URL and ask for analysis.", "ZARVIS reports what it can see.", "A code change is a separate, confirmed action.", "Review the pull request before anything is merged."],
      canDo: ["Read-only repository analysis", "Confirmation required before implementation", "Pull request creation when that action is confirmed"],
      start: "On Android, open the Developer screen and run Analyze. On the web, start in Chat with the repository URL. This page does not run a change by itself.",
      permissions: "Implementation uses the protected developer workflow and your confirmation. Analysis does not change the repository.",
      limits: ["The Android Developer screen in this build is read-only analysis.", "The public web client does not expose a separate implement button on this page.", "Nothing is merged automatically."],
      examples: ["Analyze this repository and tell me what needs fixing: ", "What is the build system of this repo?"],
      cta: "Open Developer Agent",
      action: "developer",
      prompt: "I want help with my GitHub project. I will provide the repository URL. Analyze it first and tell me what needs fixing.",
    },
    {
      id: "tasks",
      category: "Automation",
      title: "Tasks & Automation",
      summary: "Create a trackable task, then pause, resume, cancel, or retry it.",
      availability: "Available now",
      kind: "now",
      what: "You can create a workflow task, list tasks, and cancel one by describing it. Activity shows status and the pause, resume, cancel, and retry controls.",
      why: "A multi-step goal stays visible after you leave the chat.",
      how: ["Describe the goal.", "ZARVIS creates a task you can open in Activity.", "Use Pause, Resume, Cancel, or Retry on that task.", "Creating a task does not mean each step has already run."],
      canDo: ["Create a tracked workflow", "List your tasks", "Cancel by describing the goal", "Pause, resume, and retry from Activity"],
      start: "Create a task from Chat, then review it in Activity.",
      permissions: "Uses your ZARVIS account. No extra device permission on the web.",
      limits: ["Creating a workflow stores and tracks the steps. It does not execute those steps.", "Reminders that fire on a schedule are an Android skill (personal.reminder), separate from workflow execution."],
      examples: ["Create a workflow for this goal and break it into clear steps: ", "Show my tasks", "Cancel my standup workflow"],
      cta: "Create a Task",
      action: "chat",
      prompt: "Create a workflow for this goal and break it into clear steps: ",
    },
  ];

  function badgeClass(kind) {
    if (kind === "permission") return "feature-badge feature-badge-permission";
    if (kind === "android") return "feature-badge feature-badge-android";
    if (kind === "unsupported") return "feature-badge feature-badge-unsupported";
    if (kind === "soon") return "feature-badge feature-badge-soon";
    return "feature-badge feature-badge-now";
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function renderHub(container) {
    container.replaceChildren();
    const groups = new Map();
    for (const feature of CATALOG) {
      if (!groups.has(feature.category)) groups.set(feature.category, []);
      groups.get(feature.category).push(feature);
    }
    for (const [category, features] of groups) {
      container.appendChild(el("h3", "capability-group-label", category));
      const grid = el("div", "feature-hub-grid");
      for (const feature of features) {
        const card = el("article", "feature-hub-card");
        const top = el("div", "feature-hub-top");
        top.appendChild(el("h4", "feature-hub-title", feature.title));
        top.appendChild(el("span", badgeClass(feature.kind), feature.availability));
        card.appendChild(top);
        card.appendChild(el("p", "feature-hub-summary", feature.summary));
        const open = el("button", "zarvis-btn zarvis-btn-primary feature-open-btn", "Open");
        open.type = "button";
        open.dataset.featurePage = feature.id;
        card.appendChild(open);
        grid.appendChild(card);
      }
      container.appendChild(grid);
    }
  }

  function renderDetail(container, id, handlers) {
    const feature = CATALOG.find((item) => item.id === id);
    container.replaceChildren();
    if (!feature) {
      container.appendChild(el("p", "task-empty", "That capability is not available."));
      return;
    }

    const head = el("div", "feature-hero");
    const back = el("button", "back-btn", "");
    back.type = "button";
    back.setAttribute("aria-label", "Back to Capabilities");
    back.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
    back.addEventListener("click", handlers.onBack);
    const titles = el("div", "feature-hero-copy");
    titles.appendChild(el("p", "feature-kicker", feature.category));
    titles.appendChild(el("h2", "feature-title", feature.title));
    titles.appendChild(el("p", "feature-summary", feature.summary));
    const badge = el("span", badgeClass(feature.kind), feature.availability);
    head.append(back, titles, badge);
    container.appendChild(head);

    container.appendChild(section("What it does", feature.what));
    container.appendChild(section("Why it is useful", feature.why));
    container.appendChild(steps("How it works", feature.how));
    if (feature.canDo.length) container.appendChild(listSection("What it can do", feature.canDo));
    if (feature.phoneActions) container.appendChild(phoneCards(feature.phoneActions));
    container.appendChild(section("How to start", feature.start));
    container.appendChild(note("Permissions", feature.permissions));
    container.appendChild(listSection("Limitations", feature.limits));
    container.appendChild(prompts(feature, handlers));

    const cta = el("button", "zarvis-btn zarvis-btn-primary feature-cta", feature.cta);
    cta.type = "button";
    cta.addEventListener("click", () => handlers.onPrimary(feature));
    container.appendChild(cta);
  }

  function section(title, body) {
    const block = el("section", "feature-block");
    block.appendChild(el("h3", "feature-block-title", title));
    block.appendChild(el("p", "feature-block-body", body));
    return block;
  }

  function listSection(title, items) {
    const block = el("section", "feature-block");
    block.appendChild(el("h3", "feature-block-title", title));
    const list = el("ul", "feature-list");
    for (const item of items) list.appendChild(el("li", null, item));
    block.appendChild(list);
    return block;
  }

  function steps(title, items) {
    const block = el("section", "feature-block");
    block.appendChild(el("h3", "feature-block-title", title));
    const list = el("ol", "feature-steps");
    for (const item of items) list.appendChild(el("li", null, item));
    block.appendChild(list);
    return block;
  }

  function note(title, body) {
    const block = el("section", "feature-note");
    block.appendChild(el("h3", "feature-block-title", title));
    block.appendChild(el("p", "feature-block-body", body));
    return block;
  }

  function phoneCards(actions) {
    const block = el("section", "feature-block");
    block.appendChild(el("h3", "feature-block-title", "Supported phone actions"));
    const grid = el("div", "feature-hub-grid");
    for (const action of actions) {
      const card = el("article", "feature-hub-card");
      const top = el("div", "feature-hub-top");
      top.appendChild(el("h4", "feature-hub-title", action.title));
      top.appendChild(el("span", badgeClass(action.kind), action.availability));
      card.appendChild(top);
      card.appendChild(el("p", "feature-hub-summary", action.description));
      card.appendChild(el("p", "feature-example", "Example: " + action.example));
      card.appendChild(el("p", "feature-permission", action.permission));
      grid.appendChild(card);
    }
    block.appendChild(grid);
    return block;
  }

  function prompts(feature, handlers) {
    const block = el("section", "feature-block");
    block.appendChild(el("h3", "feature-block-title", "Example prompts"));
    const row = el("div", "feature-prompts");
    for (const prompt of feature.examples) {
      const button = el("button", "quick-action feature-prompt", prompt);
      button.type = "button";
      button.addEventListener("click", () => handlers.onPrompt(feature, prompt));
      row.appendChild(button);
    }
    block.appendChild(row);
    return block;
  }

  window.ZarvisFeatures = {
    catalog: CATALOG,
    renderHub: renderHub,
    renderDetail: renderDetail,
  };
})();
