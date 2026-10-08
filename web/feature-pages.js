/* Capability detail pages. Copy is limited to skills that exist in this repository
   (see SKILLS.md). Rendered into #feature-root / #capability-hub by app.js. */
(function () {
  const CATALOG = [
    {
      id: "voice",
      category: "Voice",
      title: "Voice Assistant",
      summary: "Speak a request. ZARVIS transcribes it, responds, and can read the reply aloud.",
      availability: "Available now",
      kind: "now",
      what: "Voice is a way to start the same chat. Speech-to-text fills the request. A voice turn turns spoken replies on. You can turn them off in {{Settings → Voice|settings:voice}}.",
      why: "You can start a task without typing, including in Hindi or English.",
      how: ["Speak", "Understand", "AI decides", "Action or answer", "Voice response"],
      canDo: ["Tap the orb or microphone to start", "Tap again to stop listening", "Cancel a reply in progress with Stop", "See the state: Ready, Listening, Understanding, Speaking, or Error"],
      start: "Open Chat and tap the orb or the microphone. Listening starts only from that tap.",
      permissions: "The browser asks for microphone access the first time you tap Speak. ZARVIS does not listen in the background.",
      limits: ["There is no wake word and no continuous listening.", "Spoken replies must be turned on in {{Settings → Voice|settings:voice}}.", "Recognition quality depends on the device and browser."],
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
      cta: "View device access",
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
      start: "Open Developer Agent, paste a repository URL and run Analyze. Implement shows the exact pull request for your approval before anything is written.",
      permissions: "Implementation uses the protected developer workflow and your confirmation. Analysis does not change the repository.",
      limits: ["Implement needs a {{PRO plan|plans}} and your own {{connected GitHub account|developer}}.", "Nothing is merged automatically.", "The Android Developer screen is read-only analysis."],
      examples: ["Analyze this repository and tell me what needs fixing: ", "What is the build system of this repo?"],
      cta: "Open Developer Agent",
      action: "developer",
      prompt: "I want help with my GitHub project. I will provide the repository URL. Analyze it first and tell me what needs fixing.",
    },
  ];

  const ICONS = {
    voice: "i-mic", phone: "i-phone", research: "i-globe", documents: "i-file",
    creative: "i-pen", business: "i-briefcase", developer: "i-code",
  };

  /* Capabilities hub: grouped, one line per capability, each with an honest status and the
     real action that uses it. Actions are handled by app.js through data attributes:
       data-cap-action = chat | voice | attach | developer | settings | feature | page
       data-cap-page = view id (page action)
       data-cap-prompt = text placed in the composer (chat)
       data-feature-page = detail page id */
  const GROUPS = [
    { title: "AI", items: [
      { icon: "i-chat", name: "Conversation", short: "Ask anything, get answers", desc: "Ask anything in English, Hindi or Hinglish; follow-ups keep context.", status: ["Available", "ok"], action: ["chat", "Open"] },
      { icon: "i-globe", name: "Web search", short: "Live, sourced results", desc: "Live, sourced results when the provider can ground them.", status: ["Available", "ok"], action: ["chat", "Try"], prompt: "Search the web and cite the sources you use: ", feature: "research" },
      { icon: "i-search", name: "Research writing", short: "Compare, report, outline", desc: "Compare, report and outline — labelled when not from a live source.", status: ["Available", "ok"], action: ["chat", "Try"], prompt: "Compare these options and say which claims come from live search: ", feature: "research" },
    ] },
    { title: "Voice", items: [
      { icon: "i-mic", name: "Voice input", short: "Talk naturally", desc: "Tap the orb or microphone to speak. No wake word.", status: ["Available", "ok"], action: ["voice", "Talk"], feature: "voice" },
      { icon: "i-wave", name: "Spoken replies", short: "Hear replies aloud", desc: "ZARVIS reads replies aloud with a natural voice.", status: ["Available", "ok"], action: ["settings", "Settings"], settings: "voice", feature: "voice" },
    ] },
    { title: "Vision", items: [
      { icon: "i-image", name: "Image understanding", short: "Ask about photos", desc: "Attach a photo or screenshot and ask about it.", status: ["Available", "ok"], action: ["attach", "Upload"], feature: "documents" },
      { icon: "i-sparkle", name: "Image generation", short: "Not part of this version", desc: "Creating images isn't part of this version.", status: ["Not available", "off"] },
    ] },
    { title: "Files", items: [
      { icon: "i-file", name: "Document summaries", short: "PDF, Docs, text files", desc: "PDF, DOCX and text files — summarize or ask questions.", status: ["Available", "ok"], action: ["attach", "Upload"], feature: "documents" },
    ] },
    { title: "Automation", items: [
      { icon: "i-task", name: "Tracked tasks", short: "Plan goals in steps", desc: "Break a goal into steps and track its status on the Tasks page.", status: ["Status only", "info"], action: ["page", "Open"], page: "tasks" },
      { icon: "i-phone", name: "Phone Agent", short: "Android app actions", desc: "Open apps, find contacts and place confirmed calls.", status: ["Android app", "info"], action: ["feature", "Details"], feature: "phone" },
    ] },
    { title: "Developer", items: [
      { icon: "i-code", name: "Repository analysis", short: "Read-only repo report", desc: "A read-only report on a GitHub repository.", status: ["Available", "ok"], action: ["developer", "Open"], feature: "developer" },
      { icon: "i-github", name: "Pull requests", short: "Implement after approval", desc: "Implement a change after you approve the exact action.", status: ["PRO · approval", "warn"], action: ["developer", "Open"], feature: "developer" },
    ] },
    { title: "Productivity", items: [
      { icon: "i-pen", name: "Writing", short: "Messages, poems, ideas", desc: "Messages, poems and brainstorms in the tone you ask for.", status: ["Available", "ok"], action: ["chat", "Write"], prompt: "Write a warm, concise message about: ", feature: "creative" },
      { icon: "i-briefcase", name: "Business drafts", short: "Replies, posts, invoices", desc: "Customer replies, social posts and invoice drafts. Never sent.", status: ["Draft only", "ok"], action: ["chat", "Draft"], prompt: "Draft a polite customer reply to: ", feature: "business" },
    ] },
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

  function icon(id, extra) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "ico" + (extra ? " " + extra : ""));
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#" + id);
    svg.appendChild(use);
    return svg;
  }

  /* One medium colour per hub group; the detail pages use the same colour for their category. */
  const TONES = ["tone-blue", "tone-violet", "tone-pink", "tone-amber", "tone-green", "tone-cyan", "tone-coral"];
  const CATEGORY_TONES = {
    Voice: "tone-violet", Phone: "tone-green", "Web & Research": "tone-cyan",
    Documents: "tone-amber", Creative: "tone-pink", Business: "tone-coral", Developer: "tone-cyan",
  };
  /* Filter pills group the catalogue groups above. */
  const FILTERS = [
    { id: "all", label: "All" },
    { id: "ai", label: "AI", groups: ["AI"] },
    { id: "media", label: "Media", groups: ["Voice", "Vision", "Files"] },
    { id: "productivity", label: "Productivity", groups: ["Productivity"] },
    { id: "developer", label: "Developer", groups: ["Developer"] },
    { id: "automation", label: "Automation", groups: ["Automation"] },
  ];

  function filterFor(groupTitle) {
    const found = FILTERS.find((filter) => filter.groups && filter.groups.includes(groupTitle));
    return found ? found.id : "all";
  }

  /** options.developer: include the Developer group and filter (only while Developer access is on). */
  function renderHub(container, options) {
    const withDeveloper = !!(options && options.developer);
    const filters = FILTERS.filter((filter) => withDeveloper || filter.id !== "developer");
    container.replaceChildren();
    const pills = el("div", "cap-filters");
    pills.setAttribute("role", "group");
    pills.setAttribute("aria-label", "Filter capabilities");
    const grid = el("div", "cap-grid");
    for (const filter of filters) {
      const pill = el("button", "cap-pill" + (filter.id === "all" ? " active" : ""), filter.label);
      pill.type = "button";
      pill.dataset.capFilter = filter.id;
      pill.setAttribute("aria-pressed", String(filter.id === "all"));
      pill.addEventListener("click", () => {
        for (const other of pills.children) {
          other.classList.toggle("active", other === pill);
          other.setAttribute("aria-pressed", String(other === pill));
        }
        for (const card of grid.children) {
          card.hidden = filter.id !== "all" && card.dataset.capGroup !== filter.id;
        }
      });
      pills.appendChild(pill);
    }
    // A truthful tally of what the catalogue below says, by status.
    const counts = { ok: 0, warn: 0, info: 0, off: 0 };
    for (const group of GROUPS) {
      if (group.title === "Developer" && !withDeveloper) continue;
      for (const item of group.items) counts[item.status[1]] = (counts[item.status[1]] || 0) + 1;
    }
    const summary = el("div", "cap-summary");
    summary.setAttribute("role", "list");
    summary.setAttribute("aria-label", "Capabilities by status");
    for (const [kind, label] of [["ok", "ready now"], ["warn", "need your approval"], ["info", "limited or Android-only"], ["off", "not available"]]) {
      if (!counts[kind]) continue;
      const chip = el("span", "cap-sum");
      chip.dataset.kind = kind;
      chip.setAttribute("role", "listitem");
      chip.append(el("i", "cap-sum-dot"), el("strong", null, String(counts[kind])), document.createTextNode(" " + label));
      summary.appendChild(chip);
    }
    container.append(summary, pills, grid);

    GROUPS.forEach((group, groupIndex) => {
      if (group.title === "Developer" && !withDeveloper) return;
      group.items.forEach((item, index) => {
        const row = el("article", "cap-item " + TONES[groupIndex % TONES.length] + (item.status[1] === "off" ? " is-off" : ""));
        row.dataset.capGroup = filterFor(group.title);
        row.style.animationDelay = Math.min(index * 40 + groupIndex * 20, 240) + "ms";
        const ico = el("span", "row-ico " + TONES[groupIndex % TONES.length]);
        ico.appendChild(icon(item.icon));
        // The name/description opens the detail page when there is one.
        const copy = el(item.feature ? "button" : "div", "cap-copy");
        if (item.feature) {
          copy.type = "button";
          copy.dataset.capAction = "feature";
          copy.dataset.featurePage = item.feature;
          copy.title = "Open details";
        }
        const name = el("span", "cap-name");
        name.appendChild(el("span", null, item.name));
        // "Available" is the default; only notable states get a badge.
        if (item.status[0] !== "Available") name.appendChild(el("span", "z-badge z-badge-" + item.status[1], item.status[0]));
        copy.append(name, el("span", "cap-desc", item.short || item.desc));
        row.title = item.desc;
        row.append(ico, copy);
        if (item.action) {
          const btn = el("button", "cap-action", item.action[1]);
          btn.type = "button";
          btn.dataset.capAction = item.action[0];
          if (item.prompt) btn.dataset.capPrompt = item.prompt;
          if (item.feature) btn.dataset.featurePage = item.feature;
          if (item.page) btn.dataset.capPage = item.page;
          if (item.settings) btn.dataset.capSettings = item.settings;
          btn.setAttribute("aria-label", item.action[1] + " — " + item.name);
          row.appendChild(btn);
        }
        grid.appendChild(row);
      });
    });
  }

  function renderDetail(container, id, handlers) {
    const feature = CATALOG.find((item) => item.id === id);
    container.replaceChildren();
    const page = el("div", "feature-page");
    container.appendChild(page);
    const back = el("button", "icon-btn", "");
    back.type = "button";
    back.setAttribute("aria-label", "Back to Capabilities");
    back.appendChild(icon("i-left"));
    back.addEventListener("click", handlers.onBack);
    page.appendChild(back);
    if (!feature) {
      page.appendChild(el("p", "task-empty", "That capability is not available."));
      return;
    }

    const head = el("header", "feature-hero");
    const ico = el("span", "row-ico " + (CATEGORY_TONES[feature.category] || "tone-blue"));
    ico.appendChild(icon(ICONS[feature.id] || "i-sparkle"));
    const titles = el("div", "feature-hero-copy");
    titles.appendChild(el("p", "feature-kicker", feature.category));
    titles.appendChild(el("h1", "feature-title", feature.title));
    titles.appendChild(el("p", "feature-summary", feature.summary));
    const badge = el("span", badgeClass(feature.kind), feature.availability);
    titles.appendChild(badge);
    head.append(ico, titles);
    page.appendChild(head);

    const ctaRow = el("div", "feature-cta-row");
    const cta = el("button", "btn btn-primary feature-cta", feature.cta);
    cta.type = "button";
    cta.addEventListener("click", () => handlers.onPrimary(feature));
    ctaRow.appendChild(cta);
    page.appendChild(ctaRow);

    page.appendChild(section("What it does", feature.what));
    if (feature.canDo.length) page.appendChild(listSection("What you can do", feature.canDo));
    if (feature.phoneActions) page.appendChild(phoneList(feature.phoneActions));
    page.appendChild(prompts(feature, handlers));
    page.appendChild(steps("How it works", feature.how));
    const cols = el("div", "feature-cols");
    cols.appendChild(note("Permissions", feature.permissions));
    cols.appendChild(listSection("Limitations", feature.limits, true));
    page.appendChild(cols);
  }

  /** Fills `node` with `text`, turning each {{label|target}} into a button that goes to that page. */
  function rich(node, text) {
    for (const part of String(text).split(/(\{\{[^}]+\}\})/)) {
      const link = /^\{\{([^|}]+)\|([^}]+)\}\}$/.exec(part);
      if (link) {
        const button = el("button", "inline-link", link[1]);
        button.type = "button";
        button.dataset.go = link[2];
        node.appendChild(button);
      } else if (part) {
        node.appendChild(document.createTextNode(part));
      }
    }
    return node;
  }

  function section(title, body) {
    const block = el("section", "feature-block");
    block.appendChild(el("h2", "feature-block-title", title));
    block.appendChild(rich(el("p", "feature-block-body"), body));
    return block;
  }

  function listSection(title, items, asPanel) {
    const block = el("section", asPanel ? "panel feature-block" : "feature-block");
    block.appendChild(el("h2", "feature-block-title", title));
    const list = el("ul", "feature-list");
    for (const item of items) list.appendChild(rich(el("li"), item));
    block.appendChild(list);
    return block;
  }

  function steps(title, items) {
    const block = el("section", "feature-block");
    block.appendChild(el("h2", "feature-block-title", title));
    const list = el("ol", "feature-steps");
    for (const item of items) list.appendChild(rich(el("li"), item));
    block.appendChild(list);
    return block;
  }

  function note(title, body) {
    const block = el("section", "panel feature-block");
    block.appendChild(el("h2", "feature-block-title", title));
    block.appendChild(rich(el("p", "feature-block-body"), body));
    return block;
  }

  function phoneList(actions) {
    const block = el("section", "feature-block");
    block.appendChild(el("h2", "feature-block-title", "Supported phone actions"));
    const grid = el("div", "cap-grid");
    for (const action of actions) {
      const row = el("article", "cap-item" + (action.kind === "unsupported" ? " is-off" : ""));
      const copy = el("div", "cap-copy");
      const name = el("div", "cap-name");
      name.appendChild(el("span", null, action.title));
      name.appendChild(el("span", badgeClass(action.kind), action.availability));
      copy.append(name, el("p", "cap-desc", action.description + (action.example !== "—" ? " Example: “" + action.example + "”." : "")));
      copy.appendChild(el("p", "cap-desc", action.permission));
      row.appendChild(copy);
      grid.appendChild(row);
    }
    block.appendChild(grid);
    return block;
  }

  function prompts(feature, handlers) {
    const block = el("section", "feature-block");
    block.appendChild(el("h2", "feature-block-title", "Try asking"));
    const row = el("div", "chip-row");
    for (const prompt of feature.examples) {
      const button = el("button", "chip feature-prompt", prompt.trim());
      button.type = "button";
      button.addEventListener("click", () => handlers.onPrompt(feature, prompt));
      row.appendChild(button);
    }
    block.appendChild(row);
    return block;
  }

  window.ZarvisFeatures = {
    catalog: CATALOG,
    groups: GROUPS,
    renderHub: renderHub,
    renderDetail: renderDetail,
  };
})();
