let gasUrl = "";

const learningModes = {
  words: {
    title: "單字清單",
    eyebrow: "Practice Queue",
    emptyTitle: "清單是空的",
    emptyText: "請由管理員頁新增單字",
    hint: "字母 → 單字 → 中文",
    sequence: ["字母", "單字", "中文"],
    waitingKind: "等待單字",
    waitingText: "選擇單字後開始",
    readyStatus: "單字練習",
    doneStatus: "全部單字完成",
    randomDoneStatus: "隨機播放完成",
  },
  phrases: {
    title: "片語清單",
    eyebrow: "Phrase Queue",
    emptyTitle: "片語清單是空的",
    emptyText: "請由管理員頁新增片語",
    hint: "片語 → 中文",
    sequence: ["片語", "中文"],
    waitingKind: "等待片語",
    waitingText: "選擇片語後開始",
    readyStatus: "片語練習",
    doneStatus: "全部片語完成",
    randomDoneStatus: "隨機片語完成",
  },
};

const elements = {
  supportStatus: document.querySelector("#supportStatus"),
  syncStatus: document.querySelector("#syncStatus"),
  nowKind: document.querySelector("#nowKind"),
  nowText: document.querySelector("#nowText"),
  nowHint: document.querySelector("#nowHint"),
  modeTabs: [...document.querySelectorAll(".tab-button")],
  listEyebrow: document.querySelector("#listEyebrow"),
  listTitle: document.querySelector("#listTitle"),
  sequenceLabels: document.querySelector("#sequenceLabels"),
  englishVoice: document.querySelector("#englishVoice"),
  chineseVoice: document.querySelector("#chineseVoice"),
  letterRate: document.querySelector("#letterRate"),
  chineseRate: document.querySelector("#chineseRate"),
  loopPlayback: document.querySelector("#loopPlayback"),
  randomPlayback: document.querySelector("#randomPlayback"),
  playSelected: document.querySelector("#playSelected"),
  playAll: document.querySelector("#playAll"),
  stopSpeech: document.querySelector("#stopSpeech"),
  reloadWords: document.querySelector("#reloadWords"),
  reloadWordsLabel: document.querySelector("#reloadWordsLabel"),
  statusLine: document.querySelector("#statusLine"),
  wordList: document.querySelector("#wordList"),
  wordCount: document.querySelector("#wordCount"),
  emptyState: document.querySelector("#emptyState"),
  emptyStateTitle: document.querySelector("#emptyStateTitle"),
  emptyStateText: document.querySelector("#emptyStateText"),
};

const state = {
  entries: [],
  phraseEntries: [],
  activeMode: "words",
  selectedIds: {
    words: null,
    phrases: null,
  },
  voices: [],
  supportsSpeech: "speechSynthesis" in window,
  isSpeaking: false,
  activeId: null,
  playToken: 0,
};

function getModeConfig() {
  return learningModes[state.activeMode];
}

function getActiveEntries() {
  return state.activeMode === "phrases" ? state.phraseEntries : state.entries;
}

function getActiveSelectedId() {
  return state.selectedIds[state.activeMode];
}

function setActiveSelectedId(id) {
  state.selectedIds[state.activeMode] = id;
}

function getActiveSelectedEntry() {
  const selectedId = getActiveSelectedId();
  return getActiveEntries().find((entry) => entry.id === selectedId) ?? null;
}

function setSyncStatus(message) {
  elements.syncStatus.textContent = message;
}

function setNowPlaying(kind, text, hint = "") {
  elements.nowKind.textContent = kind;
  elements.nowText.textContent = text;
  elements.nowHint.textContent = hint || getModeConfig().hint;
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
    gasUrl = String(config.gasUrl || "").trim();
    setSyncStatus(gasUrl ? "GAS 已設定" : "GAS 未設定");
  } catch {
    gasUrl = "";
    setSyncStatus("config 讀取失敗");
  }
}

function createId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `word-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cleanText(value) {
  return value.trim().replace(/\s+/g, " ");
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
    id: String(raw.id || createId()),
    word,
    meaning,
  };

  if (example) {
    entry.example = example;
  }

  return entry;
}

function gasRequest(params) {
  return new Promise((resolve, reject) => {
    const callbackName = `wordspeakGas${Date.now()}${Math.random().toString(16).slice(2)}`;
    const url = new URL(gasUrl);
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

function getGasType(mode = state.activeMode) {
  return mode === "phrases" ? "phrases" : "words";
}

function setEntriesForMode(mode, entries) {
  if (mode === "phrases") {
    state.phraseEntries = entries;
    state.selectedIds.phrases = entries[0]?.id ?? null;
    return;
  }

  state.entries = entries;
  state.selectedIds.words = entries[0]?.id ?? null;
}

async function fetchGasEntries(mode = state.activeMode) {
  const payload = await gasRequest({
    action: "list",
    type: getGasType(mode),
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

function getSyncSummary() {
  return `GAS 單字 ${state.entries.length} / 片語 ${state.phraseEntries.length}`;
}

async function syncFromGas(mode = state.activeMode) {
  if (!gasUrl) {
    setSyncStatus("GAS 未設定");
    return;
  }

  const modeName = mode === "phrases" ? "片語" : "單字";
  setSyncStatus(`讀取 GAS ${modeName}`);

  try {
    const remoteEntries = await fetchGasEntries(mode);
    setEntriesForMode(mode, remoteEntries);
    if (state.activeMode === mode) {
      render();
      setNowPlaying(
        remoteEntries.length ? "已載入" : learningModes[mode].waitingKind,
        remoteEntries[0]?.word || `尚無${modeName}`,
        remoteEntries[0]?.meaning || learningModes[mode].emptyText,
      );
    }
    setSyncStatus(getSyncSummary());
  } catch {
    setSyncStatus(`GAS ${modeName}讀取失敗`);
  }
}

async function syncAllFromGas() {
  if (!gasUrl) {
    setSyncStatus("GAS 未設定");
    render();
    return;
  }

  setSyncStatus("讀取 GAS");

  try {
    const [wordEntries, phraseEntries] = await Promise.all([
      fetchGasEntries("words"),
      fetchGasEntries("phrases"),
    ]);
    setEntriesForMode("words", wordEntries);
    setEntriesForMode("phrases", phraseEntries);
    render();

    const activeEntry = getActiveSelectedEntry();
    const mode = getModeConfig();
    setNowPlaying(
      activeEntry ? "已載入" : mode.waitingKind,
      activeEntry?.word || mode.waitingText,
      activeEntry?.meaning || mode.emptyText,
    );
    setSyncStatus(getSyncSummary());
  } catch {
    setSyncStatus("GAS 讀取失敗");
    render();
  }
}

function renderSequence(labels) {
  elements.sequenceLabels.innerHTML = "";

  labels.forEach((label, index) => {
    if (index > 0) {
      const divider = document.createElement("i");
      divider.setAttribute("aria-hidden", "true");
      elements.sequenceLabels.append(divider);
    }

    const item = document.createElement("span");
    item.textContent = label;
    elements.sequenceLabels.append(item);
  });
}

function render() {
  const entries = getActiveEntries();
  const mode = getModeConfig();
  let selectedId = getActiveSelectedId();

  if (!selectedId && entries.length > 0) {
    selectedId = entries[0].id;
    setActiveSelectedId(selectedId);
  }

  if (!entries.some((entry) => entry.id === selectedId)) {
    selectedId = entries[0]?.id ?? null;
    setActiveSelectedId(selectedId);
  }

  elements.modeTabs.forEach((tab) => {
    const isActive = tab.dataset.mode === state.activeMode;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });

  elements.listEyebrow.textContent = mode.eyebrow;
  elements.listTitle.textContent = mode.title;
  elements.wordList.innerHTML = "";
  elements.wordCount.textContent = entries.length;
  elements.emptyState.style.display = entries.length ? "none" : "block";
  elements.emptyStateTitle.textContent = mode.emptyTitle;
  elements.emptyStateText.textContent = mode.emptyText;
  elements.playSelected.disabled = !state.supportsSpeech || !selectedId || state.isSpeaking;
  elements.playSelected.title =
    state.activeMode === "words" ? "播放目前單字" : "播放目前片語";
  elements.playAll.disabled = !state.supportsSpeech || entries.length === 0 || state.isSpeaking;
  elements.playAll.title =
    state.activeMode === "words" ? "播放全部單字" : "播放全部片語";
  elements.stopSpeech.disabled = !state.isSpeaking;
  elements.reloadWords.disabled = state.isSpeaking;
  elements.reloadWords.title =
    state.activeMode === "words" ? "重新載入單字" : "重新載入片語";
  elements.reloadWordsLabel.textContent = state.activeMode === "words" ? "載入單字" : "載入片語";
  elements.loopPlayback.disabled = state.isSpeaking;
  elements.randomPlayback.disabled = state.isSpeaking;
  renderSequence(mode.sequence);

  const fragment = document.createDocumentFragment();

  entries.forEach((entry) => {
    const item = document.createElement("li");
    item.className = "word-item learner-word-item";
    item.dataset.id = entry.id;

    if (entry.id === selectedId) {
      item.classList.add("is-selected");
    }

    if (entry.id === state.activeId) {
      item.classList.add("is-speaking");
    }

    const playButton = document.createElement("button");
    playButton.className = "item-button";
    playButton.type = "button";
    playButton.title = `播放 ${entry.word}`;
    playButton.setAttribute("aria-label", `播放 ${entry.word}`);
    playButton.textContent = "▶";
    playButton.disabled = !state.supportsSpeech || state.isSpeaking;
    playButton.addEventListener("click", (event) => {
      event.stopPropagation();
      setActiveSelectedId(entry.id);
      playEntry(entry);
    });

    const content = document.createElement("button");
    content.className = "word-content";
    content.type = "button";
    content.setAttribute("aria-label", `選取 ${entry.word}`);
    content.addEventListener("click", () => {
      setActiveSelectedId(entry.id);
      render();
      setStatus(`${entry.word} 已選取`);
      setNowPlaying("已選取", entry.word, entry.meaning);
    });

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

    item.append(playButton, content);
    fragment.append(item);
  });

  elements.wordList.append(fragment);
}

function setStatus(message) {
  elements.statusLine.textContent = message;
}

function setSpeaking(isSpeaking, activeId = null) {
  state.isSpeaking = isSpeaking;
  state.activeId = activeId;
  render();
}

function populateVoiceSelect(select, voices, preferredLangs) {
  const current = select.value;
  select.innerHTML = "";

  const auto = document.createElement("option");
  auto.value = "auto";
  auto.textContent = "自動選擇";
  select.append(auto);

  const filtered = voices.filter((voice) =>
    preferredLangs.some((lang) => voice.lang.toLowerCase().startsWith(lang)),
  );
  const list = filtered.length > 0 ? filtered : voices;

  list.forEach((voice) => {
    const option = document.createElement("option");
    option.value = voiceKey(voice);
    option.textContent = `${voice.name} (${voice.lang})`;
    select.append(option);
  });

  select.value = [...select.options].some((option) => option.value === current) ? current : "auto";
}

function voiceKey(voice) {
  return `${voice.name}::${voice.lang}`;
}

function refreshVoices() {
  if (!state.supportsSpeech) {
    elements.supportStatus.textContent = "不支援語音";
    elements.playSelected.disabled = true;
    elements.playAll.disabled = true;
    return;
  }

  state.voices = window.speechSynthesis.getVoices();
  populateVoiceSelect(elements.englishVoice, state.voices, ["en"]);
  populateVoiceSelect(elements.chineseVoice, state.voices, ["zh"]);
  elements.supportStatus.textContent = state.voices.length ? "語音可用" : "語音載入中";
}

function getVoice(select, preferredLangs) {
  if (select.value !== "auto") {
    return state.voices.find((voice) => voiceKey(voice) === select.value) ?? null;
  }

  return (
    state.voices.find((voice) =>
      preferredLangs.some((lang) => voice.lang.toLowerCase().startsWith(lang)),
    ) ?? null
  );
}

function speak(text, options) {
  return new Promise((resolve, reject) => {
    if (!state.supportsSpeech) {
      reject(new Error("Speech synthesis is not supported."));
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = options.lang;
    utterance.rate = Number(options.rate);
    utterance.pitch = options.pitch ?? 1;

    if (options.voice) {
      utterance.voice = options.voice;
    }

    if (typeof options.onStart === "function") {
      utterance.onstart = options.onStart;
    }

    utterance.onend = () => resolve();
    utterance.onerror = (event) => {
      if (event.error === "interrupted" || event.error === "canceled") {
        resolve();
        return;
      }

      reject(new Error(event.error));
    };

    window.speechSynthesis.speak(utterance);
  });
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getLetters(word) {
  return [...word].filter((character) => /[a-z0-9]/i.test(character));
}

function getLetterSpeechText(letter) {
  return `${letter.toUpperCase()},`;
}

function shuffleEntries(entries) {
  const shuffled = [...entries];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }

  return shuffled;
}

function getSpeechConfig() {
  const englishVoice = getVoice(elements.englishVoice, ["en-us", "en-gb", "en"]);
  const chineseVoice = getVoice(elements.chineseVoice, ["zh-tw", "zh-hk", "zh-cn", "zh"]);

  return {
    englishVoice,
    chineseVoice,
    englishLang: englishVoice?.lang || "en-US",
    chineseLang: chineseVoice?.lang || "zh-TW",
    letterRate: elements.letterRate.value,
    chineseRate: elements.chineseRate.value,
  };
}

async function playWordEntrySequence(entry, token, label = "") {
  const config = getSpeechConfig();
  const prefix = label ? `${label} ` : "";

  setActiveSelectedId(entry.id);
  state.activeId = entry.id;
  render();

  setStatus(`${prefix}拼讀 ${entry.word}`);
  const letters = getLetters(entry.word);

  for (const letter of letters) {
    if (token !== state.playToken) {
      return false;
    }

    const visibleLetter = letter.toUpperCase();
    setNowPlaying("字母", visibleLetter, entry.word);
    await speak(getLetterSpeechText(letter), {
      lang: config.englishLang,
      voice: config.englishVoice,
      rate: config.letterRate,
      pitch: 1.05,
      onStart: () => {
        if (token === state.playToken) {
          setNowPlaying("字母", visibleLetter, entry.word);
        }
      },
    });
    await wait(170);
  }

  if (token !== state.playToken) {
    return false;
  }

  await wait(180);
  setStatus(`${prefix}朗讀 ${entry.word}`);
  setNowPlaying("單字", entry.word, entry.meaning);
  await speak(entry.word, {
    lang: config.englishLang,
    voice: config.englishVoice,
    rate: 0.9,
    pitch: 1,
  });

  if (token !== state.playToken) {
    return false;
  }

  await wait(230);
  setStatus(`${prefix}中文 ${entry.meaning}`);
  setNowPlaying("中文", entry.meaning, entry.word);
  await speak(entry.meaning, {
    lang: config.chineseLang,
    voice: config.chineseVoice,
    rate: config.chineseRate,
    pitch: 1,
  });

  if (token !== state.playToken) {
    return false;
  }

  setStatus(`${prefix}${entry.word} 完成`);
  setNowPlaying("完成", entry.word, entry.meaning);
  return true;
}

async function playPhraseEntrySequence(entry, token, label = "") {
  const config = getSpeechConfig();
  const prefix = label ? `${label} ` : "";

  setActiveSelectedId(entry.id);
  state.activeId = entry.id;
  render();

  setStatus(`${prefix}朗讀片語 ${entry.word}`);
  setNowPlaying("片語", entry.word, entry.meaning);
  await speak(entry.word, {
    lang: config.englishLang,
    voice: config.englishVoice,
    rate: 0.84,
    pitch: 1,
  });

  if (token !== state.playToken) {
    return false;
  }

  await wait(240);
  setStatus(`${prefix}中文 ${entry.meaning}`);
  setNowPlaying("中文", entry.meaning, entry.word);
  await speak(entry.meaning, {
    lang: config.chineseLang,
    voice: config.chineseVoice,
    rate: config.chineseRate,
    pitch: 1,
  });

  if (token !== state.playToken) {
    return false;
  }

  setStatus(`${prefix}${entry.word} 完成`);
  setNowPlaying("完成", entry.word, entry.meaning);
  return true;
}

function playEntrySequence(entry, token, label = "") {
  if (state.activeMode === "phrases") {
    return playPhraseEntrySequence(entry, token, label);
  }

  return playWordEntrySequence(entry, token, label);
}

async function playEntry(entry) {
  if (!state.supportsSpeech) {
    setStatus("此瀏覽器不支援語音");
    return;
  }

  if (!entry || state.isSpeaking) {
    return;
  }

  const token = state.playToken + 1;
  state.playToken = token;
  setSpeaking(true, entry.id);

  try {
    await playEntrySequence(entry, token);
  } catch {
    setStatus("語音播放失敗");
  } finally {
    setSpeaking(false);
  }
}

async function playAllEntries() {
  if (!state.supportsSpeech) {
    setStatus("此瀏覽器不支援語音");
    return;
  }

  const entries = getActiveEntries();
  const mode = getModeConfig();

  if (state.isSpeaking || entries.length === 0) {
    return;
  }

  const token = state.playToken + 1;
  state.playToken = token;
  setSpeaking(true);

  try {
    const shouldLoop = elements.loopPlayback.checked;
    const shouldRandomize = elements.randomPlayback.checked;
    let round = 1;

    do {
      const queue = shouldRandomize ? shuffleEntries(entries) : [...entries];
      const modeName = shouldLoop
        ? shouldRandomize
          ? "循環隨機播放"
          : "循環播放"
        : shouldRandomize
          ? "隨機播放"
          : "順序播放";

      if (shouldLoop) {
        setStatus(`${modeName}第 ${round} 輪`);
      } else {
        setStatus(`${modeName}開始`);
      }

      for (const [index, entry] of queue.entries()) {
        if (token !== state.playToken) {
          return;
        }

        const label =
          shouldLoop
            ? `第 ${round} 輪 ${index + 1}/${queue.length} 個`
            : `第 ${index + 1}/${queue.length} 個`;
        const completed = await playEntrySequence(entry, token, label);
        if (!completed) {
          return;
        }

        if (index < queue.length - 1 || shouldLoop) {
          setStatus(`${entry.word} 完成，準備下一個`);
          await wait(520);
        }
      }

      round += 1;
    } while (shouldLoop && token === state.playToken);

    if (token === state.playToken) {
      setStatus(shouldRandomize ? mode.randomDoneStatus : mode.doneStatus);
    }
  } catch {
    setStatus("語音播放失敗");
  } finally {
    setSpeaking(false);
  }
}

function stopPlayback(message = "已停止") {
  state.playToken += 1;
  if (state.supportsSpeech) {
    window.speechSynthesis.cancel();
  }

  state.activeId = null;
  render();
  setStatus(message);
  setNowPlaying(message, "停止播放");
}

function switchMode(mode) {
  if (!learningModes[mode] || mode === state.activeMode) {
    return;
  }

  if (state.isSpeaking) {
    stopPlayback("切換分頁已停止播放");
  }

  state.activeMode = mode;
  state.activeId = null;
  render();

  const selectedEntry = getActiveSelectedEntry();
  const config = getModeConfig();
  setStatus(config.readyStatus);
  setNowPlaying(
    config.waitingKind,
    selectedEntry?.word || config.waitingText,
    selectedEntry?.meaning || config.hint,
  );
}

elements.playSelected.addEventListener("click", () => {
  const entry = getActiveSelectedEntry();
  playEntry(entry);
});

elements.playAll.addEventListener("click", playAllEntries);
elements.stopSpeech.addEventListener("click", () => stopPlayback());
elements.reloadWords.addEventListener("click", () => syncFromGas());
elements.modeTabs.forEach((tab) => {
  tab.addEventListener("click", () => switchMode(tab.dataset.mode));
});

if (state.supportsSpeech) {
  if (typeof window.speechSynthesis.addEventListener === "function") {
    window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);
  } else {
    window.speechSynthesis.onvoiceschanged = refreshVoices;
  }

  refreshVoices();
  window.setTimeout(refreshVoices, 250);
} else {
  elements.supportStatus.textContent = "不支援語音";
}

async function init() {
  render();
  const config = getModeConfig();
  const selectedEntry = getActiveSelectedEntry();
  setNowPlaying(
    "等待播放",
    selectedEntry?.word || config.waitingText,
    selectedEntry?.meaning || config.hint,
  );
  await loadConfig();
  await syncAllFromGas();
}

init();
