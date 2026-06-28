const adminModes = {
  words: {
    title: "新增單字",
    listTitle: "最近單字",
    listEyebrow: "Vocabulary Store",
    englishLabel: "英文單字",
    chineseLabel: "中文意思",
    englishPlaceholder: "achievement",
    chinesePlaceholder: "成就",
    submitText: "儲存單字到 GAS",
    loadingText: "讀取 GAS 單字中",
    loadedText: "已載入 {count} 筆單字",
    savingText: "儲存單字到 GAS 中",
    emptyTitle: "還沒有 GAS 單字",
    emptyText: "設定 URL 後就能新增與讀取",
  },
  phrases: {
    title: "新增片語",
    listTitle: "最近片語",
    listEyebrow: "Phrase Store",
    englishLabel: "英文片語",
    chineseLabel: "中文意思",
    englishPlaceholder: "break the ice",
    chinesePlaceholder: "打破僵局",
    submitText: "儲存片語到 GAS",
    loadingText: "讀取 GAS 片語中",
    loadedText: "已載入 {count} 筆片語",
    savingText: "儲存片語到 GAS 中",
    emptyTitle: "還沒有 GAS 片語",
    emptyText: "切到新增片語後可寫入 Phrases 工作表",
  },
};

const adminElements = {
  connection: document.querySelector("#adminConnection"),
  modeTabs: [...document.querySelectorAll(".admin-tabs .tab-button")],
  title: document.querySelector("#adminTitle"),
  form: document.querySelector("#adminForm"),
  englishLabel: document.querySelector("#adminEnglishLabel"),
  englishInput: document.querySelector("#adminEnglishInput"),
  chineseLabel: document.querySelector("#adminChineseLabel"),
  chineseInput: document.querySelector("#adminChineseInput"),
  exampleField: document.querySelector("#adminExampleField"),
  exampleInput: document.querySelector("#adminExampleInput"),
  submit: document.querySelector("#adminSubmit"),
  submitText: document.querySelector("#adminSubmitText"),
  endpoint: document.querySelector("#gasEndpoint"),
  status: document.querySelector("#adminStatus"),
  refresh: document.querySelector("#refreshWords"),
  recentEyebrow: document.querySelector("#recentEyebrow"),
  recentTitle: document.querySelector("#recentTitle"),
  wordList: document.querySelector("#adminWordList"),
  emptyState: document.querySelector("#adminEmptyState"),
  emptyTitle: document.querySelector("#adminEmptyTitle"),
  emptyText: document.querySelector("#adminEmptyText"),
};

const adminState = {
  entries: {
    words: [],
    phrases: [],
  },
  activeMode: "words",
  gasUrl: "",
  isBusy: false,
};

function getAdminMode() {
  return adminModes[adminState.activeMode];
}

function getActiveEntries() {
  return adminState.entries[adminState.activeMode];
}

function setActiveEntries(entries) {
  adminState.entries[adminState.activeMode] = entries;
}

function cleanText(value) {
  return value.trim().replace(/\s+/g, " ");
}

async function loadConfig() {
  try {
    const response = await fetch("config.json", {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const config = await response.json();
    adminState.gasUrl = String(config.gasUrl || "").trim();
  } catch {
    adminState.gasUrl = "";
    setStatus("config.json 讀取失敗");
  }
}

function createLocalId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `entry-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeEntry(raw) {
  if (!raw) {
    return null;
  }

  const word = cleanText(String(raw.word || raw.phrase || raw.english || raw.en || ""));
  const meaning = cleanText(String(raw.meaning || raw.chinese || raw.zh || ""));
  const example = cleanText(String(raw.example || raw.sentence || raw.usage || ""));

  if (!word || !meaning) {
    return null;
  }

  const entry = {
    id: String(raw.id || createLocalId()),
    word,
    meaning,
    createdAt: raw.createdAt || "",
  };

  if (example) {
    entry.example = example;
  }

  return entry;
}

function setBusy(isBusy) {
  adminState.isBusy = isBusy;
  renderAdmin();
}

function setStatus(message) {
  adminElements.status.textContent = message;
}

function gasRequest(params) {
  return new Promise((resolve, reject) => {
    const callbackName = `wordspeakAdminGas${Date.now()}${Math.random().toString(16).slice(2)}`;
    const url = new URL(adminState.gasUrl);
    const script = document.createElement("script");

    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
    url.searchParams.set("callback", callbackName);

    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("GAS request timeout"));
    }, 12000);

    function cleanup() {
      window.clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = (payload) => {
      cleanup();
      resolve(payload);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("GAS request failed"));
    };

    script.src = url.toString();
    document.body.append(script);
  });
}

async function fetchEntries(mode = adminState.activeMode) {
  const payload = await gasRequest({
    action: "list",
    type: mode,
    _: Date.now().toString(),
  });

  if (payload?.ok === false) {
    throw new Error(payload.error || "GAS request failed");
  }

  if (!Array.isArray(payload) && mode === "phrases" && payload.type !== "phrases" && !payload.phrases) {
    return [];
  }

  const rows = Array.isArray(payload)
    ? payload
    : payload.data || payload.words || payload.phrases || [];
  return rows.map(normalizeEntry).filter(Boolean);
}

async function saveEntry(mode, entry) {
  const params = {
    action: "add",
    type: mode,
    meaning: entry.meaning,
  };

  if (mode === "phrases") {
    params.phrase = entry.word;
    params.example = entry.example;
  } else {
    params.word = entry.word;
  }

  const payload = await gasRequest(params);

  if (payload.ok === false) {
    throw new Error(payload.error || "GAS 儲存失敗");
  }

  return normalizeEntry(payload.data || payload.word || payload.phrase || payload) || {
    id: createLocalId(),
    word: entry.word,
    meaning: entry.meaning,
    example: entry.example,
  };
}

function renderAdmin() {
  const hasGas = Boolean(adminState.gasUrl);
  const mode = getAdminMode();
  const entries = getActiveEntries();
  const isPhraseMode = adminState.activeMode === "phrases";

  adminElements.modeTabs.forEach((tab) => {
    const isActive = tab.dataset.mode === adminState.activeMode;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });

  adminElements.connection.textContent = hasGas ? "GAS 已設定" : "GAS 未設定";
  adminElements.endpoint.textContent = hasGas ? adminState.gasUrl : "請先設定 config.json";
  adminElements.title.textContent = mode.title;
  adminElements.englishLabel.textContent = mode.englishLabel;
  adminElements.chineseLabel.textContent = mode.chineseLabel;
  adminElements.englishInput.placeholder = mode.englishPlaceholder;
  adminElements.chineseInput.placeholder = mode.chinesePlaceholder;
  adminElements.exampleField.classList.toggle("is-hidden", !isPhraseMode);
  adminElements.submitText.textContent = mode.submitText;
  adminElements.submit.disabled = !hasGas || adminState.isBusy;
  adminElements.refresh.disabled = !hasGas || adminState.isBusy;
  adminElements.recentEyebrow.textContent = mode.listEyebrow;
  adminElements.recentTitle.textContent = mode.listTitle;
  adminElements.emptyTitle.textContent = mode.emptyTitle;
  adminElements.emptyText.textContent = mode.emptyText;
  adminElements.wordList.innerHTML = "";
  adminElements.emptyState.style.display = entries.length ? "none" : "block";

  const fragment = document.createDocumentFragment();

  entries.slice(0, 30).forEach((entry) => {
    const item = document.createElement("li");
    item.className = "word-item admin-word-item";

    const number = document.createElement("div");
    number.className = "item-button static";
    number.textContent = "#";

    const content = document.createElement("div");
    content.className = "word-content static";

    const word = document.createElement("strong");
    word.lang = "en";
    word.textContent = entry.word;

    const meaning = document.createElement("span");
    meaning.lang = "zh-Hant";
    meaning.textContent = entry.meaning;

    content.append(word, meaning);

    if (entry.example) {
      const example = document.createElement("em");
      example.lang = "en";
      example.textContent = entry.example;
      content.append(example);
    }

    const date = document.createElement("div");
    date.className = "admin-date";
    date.textContent = formatDate(entry.createdAt);

    item.append(number, content, date);
    fragment.append(item);
  });

  adminElements.wordList.append(fragment);
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
  });
}

async function loadAdminEntries(mode = adminState.activeMode) {
  if (!adminState.gasUrl) {
    setStatus("尚未設定 GAS URL");
    renderAdmin();
    return;
  }

  setBusy(true);
  setStatus(adminModes[mode].loadingText);

  try {
    const entries = await fetchEntries(mode);
    adminState.entries[mode] = entries;
    setStatus(adminModes[mode].loadedText.replace("{count}", entries.length));
  } catch {
    setStatus("讀取 GAS 失敗，請確認部署權限與 URL");
  } finally {
    setBusy(false);
  }
}

async function switchAdminMode(mode) {
  if (!adminModes[mode] || mode === adminState.activeMode || adminState.isBusy) {
    return;
  }

  adminState.activeMode = mode;
  adminElements.form.reset();
  renderAdmin();
  await loadAdminEntries(mode);
}

adminElements.form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const word = cleanText(adminElements.englishInput.value);
  const meaning = cleanText(adminElements.chineseInput.value);
  const example = cleanText(adminElements.exampleInput.value);
  const mode = adminState.activeMode;

  if (!word || !meaning || adminState.isBusy) {
    return;
  }

  setBusy(true);
  setStatus(adminModes[mode].savingText);

  try {
    const saved = await saveEntry(mode, {
      word,
      meaning,
      example,
    });
    setActiveEntries([saved, ...getActiveEntries().filter((entry) => entry.id !== saved.id)]);
    adminElements.form.reset();
    adminElements.englishInput.focus();
    setStatus(`${saved.word} 已儲存`);
  } catch {
    setStatus("儲存失敗，請確認 GAS URL 與部署權限");
  } finally {
    setBusy(false);
  }
});

adminElements.refresh.addEventListener("click", () => loadAdminEntries());
adminElements.modeTabs.forEach((tab) => {
  tab.addEventListener("click", () => switchAdminMode(tab.dataset.mode));
});

renderAdmin();

async function initAdmin() {
  await loadConfig();
  renderAdmin();
  await loadAdminEntries();
}

initAdmin();
