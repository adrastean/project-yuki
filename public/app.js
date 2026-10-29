import * as THREE from "/vendor/three.module.js";
import { GLTFLoader } from "/vendor/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "/vendor/three-vrm.module.js";
import { desktopIntent } from "/desktop-intents.js";
import { applyTranslations, getUiLanguage, setUiLanguage, t } from "/i18n.js";

// The interface locale is independent from Yuki's reply language.
// Arayüz dili, Yuki'nin yanıt dili ayarından bağımsızdır.
const messages = document.querySelector("#messages");
const form = document.querySelector("#chatForm");
const input = document.querySelector("#messageInput");
const sendButton = form.querySelector(".send-button");
const micButton = document.querySelector("#micButton");
const googleSearchButton = document.querySelector("#googleSearchButton");
const voiceNotice = document.querySelector("#voiceNotice");
const providerBadge = document.querySelector("#providerBadge");
const modelPreset = document.querySelector("#modelPreset");
const modelPresetStatus = document.querySelector("#modelPresetStatus");
const thinkingToggle = document.querySelector("#thinkingToggle");
const thinkingState = document.querySelector("#thinkingState");
const speechToggle = document.querySelector("#speechToggle");
const speechState = document.querySelector("#speechState");
const replyLanguage = document.querySelector("#replyLanguage");
const gpuModePerformance = document.querySelector("#gpuModePerformance");
const gpuModeQuality = document.querySelector("#gpuModeQuality");
// Use a tiny synthesized notification so no third-party sound recording is redistributed.
// Dışarıdan alınmış ses kaydı dağıtmak yerine kısa bildirim sesini anlık üret.
let replyAudioContext = null;
const conversationList = document.querySelector("#conversationList");
const newConversationButton = document.querySelector("#newConversationButton");
const newConversationWideButton = document.querySelector("#newConversationWideButton");
const projectList = document.querySelector("#projectList");
const projectSectionToggle = document.querySelector("#projectSectionToggle");
const computerFolderSectionToggle = document.querySelector("#computerFolderSectionToggle");
const addProjectButton = document.querySelector("#addProjectButton");
const addComputerFolderButton = document.querySelector("#addComputerFolderButton");
const computerFolderList = document.querySelector("#computerFolderList");
const approvalModeControl = document.querySelector("#approvalMode");
const appContent = document.querySelector(".app-content");
const avatarToggle = document.querySelector("#avatarToggle");
const avatarToggleState = document.querySelector("#avatarToggleState");
const avatarLoadStatus = document.querySelector("#avatarLoadStatus");
const cpuValue = document.querySelector("#cpuValue");
const cpuBar = document.querySelector("#cpuBar");
const ramValue = document.querySelector("#ramValue");
const ramBar = document.querySelector("#ramBar");
const gpuValue = document.querySelector("#gpuValue");
const gpuBar = document.querySelector("#gpuBar");
const vramValue = document.querySelector("#vramValue");
const uiLanguage = document.querySelector("#uiLanguage");
applyTranslations();
uiLanguage.value = getUiLanguage();
uiLanguage.addEventListener("change", () => {
  setUiLanguage(uiLanguage.value);
  setAvatarEnabled(avatarEnabled);
  updateGpuModeButtons();
  updateThinkingState();
  updateSpeechState();
  updateGoogleSearchButton();
  updateVoiceButton();
  if (alwaysListening) showVoiceNotice(t("localMicListening"));
  for (const copyButton of document.querySelectorAll(".copy-reply-button")) {
    copyButton.title = t("copyReply");
    copyButton.setAttribute("aria-label", t("copyReply"));
  }
  for (const duration of document.querySelectorAll(".thinking-duration[data-seconds]")) {
    duration.textContent = t("thoughtFor", { seconds: duration.dataset.seconds });
  }
  renderCurrentConversation();
  renderConversationList();
  renderProjectList();
  void refreshComputerFolderList();
  void loadStatus();
});
let voiceEnabled = localStorage.getItem("yuki-speech-enabled") !== "false";
let activeSpeechAudio = null;
let history = [];
let conversations = [];
let projects = [];
let currentConversationId = null;
let activeProjectId = localStorage.getItem("yuki-active-project") || null;
let conversationsReady = false;
let avatar = null;
let avatarEnabled = false;
let waitingForReply = false;
let activeChatController = null;
let researchMode = false;
let approvalMode = localStorage.getItem("yuki-approval-mode") === "auto" ? "auto" : "ask";
let alwaysListening = localStorage.getItem("yuki-always-listening") === "true";
let listening = false;
let listenAbortController = null;
let voiceLoopPromise = null;
const conversationStorageKey = "yuki-conversations-v1";
const projectStorageKey = "yuki-projects-v1";
const languagePreferenceSourceKey = "yuki-reply-language-source";

function setModelPresetStatus(text, state = "") {
  modelPresetStatus.textContent = text;
  if (state) modelPresetStatus.dataset.state = state;
  else delete modelPresetStatus.dataset.state;
}

async function initializeModelPreset() {
  const saved = localStorage.getItem("yuki-model-preset") === "code" ? "code" : "core";
  modelPreset.value = saved;
  const mainPreset = await window.yukiAgent?.ollamaModelPreset?.().catch(() => null);
  if (mainPreset?.preset) modelPreset.value = mainPreset.preset;
  localStorage.setItem("yuki-model-preset", modelPreset.value);
}

modelPreset.addEventListener("change", async () => {
  localStorage.setItem("yuki-model-preset", modelPreset.value);
  const labels = { core: "qwen2.5:7b", code: "qwen2.5-coder:7b" };
  setModelPresetStatus(t("modelLoading", { model: labels[modelPreset.value] }), "loading");
  try {
    const selected = await window.yukiAgent?.setOllamaModelPreset?.(modelPreset.value);
    setModelPresetStatus(selected?.model ? t("modelPreparing", { model: selected.model }) : t("modelSelected"), "loading");
  } catch (error) {
    setModelPresetStatus(error.message || t("modelSelectFailed"), "error");
  }
});
void initializeModelPreset();

function initializeCollapsibleSection(button, content, storageKey) {
  const saved = localStorage.getItem(storageKey);
  const setExpanded = (expanded) => {
    button.setAttribute("aria-expanded", String(expanded));
    content.hidden = !expanded;
    if (expanded) localStorage.setItem(storageKey, "true");
    else localStorage.setItem(storageKey, "false");
  };
  setExpanded(saved === null ? true : saved === "true");
  button.addEventListener("click", () => setExpanded(button.getAttribute("aria-expanded") !== "true"));
}

initializeCollapsibleSection(projectSectionToggle, projectList, "yuki-projects-expanded-v1");
initializeCollapsibleSection(computerFolderSectionToggle, computerFolderList, "yuki-computer-folders-expanded-v1");

function updateApprovalMode() {
  for (const button of approvalModeControl.querySelectorAll("[data-approval-mode]")) {
    button.setAttribute("aria-pressed", String(button.dataset.approvalMode === approvalMode));
  }
}

approvalModeControl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-approval-mode]");
  if (!button) return;
  approvalMode = button.dataset.approvalMode;
  localStorage.setItem("yuki-approval-mode", approvalMode);
  updateApprovalMode();
});
updateApprovalMode();

function renderResourceMeter(valueNode, barNode, percentage) {
  if (!Number.isFinite(percentage)) {
    valueNode.textContent = "—";
    barNode.style.width = "0%";
    barNode.parentElement.removeAttribute("aria-valuenow");
    return;
  }
  const value = Math.max(0, Math.min(100, Math.round(percentage)));
  valueNode.textContent = `${value}%`;
  barNode.style.width = `${value}%`;
  barNode.parentElement.setAttribute("aria-valuenow", String(value));
}

async function refreshResourceUsage() {
  if (!window.yukiAgent?.resourceUsage) return;
  try {
    const usage = await window.yukiAgent.resourceUsage();
    renderResourceMeter(cpuValue, cpuBar, usage.cpuPercent);
    renderResourceMeter(ramValue, ramBar, usage.ramPercent);
    renderResourceMeter(gpuValue, gpuBar, usage.gpuPercent);
    ramValue.title = t("ramUsed", { used: usage.ramUsedGb.toFixed(1), total: usage.ramTotalGb.toFixed(1) });
    if (Number.isFinite(usage.vramUsedMb) && Number.isFinite(usage.vramTotalMb)) {
      vramValue.textContent = t("totalVram", { used: (usage.vramUsedMb / 1024).toFixed(1), total: (usage.vramTotalMb / 1024).toFixed(1) });
      vramValue.title = t("gpuMemoryTooltip");
    } else {
      vramValue.textContent = t("vramUnavailable");
    }
  } catch (error) {
    console.warn("Sistem kullanım değerleri okunamadı.", error);
  }
}

void refreshResourceUsage();
setInterval(() => void refreshResourceUsage(), 5000);

function setAvatarEnabled(enabled) {
  avatarEnabled = Boolean(enabled);
  appContent.classList.toggle("avatar-visible", avatarEnabled);
  avatarToggle.setAttribute("aria-pressed", String(avatarEnabled));
  avatarToggleState.textContent = t(avatarEnabled ? "on" : "off");
  avatarToggle.title = t(avatarEnabled ? "hideAvatar" : "showAvatar");
  if (avatarEnabled && !avatar) {
    avatarLoadStatus.textContent = t("avatarLoading");
    avatarLoadStatus.hidden = false;
    avatar = createAvatar();
  }
  avatar?.setVisible?.(avatarEnabled);
  requestAnimationFrame(() => avatar?.setVisible?.(avatarEnabled));
}

avatarToggle.addEventListener("click", () => setAvatarEnabled(!avatarEnabled));

function approvalDescription(intent) {
  if (intent.type === "open-app") return t("actionOpenApp", { app: intent.app });
  if (intent.type === "search-files") return t("actionSearchFiles", { query: intent.query });
  if (intent.type === "read-file") return t("actionReadFile", { path: intent.path });
  if (intent.type === "open-file") return t("actionOpenFile", { path: intent.path });
  if (intent.type === "write-file") return t("actionWriteFile", { path: intent.path });
  if (intent.type === "google-search") return t("actionGoogleSearch", { query: intent.query });
  if (intent.type === "web-research") return t("actionResearch", { query: intent.query });
  return t("computerAction");
}

function requestActionApproval(intent, signal) {
  return new Promise((resolve) => {
    const card = document.createElement("div");
    card.className = "approval-request";
    const prompt = document.createElement("p");
    prompt.textContent = t("approveAction", { action: approvalDescription(intent) });
    const actions = document.createElement("div");
    actions.className = "approval-actions";
    const approve = document.createElement("button");
    approve.type = "button";
    approve.textContent = t("allow");
    approve.className = "approval-allow";
    const deny = document.createElement("button");
    deny.type = "button";
    deny.textContent = t("deny");
    actions.append(deny, approve);
    card.append(prompt, actions);
    messages.append(card);
    messages.scrollTop = messages.scrollHeight;
    window.yukiStatus?.update?.(t("waitingApproval"));
    let settled = false;
    const finish = (allowed) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      card.remove();
      resolve(allowed);
    };
    const onAbort = () => finish(false);
    approve.addEventListener("click", () => finish(true), { once: true });
    deny.addEventListener("click", () => finish(false), { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function detectRequestedLanguage(text) {
  const normalized = String(text).toLocaleLowerCase("tr-TR")
    .replace(/[ıİ]/g, "i")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(?:turkce|turkish)\s+(?:konus|cevap ver|yanit ver|devam et|konusmaya devam et)\b/.test(normalized)
    || /\b(?:speak|reply|answer|talk|continue)\s+(?:in\s+)?turkish\b/.test(normalized)
    || /\b(?:switch|change)\s+to\s+turkish\b/.test(normalized)
    || /\b(?:neden|niye|why)\b.{0,100}\b(?:turkce|turkish)\b.{0,60}\b(?:soylemedin|cevap vermedin|yanitlamadin|konusmadin|answer in|speak in)\b/.test(normalized)
    || /\b(?:turkce|turkish)\b.{0,80}\b(?:soylemedin|cevap vermedin|yanitlamadin|konusmadin)\b/.test(normalized)) return "tr";
  if (/\b(?:ingilizce|english)\s+(?:konus|cevap ver|yanit ver|devam et|konusmaya devam et)\b/.test(normalized)
    || /\b(?:speak|reply|answer|talk|continue)\s+(?:in\s+)?english\b/.test(normalized)
    || /\b(?:switch|change)\s+to\s+english\b/.test(normalized)) return "en";
  return null;
}

function restoreSpokenLanguagePreference() {
  if (localStorage.getItem(languagePreferenceSourceKey) === "manual") return;
  for (const message of [...history].reverse()) {
    if (message.role !== "user") continue;
    const language = detectRequestedLanguage(message.content);
    if (!language) continue;
    replyLanguage.value = language;
    localStorage.setItem("yuki-reply-language", language);
    localStorage.setItem(languagePreferenceSourceKey, "spoken");
    return;
  }
}

thinkingToggle.checked = localStorage.getItem("yuki-thinking") === "true";
speechToggle.checked = voiceEnabled;
replyLanguage.value = localStorage.getItem("yuki-reply-language") === "tr" ? "tr" : "en";
let gpuMode = localStorage.getItem("yuki-gpu-mode") === "performance" ? "performance" : "quality";
function updateGpuModeButtons() {
  const quality = gpuMode === "quality";
  gpuModePerformance.setAttribute("aria-pressed", String(!quality));
  gpuModeQuality.setAttribute("aria-pressed", String(quality));
  gpuModePerformance.title = t("performanceTooltip");
  gpuModeQuality.title = t("qualityTooltip");
}
gpuModePerformance.addEventListener("click", () => {
  gpuMode = "performance";
  localStorage.setItem("yuki-gpu-mode", gpuMode);
  updateGpuModeButtons();
});
gpuModeQuality.addEventListener("click", () => {
  gpuMode = "quality";
  localStorage.setItem("yuki-gpu-mode", gpuMode);
  updateGpuModeButtons();
});
updateGpuModeButtons();
replyLanguage.addEventListener("change", () => {
  localStorage.setItem("yuki-reply-language", replyLanguage.value);
  localStorage.setItem(languagePreferenceSourceKey, "manual");
});

function updateThinkingState() {
  thinkingState.textContent = t(thinkingToggle.checked ? "thinkingOnDetailed" : "thinkingOffFast");
}

thinkingToggle.addEventListener("change", () => {
  localStorage.setItem("yuki-thinking", String(thinkingToggle.checked));
  updateThinkingState();
});
updateThinkingState();

function updateSpeechState() {
  voiceEnabled = speechToggle.checked;
  speechState.textContent = t(voiceEnabled ? "voiceOn" : "voiceOff");
  speechToggle.title = t(voiceEnabled ? "voiceTitleOn" : "voiceTitleOff");
  localStorage.setItem("yuki-speech-enabled", String(voiceEnabled));
  if (!voiceEnabled) {
    activeSpeechAudio?.pause();
    activeSpeechAudio = null;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    avatar?.setTalking(false);
  }
}

speechToggle.addEventListener("change", updateSpeechState);
updateSpeechState();

function addMessage(role, text, { thinkingDurationMs = null } = {}) {
  document.querySelector("#emptyState")?.remove();
  const node = document.createElement("div");
  node.className = `message ${role}`;
  if (role === "yuki") {
    if (Number.isFinite(thinkingDurationMs) && thinkingDurationMs >= 1000) {
      const duration = document.createElement("small");
      duration.className = "thinking-duration";
      const seconds = new Intl.NumberFormat(getUiLanguage() === "tr" ? "tr-TR" : "en-US", { maximumFractionDigits: 1 }).format(thinkingDurationMs / 1000);
      duration.dataset.seconds = seconds;
      duration.textContent = t("thoughtFor", { seconds });
      node.append(duration);
    }
    const label = document.createElement("small");
    label.textContent = "Yuki";
    node.append(label);
  }
  node.append(document.createTextNode(text));
  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "copy-reply-button";
  copyButton.title = t("copyReply");
  copyButton.setAttribute("aria-label", t("copyReply"));
  copyButton.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.2" y="2.2" width="8.3" height="10.2" rx="1.5"/><path d="M10.7 13.8H3.5A1.5 1.5 0 0 1 2 12.3V4.8"/></svg>';
  copyButton.addEventListener("click", async () => {
    try {
      let copied = false;
      if (window.yukiAgent?.copyText) {
        try { copied = await window.yukiAgent.copyText(text) === true; } catch { /* Try the browser clipboard next. / Önce tarayıcı panosunu dene. */ }
      }
      if (!copied && navigator.clipboard?.writeText) {
        try { await navigator.clipboard.writeText(text); copied = true; } catch { /* Use the legacy selection fallback. / Eski seçim yöntemine geç. */ }
      }
      if (!copied) {
        const temporaryInput = document.createElement("textarea");
        temporaryInput.value = text;
        temporaryInput.style.position = "fixed";
        temporaryInput.style.opacity = "0";
        document.body.append(temporaryInput);
        temporaryInput.select();
        copied = document.execCommand("copy");
        temporaryInput.remove();
      }
      if (!copied) throw new Error("Clipboard copy failed");
      copyButton.title = t("copied");
      copyButton.setAttribute("aria-label", t("copied"));
      setTimeout(() => { copyButton.title = t("copyReply"); copyButton.setAttribute("aria-label", t("copyReply")); }, 1400);
    } catch {
      copyButton.title = t("copyFailed");
      copyButton.setAttribute("aria-label", t("copyFailed"));
      setTimeout(() => { copyButton.title = t("copyReply"); copyButton.setAttribute("aria-label", t("copyReply")); }, 1400);
    }
  });
  node.append(copyButton);
  messages.append(node);
  messages.scrollTop = messages.scrollHeight;
  return node;
}

function playReplySound() {
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  window.yukiAgent?.notifyBackgroundReply?.();
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    replyAudioContext ||= new AudioContextClass();
    const oscillator = replyAudioContext.createOscillator();
    const gain = replyAudioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(740, replyAudioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(520, replyAudioContext.currentTime + 0.13);
    gain.gain.setValueAtTime(0.0001, replyAudioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, replyAudioContext.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, replyAudioContext.currentTime + 0.2);
    oscillator.connect(gain).connect(replyAudioContext.destination);
    oscillator.start();
    oscillator.stop(replyAudioContext.currentTime + 0.21);
  } catch (error) {
    console.debug("Yuki notification sound could not play.", error);
  }
}

function addWebSources(messageNode, sources) {
  if (!Array.isArray(sources) || !sources.length) return;
  const section = document.createElement("div");
  section.className = "web-sources";
  const label = document.createElement("small");
  label.textContent = t("sources");
  section.append(label);
  for (const source of sources) {
    try {
      const url = new URL(source.url);
      if (url.protocol !== "https:") continue;
      const link = document.createElement("a");
      link.href = url.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = source.title || url.hostname;
      section.append(link);
    } catch {
      // Ignore malformed source URLs from the server response. / Sunucudan gelen hatalı kaynak adreslerini atla.
    }
  }
  if (section.querySelector("a")) messageNode.append(section);
  messages.scrollTop = messages.scrollHeight;
}

function addTypingIndicator() {
  document.querySelector("#emptyState")?.remove();
  const node = document.createElement("div");
  node.id = "typingIndicator";
  node.className = "message yuki typing";
  node.innerHTML = `<small>Yuki</small><span>${t("thinkingStatus")}<span class="typing-dots">...</span></span>`;
  messages.append(node);
  messages.scrollTop = messages.scrollHeight;
}

function removeTypingIndicator() {
  document.querySelector("#typingIndicator")?.remove();
}

function makeConversationId() {
  return window.crypto?.randomUUID?.() || `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanConversationMessages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((message) => message && (message.role === "user" || message.role === "assistant"))
    .map((message) => ({ role: message.role, content: String(message.content || "").trim() }))
    .filter((message) => message.content);
}

function conversationTitle(messagesForTitle) {
  const firstUserMessage = messagesForTitle.find((message) => message.role === "user")?.content;
  if (!firstUserMessage) return t("newChatTitle");
  const title = firstUserMessage.replace(/\s+/g, " ").trim();
  return title.length > 38 ? `${title.slice(0, 38).trim()}...` : title;
}

function normalizeConversation(value) {
  const messagesForConversation = cleanConversationMessages(value?.messages);
  const customTitle = Boolean(value?.customTitle && String(value?.title || "").trim());
  return {
    id: String(value?.id || makeConversationId()),
    title: customTitle ? String(value.title).trim().slice(0, 60) : conversationTitle(messagesForConversation),
    customTitle,
    preview: messagesForConversation.at(-1)?.content || t("blankChat"),
    updatedAt: value?.updatedAt || value?.createdAt || new Date().toISOString(),
    messages: messagesForConversation,
    projectId: typeof value?.projectId === "string" ? value.projectId : null
  };
}

function formatConversationDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const options = date.toDateString() === new Date().toDateString()
    ? { hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric" };
  return new Intl.DateTimeFormat(getUiLanguage() === "tr" ? "tr-TR" : "en-US", options).format(date);
}

function saveConversations() {
  try {
    localStorage.setItem(conversationStorageKey, JSON.stringify(conversations.slice(-80)));
    if (currentConversationId) localStorage.setItem("yuki-current-conversation", currentConversationId);
  } catch (error) {
    console.warn("Yuki conversation archive could not be saved.", error);
  }
}

function createConversationEntry(conversation, compact = false) {
  const item = document.createElement("div");
  item.className = `conversation-item${conversation.id === currentConversationId ? " active" : ""}${compact ? " project-conversation-item" : ""}`;
  const selectButton = document.createElement("button");
  selectButton.type = "button";
  selectButton.className = "conversation-select";
  selectButton.title = conversation.title;
  const title = document.createElement("span");
  title.className = "conversation-title";
  title.textContent = conversation.title;
  selectButton.append(title);
  if (!compact) {
    const preview = document.createElement("span");
    preview.className = "conversation-preview";
    preview.textContent = conversation.preview;
    const date = document.createElement("span");
    date.className = "conversation-date";
    date.textContent = formatConversationDate(conversation.updatedAt);
    selectButton.append(preview, date);
  }
  selectButton.addEventListener("click", () => selectConversation(conversation.id));
  item.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    openConversationMenu(event.clientX, event.clientY, conversation.id);
  });
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "conversation-delete";
  deleteButton.title = t("removeChat");
  deleteButton.setAttribute("aria-label", `${conversation.title} · ${t("removeChat")}`);
  deleteButton.textContent = "×";
  deleteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    deleteConversation(conversation.id);
  });
  item.append(selectButton, deleteButton);
  return item;
}

function renderProjectList() {
  projectList.replaceChildren();
  if (!projects.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty project-empty";
    empty.textContent = t("projectEmpty");
    projectList.append(empty);
    return;
  }
  for (const project of projects) {
    const group = document.createElement("section");
    group.className = "project-group";
    const row = document.createElement("div");
    row.className = `project-row${project.id === activeProjectId ? " active" : ""}`;
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openProjectMenu(event.clientX, event.clientY, project.id);
    });
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "project-open-button";
    openButton.title = project.path;
    openButton.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.8 4.4A1.4 1.4 0 0 1 3.2 3h3l1.4 1.5h5.2a1.4 1.4 0 0 1 1.4 1.4v5.5a1.4 1.4 0 0 1-1.4 1.4H3.2a1.4 1.4 0 0 1-1.4-1.4z"/></svg>';
    const name = document.createElement("span");
    name.textContent = project.name;
    openButton.append(name);
    openButton.addEventListener("click", () => {
      activeProjectId = project.id;
      localStorage.setItem("yuki-active-project", project.id);
      expandedProjectId = project.id;
      localStorage.setItem("yuki-expanded-project", project.id);
      const current = conversations.find((conversation) => conversation.id === currentConversationId);
      if (!current || current.projectId !== project.id) {
        if (current && !current.messages.length) {
          current.projectId = project.id;
          saveConversations();
        } else {
          saveCurrentConversation();
          createEmptyConversation(project.id);
        }
      }
      renderConversationList();
      input.focus();
    });
    const addChat = document.createElement("button");
    addChat.type = "button";
    addChat.className = "project-add-chat";
    addChat.textContent = "+";
    addChat.title = t("projectNewChat", { project: project.name });
    addChat.addEventListener("click", () => {
      activeProjectId = project.id;
      localStorage.setItem("yuki-active-project", project.id);
      expandedProjectId = project.id;
      localStorage.setItem("yuki-expanded-project", project.id);
      saveCurrentConversation();
      createEmptyConversation(project.id);
      input.focus();
    });
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "project-remove-button";
    removeButton.textContent = "×";
    removeButton.title = t("removeProject");
    removeButton.setAttribute("aria-label", `${project.name} · ${t("removeProject")}`);
    removeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      removeProject(project.id);
    });
    row.append(openButton, addChat, removeButton);
    group.append(row);
    if (expandedProjectId === project.id) {
      const chats = conversations.filter((conversation) => conversation.projectId === project.id)
        .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
      const chatList = document.createElement("div");
      chatList.className = "project-chat-list";
      if (chats.length) for (const conversation of chats) chatList.append(createConversationEntry(conversation, true));
      else {
        const empty = document.createElement("span");
        empty.className = "project-chat-empty";
        empty.textContent = t("noChats");
        chatList.append(empty);
      }
      group.append(chatList);
    }
    projectList.append(group);
  }
}

let expandedProjectId = localStorage.getItem("yuki-expanded-project") || activeProjectId;

function renderConversationList() {
  closeConversationMenu();
  conversationList.replaceChildren();
  const ordered = [...conversations]
    .filter((conversation) => conversation.messages.length && !conversation.projectId)
    .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
  if (!ordered.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = projects.length ? t("noIndependentChats") : t("noChats");
    conversationList.append(empty);
    renderProjectList();
    return;
  }
  for (const conversation of ordered) conversationList.append(createConversationEntry(conversation));
  renderProjectList();
}

let openMenu = null;

function closeConversationMenu() {
  openMenu?.remove();
  openMenu = null;
  document.removeEventListener("pointerdown", dismissConversationMenu, true);
  document.removeEventListener("keydown", dismissConversationMenu);
}

function dismissConversationMenu(event) {
  if (event.type === "keydown" && event.key !== "Escape") return;
  if (event.type === "pointerdown" && openMenu?.contains(event.target)) return;
  closeConversationMenu();
}

function openConversationMenu(x, y, id) {
  closeConversationMenu();
  const menu = document.createElement("div");
  menu.className = "conversation-context-menu";
  menu.setAttribute("role", "menu");
  const renameButton = document.createElement("button");
  renameButton.type = "button";
  renameButton.setAttribute("role", "menuitem");
  renameButton.textContent = t("renameChat");
  renameButton.addEventListener("click", () => {
    closeConversationMenu();
    renameConversation(id);
  });
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.setAttribute("role", "menuitem");
  deleteButton.textContent = t("removeChat");
  deleteButton.addEventListener("click", () => {
    closeConversationMenu();
    deleteConversation(id);
  });
  menu.append(renameButton, deleteButton);
  document.body.append(menu);
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
  openMenu = menu;
  document.addEventListener("pointerdown", dismissConversationMenu, true);
  document.addEventListener("keydown", dismissConversationMenu);
  renameButton.focus();
}

function openProjectMenu(x, y, id) {
  closeConversationMenu();
  const menu = document.createElement("div");
  menu.className = "conversation-context-menu";
  menu.setAttribute("role", "menu");
  const renameButton = document.createElement("button");
  renameButton.type = "button";
  renameButton.setAttribute("role", "menuitem");
  renameButton.textContent = t("renameProject");
  renameButton.addEventListener("click", () => {
    closeConversationMenu();
    renameProject(id);
  });
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.setAttribute("role", "menuitem");
  removeButton.textContent = t("removeProject");
  removeButton.addEventListener("click", () => {
    closeConversationMenu();
    removeProject(id);
  });
  menu.append(renameButton, removeButton);
  document.body.append(menu);
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
  openMenu = menu;
  document.addEventListener("pointerdown", dismissConversationMenu, true);
  document.addEventListener("keydown", dismissConversationMenu);
  renameButton.focus();
}

function renderCurrentConversation() {
  messages.replaceChildren();
  if (!history.length) {
    const emptyState = document.createElement("div");
    emptyState.id = "emptyState";
    emptyState.className = "empty-state";
    const orb = document.createElement("span");
    orb.className = "empty-orb";
    const title = document.createElement("p");
    title.textContent = t("greet");
    const subtitle = document.createElement("small");
    subtitle.textContent = t("yukiListening");
    emptyState.append(orb, title, subtitle);
    messages.append(emptyState);
    return;
  }
  for (const message of history) addMessage(message.role === "assistant" ? "yuki" : "user", message.content);
  if (waitingForReply) addTypingIndicator();
}

function saveCurrentConversation() {
  const current = conversations.find((conversation) => conversation.id === currentConversationId);
  if (!current || !history.length) return;
  current.messages = cleanConversationMessages(history);
  if (!current.customTitle) current.title = conversationTitle(current.messages);
  current.preview = current.messages.at(-1)?.content || t("blankChat");
  current.updatedAt = new Date().toISOString();
  saveConversations();
  renderConversationList();
}

function renameConversation(id) {
  if (waitingForReply) return;
  const conversation = conversations.find((item) => item.id === id);
  if (!conversation) return;
  const overlay = document.createElement("div");
  overlay.className = "rename-overlay";
  const dialog = document.createElement("form");
  dialog.className = "rename-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "renameDialogTitle");
  const heading = document.createElement("h2");
  heading.id = "renameDialogTitle";
  heading.textContent = t("renameChat");
  const label = document.createElement("label");
  label.htmlFor = "renameConversationInput";
  label.textContent = t("chatName");
  const nameInput = document.createElement("input");
  nameInput.id = "renameConversationInput";
  nameInput.maxLength = 60;
  nameInput.value = conversation.title;
  nameInput.autocomplete = "off";
  const actions = document.createElement("div");
  actions.className = "rename-actions";
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "rename-cancel";
  cancelButton.textContent = t("cancel");
  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.className = "rename-save";
  saveButton.textContent = t("save");
  actions.append(cancelButton, saveButton);
  dialog.append(heading, label, nameInput, actions);
  overlay.append(dialog);
  document.body.append(overlay);
  const close = () => overlay.remove();
  cancelButton.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
  dialog.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = nameInput.value.replace(/\s+/g, " ").trim().slice(0, 60);
    if (!title) {
      nameInput.focus();
      return;
    }
    conversation.title = title;
    conversation.customTitle = true;
    saveConversations();
    close();
    renderConversationList();
  });
  nameInput.focus();
  nameInput.select();
}

function renameProject(id) {
  if (waitingForReply) return;
  const project = projects.find((item) => item.id === id);
  if (!project) return;
  const overlay = document.createElement("div");
  overlay.className = "rename-overlay";
  const dialog = document.createElement("form");
  dialog.className = "rename-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  const heading = document.createElement("h2");
  heading.textContent = t("renameProject");
  const label = document.createElement("label");
  label.textContent = t("projectName");
  const nameInput = document.createElement("input");
  nameInput.maxLength = 60;
  nameInput.value = project.name;
  nameInput.autocomplete = "off";
  label.append(nameInput);
  const actions = document.createElement("div");
  actions.className = "rename-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = t("cancel");
  const save = document.createElement("button");
  save.type = "submit";
  save.className = "rename-save";
  save.textContent = t("save");
  actions.append(cancel, save);
  dialog.append(heading, label, actions);
  overlay.append(dialog);
  document.body.append(overlay);
  const close = () => overlay.remove();
  cancel.addEventListener("click", close);
  overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
  dialog.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
  dialog.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = nameInput.value.replace(/\s+/g, " ").trim().slice(0, 60);
    if (!name) { nameInput.focus(); return; }
    project.name = name;
    localStorage.setItem(projectStorageKey, JSON.stringify(projects));
    close();
    renderProjectList();
  });
  nameInput.focus();
  nameInput.select();
}

function removeProject(id) {
  if (waitingForReply) return;
  const project = projects.find((item) => item.id === id);
  if (!project) return;
  if (!window.confirm(t("removeProjectConfirm", { name: project.name }))) return;
  projects = projects.filter((item) => item.id !== id);
  for (const conversation of conversations) {
    if (conversation.projectId === id) conversation.projectId = null;
  }
  if (activeProjectId === id) {
    activeProjectId = null;
    localStorage.removeItem("yuki-active-project");
  }
  if (expandedProjectId === id) {
    expandedProjectId = null;
    localStorage.removeItem("yuki-expanded-project");
  }
  localStorage.setItem(projectStorageKey, JSON.stringify(projects));
  saveConversations();
  renderConversationList();
}

function createEmptyConversation(projectId = activeProjectId) {
  const conversation = normalizeConversation({ id: makeConversationId(), messages: [], projectId });
  conversations.push(conversation);
  currentConversationId = conversation.id;
  history = [];
  renderCurrentConversation();
  renderConversationList();
  saveConversations();
}

function startNewConversation() {
  if (waitingForReply) return;
  saveCurrentConversation();
  createEmptyConversation();
  input.focus();
}

function selectConversation(id) {
  if (waitingForReply) return;
  const selected = conversations.find((conversation) => conversation.id === id);
  if (!selected) return;
  saveCurrentConversation();
  currentConversationId = selected.id;
  activeProjectId = selected.projectId;
  expandedProjectId = selected.projectId || expandedProjectId;
  if (activeProjectId) localStorage.setItem("yuki-active-project", activeProjectId);
  else localStorage.removeItem("yuki-active-project");
  if (expandedProjectId) localStorage.setItem("yuki-expanded-project", expandedProjectId);
  history = cleanConversationMessages(selected.messages);
  renderCurrentConversation();
  renderConversationList();
  saveConversations();
  input.focus();
}

function deleteConversation(id) {
  if (waitingForReply) return;
  conversations = conversations.filter((conversation) => conversation.id !== id);
  if (id === currentConversationId) {
    const next = [...conversations].filter((conversation) => conversation.messages.length).sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt))[0];
    if (next) {
      currentConversationId = next.id;
      history = cleanConversationMessages(next.messages);
    } else {
      createEmptyConversation();
      return;
    }
  }
  renderCurrentConversation();
  renderConversationList();
  saveConversations();
}

async function initializeConversations() {
  input.disabled = true;
  sendButton.disabled = true;
  let stored = [];
  try {
    const parsedProjects = JSON.parse(localStorage.getItem(projectStorageKey) || "[]");
    projects = Array.isArray(parsedProjects) ? parsedProjects.filter((project) => project && typeof project.id === "string" && typeof project.name === "string" && typeof project.path === "string") : [];
  } catch {
    projects = [];
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(conversationStorageKey) || "[]");
    stored = Array.isArray(parsed) ? parsed.map(normalizeConversation) : [];
  } catch {
    stored = [];
  }
  conversations = stored;
  if (!conversations.length) {
    try {
      const response = await fetch("/api/conversations");
      const data = await response.json();
      if (response.ok && Array.isArray(data.conversations)) conversations = data.conversations.map(normalizeConversation);
    } catch (error) {
      console.warn("Yuki conversation archive could not be loaded.", error);
    }
  }
  const savedCurrentId = localStorage.getItem("yuki-current-conversation");
  const selected = conversations.find((conversation) => conversation.id === savedCurrentId)
    || [...conversations].sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt))[0];
  if (selected) {
    currentConversationId = selected.id;
    activeProjectId = selected.projectId;
    if (activeProjectId) expandedProjectId = activeProjectId;
    history = cleanConversationMessages(selected.messages);
  } else {
    createEmptyConversation(activeProjectId);
  }
  restoreSpokenLanguagePreference();
  conversationsReady = true;
  renderCurrentConversation();
  renderConversationList();
  saveConversations();
  input.disabled = false;
  sendButton.disabled = false;
}

newConversationButton.addEventListener("click", startNewConversation);
newConversationWideButton.addEventListener("click", startNewConversation);

addProjectButton.addEventListener("click", async () => {
  if (!window.yukiAgent || waitingForReply) return;
  addProjectButton.disabled = true;
  try {
    const folder = await window.yukiAgent.chooseProjectFolder();
    if (folder?.error) { showVoiceNotice(folder.error); return; }
    if (!folder?.folderPath) return;
    const existing = projects.find((project) => project.path.toLocaleLowerCase() === folder.folderPath.toLocaleLowerCase());
    const project = existing || { id: makeConversationId(), name: folder.folderName || "Yeni proje", path: folder.folderPath };
    if (!existing) {
      projects.push(project);
      localStorage.setItem(projectStorageKey, JSON.stringify(projects));
    }
    saveCurrentConversation();
    activeProjectId = project.id;
    expandedProjectId = project.id;
    localStorage.setItem("yuki-active-project", project.id);
    localStorage.setItem("yuki-expanded-project", project.id);
    createEmptyConversation(project.id);
    input.focus();
  } catch {
    showVoiceNotice(t("projectFolderAddFailed"));
  } finally {
    addProjectButton.disabled = false;
  }
});

async function refreshComputerFolderList() {
  if (!window.yukiAgent) return;
  const status = await window.yukiAgent.accessStatus();
  computerFolderList.replaceChildren();
  for (const folder of status.folders || []) {
    const row = document.createElement("div");
    row.className = "computer-access-row";
    const label = document.createElement("span");
    label.textContent = folder;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "computer-access-remove";
    remove.textContent = "×";
    remove.title = t("removeFolderAccess");
    remove.setAttribute("aria-label", `${t("removeFolderAccess")}: ${folder}`);
    remove.addEventListener("click", async () => {
      await window.yukiAgent.removeComputerFolder(folder);
      await refreshComputerFolderList();
    });
    row.append(label, remove);
    row.title = folder;
    computerFolderList.append(row);
  }
  if (!status.folders?.length) {
    const hint = document.createElement("small");
    hint.className = "computer-access-hint";
    hint.textContent = t("noFolders");
    computerFolderList.append(hint);
  }
}

addComputerFolderButton.addEventListener("click", async () => {
  if (!window.yukiAgent || waitingForReply) return;
  addComputerFolderButton.disabled = true;
  try {
    const selected = await window.yukiAgent.chooseComputerFolder();
    if (selected?.error) { showVoiceNotice(selected.error); return; }
    const status = await window.yukiAgent.accessStatus();
    await refreshComputerFolderList();
    if (!status.folders?.length) showVoiceNotice(t("noFolderAdded"));
  } catch {
    showVoiceNotice(t("computerFolderAddFailed"));
  } finally {
    addComputerFolderButton.disabled = false;
  }
});
refreshComputerFolderList();

function detectAvatarMood(userText, replyText) {
  const text = `${userText || ""} ${replyText || ""}`.toLowerCase();
  if (/(great|awesome|glad|happy|congrat|success|nice|fun|love|excited|good news)/i.test(text)) return "happy";
  if (/(sorry|sad|worried|problem|error|cannot|can't|unfortunately|failed)/i.test(text)) return "concerned";
  if (/(research|find|look up|check|explain|why|how|what|interesting|discover)/i.test(text)) return "curious";
  return "neutral";
}

function speak(text, audioBase64 = null, audioMime = "audio/mpeg") {
  if (!voiceEnabled) return Promise.resolve();
  if (audioBase64) {
    const audio = new Audio(`data:${audioMime};base64,${audioBase64}`);
    activeSpeechAudio = audio;
    return new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (activeSpeechAudio === audio) activeSpeechAudio = null;
        avatar?.setTalking(false);
        resolve();
      };
    audio.onplay = () => avatar?.setTalking(true);
      audio.onpause = finish;
      audio.onended = finish;
      audio.onerror = finish;
      audio.play().catch(finish);
    });
  }
  if (!("speechSynthesis" in window)) return Promise.resolve();
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 1.03;
  utterance.pitch = 1.32;
  const voices = speechSynthesis.getVoices();
  const femaleVoice = voices.find((voice) => /ava|aria|jenny|emma|samantha|zira|hazel|libby|sonia|female|woman/i.test(`${voice.name} ${voice.lang}`) && /^en[-_]/i.test(voice.lang));
  const englishVoice = voices.find((voice) => /^en[-_]/i.test(voice.lang) && !/male|david|mark|george|guy|alex/i.test(voice.name));
  utterance.voice = femaleVoice || englishVoice || null;
  if (!utterance.voice && !voices.length) return Promise.resolve();
  return new Promise((resolve) => {
    utterance.onstart = () => avatar?.setTalking(true);
    utterance.onend = () => { avatar?.setTalking(false); resolve(); };
    utterance.onerror = () => { avatar?.setTalking(false); resolve(); };
    speechSynthesis.speak(utterance);
  });
}

async function requestSpeech(text) {
  if (!voiceEnabled) return;
  try {
    const response = await fetch("/api/speak", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text })
    });
    const data = await response.json();
    if (data.audioBase64) await speak(text, data.audioBase64, data.audioMime);
    else await speak(text);
  } catch {
    await speak(text);
  }
}

async function runDesktopIntent(message) {
  if (!window.yukiAgent) return null;
  const intent = desktopIntent(message);
  if (!intent) return null;
  const turkish = replyLanguage.value === "tr";
  const errorReply = (message) => turkish ? message : `Sir, ${message}`;
  if (intent.type === "google-search") {
    const result = await window.yukiAgent.googleSearch(intent.query);
    return { reply: result.error ? errorReply(result.error) : t("searchedGoogle"), speak: true };
  }
  if (intent.type === "open-app") {
    const result = await window.yukiAgent.openApp(intent.app);
    const appNames = turkish ? { notepad: "Not Defteri'ni", calculator: "Hesap Makinesi'ni", explorer: "Dosya Gezgini'ni" } : null;
    return { reply: result.error ? errorReply(result.error) : t("openedApp", { app: turkish ? appNames?.[intent.app] || result.opened : result.opened }), speak: true };
  }
  if (intent.type === "read-file") {
    const result = await window.yukiAgent.readFile(intent.path);
    if (result.error) return { reply: errorReply(result.error), speak: false };
    const truncationNote = result.truncated ? "\n[File content shortened to fit the model context.]" : "";
    return { fileContext: `Local file ${result.rootName}/${result.relativePath}:\n${result.content}${truncationNote}` };
  }
  if (intent.type === "open-file") {
    const result = await window.yukiAgent.openFile(intent.path);
    return { reply: result.error ? errorReply(result.error) : t("openedFile", { file: result.opened }), speak: true };
  }
  if (intent.type === "write-file") {
    const result = await window.yukiAgent.saveFile(intent.path, intent.content);
    return { reply: result.error ? errorReply(result.error) : t("savedFile", { file: result.fileName }), speak: true };
  }
  const result = await window.yukiAgent.searchFiles(intent.query);
  if (result.error) return { reply: errorReply(result.error), speak: false };
  if (!result.matches?.length) return { reply: t("noFileMatches", { query: intent.query }), speak: false };
  const lines = result.matches.map((match) => `${match.file}\n${match.excerpt}`);
  const intro = t(result.matches.length === 1 ? "foundFilesOne" : "foundFilesMany", { count: result.matches.length });
  const limitNote = result.truncated ? `\n\n${t("searchLimit")}` : "";
  return { reply: `${intro}\n\n${lines.join("\n\n")}${limitNote}`, speak: false };
}

function updateGoogleSearchButton() {
  googleSearchButton.disabled = false;
  googleSearchButton.setAttribute("aria-pressed", String(researchMode));
  googleSearchButton.classList.toggle("research-active", researchMode);
  googleSearchButton.title = t(researchMode ? "researchOn" : "researchOff");
  googleSearchButton.setAttribute("aria-label", googleSearchButton.title);
}

updateGoogleSearchButton();

function describeTaskStatus(message, research) {
  const text = String(message || "").toLocaleLowerCase("tr-TR");
  if (research || /araştır|internette ara|web search|research|look up|find online|google|güncel|son dakika|kaynak/i.test(text)) return t("researchStatus");
  if (/kod|code|program|yazılım|debug|hata ayıkla|script|fonksiyon|function|component|repo|repository/i.test(text)) return t("codingStatus");
  if (thinkingToggle.checked || /mantık|karşılaştır|planla|çözümle|analiz|reason|logic|calculate|hesapla/i.test(text)) return t("reasoningStatus");
  return t("thinkingStatus");
}

googleSearchButton.addEventListener("click", () => {
  researchMode = !researchMode;
  updateGoogleSearchButton();
});

async function sendMessage(message, { research = false } = {}) {
  if (!conversationsReady || waitingForReply) return;
  waitingForReply = true;
  const taskStatus = describeTaskStatus(message, research);
  let workStartedAt = performance.now();
  window.yukiStatus?.update?.(taskStatus);
  voiceNotice.hidden = true;
  const previousHistory = history.slice(-12);
  addMessage("user", message);
  history.push({ role: "user", content: message });
  saveCurrentConversation();
  input.value = "";
  updateGoogleSearchButton();
  input.disabled = false;
  addTypingIndicator();
  const controller = new AbortController();
  activeChatController = controller;
  sendButton.dataset.busy = "true";
  sendButton.setAttribute("aria-label", t("stopReply"));
  sendButton.title = t("stopReply");
  sendButton.querySelector(".send-icon").textContent = "■";
  // Keep a generous timeout for online model responses. / İnternet modeli yanıtları için yeterli süre tanı.
  const replyTimeout = setTimeout(() => controller.abort(), 120000);
  try {
    const intent = research ? null : desktopIntent(message);
    const requestedAction = intent || (research ? { type: "web-research", query: message } : null);
    if (requestedAction && approvalMode === "ask") {
      window.yukiStatus?.update?.(t("confirmAction"));
      const approved = await requestActionApproval(requestedAction, controller.signal);
      if (controller.signal.aborted) throw new DOMException("Request cancelled", "AbortError");
      if (!approved) {
        removeTypingIndicator();
        window.yukiStatus?.update?.("");
        const reply = t("canceledAction");
        addMessage("yuki", reply);
        playReplySound();
        history.push({ role: "assistant", content: reply });
        saveCurrentConversation();
        return;
      }
    }
    workStartedAt = performance.now();
    window.yukiStatus?.update?.(taskStatus);
    if (research) window.yukiStatus?.update?.(t("researchStatus"));
    else if (intent?.type === "open-app") window.yukiStatus?.update?.(t("actionOpenApp", { app: intent.app }));
    else if (intent?.type === "search-files") window.yukiStatus?.update?.(t("actionSearchFiles", { query: intent.query }));
    else if (intent?.type === "read-file") window.yukiStatus?.update?.(t("actionReadFile", { path: intent.path }));
    else if (intent?.type === "open-file") window.yukiStatus?.update?.(t("actionOpenFile", { path: intent.path }));
    else if (intent?.type === "write-file") window.yukiStatus?.update?.(t("actionWriteFile", { path: intent.path }));
    else if (intent?.type === "google-search") window.yukiStatus?.update?.(t("actionGoogleSearch", { query: intent.query }));
    const intentResult = intent ? await runDesktopIntent(message) : null;
    const desktopReply = intentResult?.fileContext ? null : intentResult;
    const localFileContext = intentResult?.fileContext || null;
    if (controller.signal.aborted) throw new DOMException("Request cancelled", "AbortError");
    if (desktopReply) {
      removeTypingIndicator();
      window.yukiStatus?.update?.("");
      addMessage("yuki", desktopReply.reply, { thinkingDurationMs: performance.now() - workStartedAt });
      playReplySound();
      history.push({ role: "assistant", content: desktopReply.reply });
      saveCurrentConversation();
      // Keep folder excerpts local: do not send them to remote speech providers.
      // Klasör alıntılarını yerelde tut; uzak konuşma sağlayıcılarına gönderme.
      if (desktopReply.speak) void requestSpeech(desktopReply.reply);
      return;
    }
    const response = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ message, history: previousHistory, think: thinkingToggle.checked, language: replyLanguage.value, gpuMode, ollamaModel: modelPreset.value === "code" ? "qwen2.5-coder:7b" : "qwen2.5:7b", forceWeb: research, localContext: localFileContext }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t("sendFailed"));
    if (data.responseLanguage === "tr" || data.responseLanguage === "en") {
      replyLanguage.value = data.responseLanguage;
      localStorage.setItem("yuki-reply-language", data.responseLanguage);
      localStorage.setItem(languagePreferenceSourceKey, "spoken");
    }
    removeTypingIndicator();
    window.yukiStatus?.update?.("");
    const replyNode = addMessage("yuki", data.reply, { thinkingDurationMs: performance.now() - workStartedAt });
    playReplySound();
    addWebSources(replyNode, data.webSources);
    avatar?.setMood?.(detectAvatarMood(message, data.reply));
    if (data.mode === "provider-error") providerBadge.textContent = t("providerError");
    history.push({ role: "assistant", content: data.reply });
    saveCurrentConversation();
    void requestSpeech(data.reply);
  } catch (error) {
    removeTypingIndicator();
    if (error.name === "AbortError" && controller.signal.reason === "user-stop") {
      window.yukiStatus?.update?.("");
      saveCurrentConversation();
    } else {
      const lastMessage = history.at(-1);
      if (lastMessage?.role === "user" && lastMessage.content === message) history.pop();
      renderCurrentConversation();
      saveCurrentConversation();
      if (!input.value) input.value = message;
      showVoiceNotice(t("sendFailed"));
    }
  } finally {
    window.yukiStatus?.update?.("");
    clearTimeout(replyTimeout);
    waitingForReply = false;
    activeChatController = null;
    input.disabled = false;
    sendButton.disabled = false;
    delete sendButton.dataset.busy;
    sendButton.setAttribute("aria-label", t("send"));
    sendButton.title = t("send");
    sendButton.querySelector(".send-icon").textContent = "↑";
    updateVoiceButton();
    input.focus();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (activeChatController) {
    activeChatController.abort("user-stop");
    return;
  }
  const message = input.value.trim();
  if (message && !waitingForReply) {
    const research = researchMode;
    researchMode = false;
    updateGoogleSearchButton();
    sendMessage(message, { research });
  }
});

document.querySelectorAll("[data-window-action]").forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.windowAction;
    window.yukiWindow?.[action]?.();
  });
});
if (!window.yukiWindow) document.querySelector(".window-actions")?.remove();

function updateVoiceButton() {
  micButton.classList.toggle("voice-enabled", alwaysListening);
  micButton.setAttribute("aria-pressed", String(alwaysListening));
  if (waitingForReply) {
    micButton.title = t("alwaysListeningWait");
    input.placeholder = t("thinkingStatus");
  } else if (listening) {
    micButton.title = t("microphoneListening");
    input.placeholder = t("microphoneListening");
  } else if (alwaysListening) {
    micButton.title = t("alwaysListeningStop");
    input.placeholder = waitingForReply ? t("thinkingStatus") : t("voiceCommandHint");
  } else {
    micButton.title = t("alwaysListeningStart");
    input.placeholder = t("messagePlaceholder");
  }
}

function showVoiceNotice(text) {
  voiceNotice.textContent = text;
  voiceNotice.hidden = false;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function wakeCommand(text) {
  const match = String(text || "").trim().match(/^(?:(?:hey|okay|ok|yo)[,\s]+)?yuki\b[\s,:-]*(.*)$/i);
  return match ? match[1].trim() : null;
}

async function listenOnce() {
  if (!alwaysListening || waitingForReply || listening) return;
  listening = true;
  listenAbortController = new AbortController();
  micButton.classList.add("listening");
  updateVoiceButton();
  try {
    const response = await fetch("/api/listen", { method: "POST", signal: listenAbortController.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(t("localVoiceUnavailable"));
    const transcript = String(data.transcript || "").trim();
    if (transcript && alwaysListening && !waitingForReply) {
      const command = wakeCommand(transcript);
      if (command) {
        voiceNotice.hidden = true;
        input.value = command;
        await sendMessage(command);
      } else {
        showVoiceNotice(t("recognized", { text: transcript.slice(0, 90) }));
      }
    } else if (!transcript && alwaysListening) {
      showVoiceNotice(t("notRecognized"));
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      showVoiceNotice(t("voiceUnavailable"));
      setAlwaysListening(false);
    }
  } finally {
    listenAbortController = null;
    listening = false;
    micButton.classList.remove("listening");
    updateVoiceButton();
  }
}

async function runVoiceLoop() {
  if (voiceLoopPromise) return voiceLoopPromise;
  voiceLoopPromise = (async () => {
    while (alwaysListening) {
      if (waitingForReply) {
        updateVoiceButton();
        await wait(120);
        continue;
      }
      await listenOnce();
      if (alwaysListening) await wait(180);
    }
  })().finally(() => {
    voiceLoopPromise = null;
    updateVoiceButton();
  });
  return voiceLoopPromise;
}

function setAlwaysListening(enabled) {
  alwaysListening = Boolean(enabled);
  localStorage.setItem("yuki-always-listening", String(alwaysListening));
  if (alwaysListening) showVoiceNotice(t("localMicListening"));
  else voiceNotice.hidden = true;
  updateVoiceButton();
  if (!alwaysListening) listenAbortController?.abort();
  else void runVoiceLoop();
}

updateVoiceButton();
if (alwaysListening) showVoiceNotice(t("localMicListening"));
micButton.addEventListener("click", () => setAlwaysListening(!alwaysListening));

async function loadStatus() {
  const data = await fetch("/api/status").then((response) => response.json());
  const providerLabels = { ollama: "Ollama", "qlora-local": getUiLanguage() === "tr" ? "Yerel QLoRA testi" : "Local QLoRA test", gemini: "Gemini", "openai-compatible": getUiLanguage() === "tr" ? "OpenAI uyumlu" : "OpenAI-compatible" };
  const voiceLabelKeys = { "qwen3-tts": "voiceQwen", xtts: "voiceXtts", "edge-tts": "voiceEdge", elevenlabs: "voiceEleven", piper: "voicePiper", sapi: "voiceWindows", browser: "voiceBrowser" };
  providerBadge.textContent = `${providerLabels[data.provider.mode] || t("offline")} · ${t(voiceLabelKeys[data.voice?.mode] || "voiceBrowser")}`;
  thinkingToggle.disabled = data.provider.mode !== "ollama";
  modelPreset.disabled = data.provider.mode !== "ollama";
  gpuModePerformance.disabled = data.provider.mode !== "ollama";
  gpuModeQuality.disabled = data.provider.mode !== "ollama";
  thinkingToggle.title = t(data.provider.mode === "ollama" ? "thinkingTitle" : "thinkingOnlyOllamaTitle");
  if (thinkingToggle.disabled) thinkingState.textContent = t("thinkingOnlyOllama");
  else updateThinkingState();
  const ollamaState = await window.yukiAgent?.ollamaStartupStatus?.().catch(() => null);
  if (ollamaState && ["starting", "loading", "error"].includes(ollamaState.state)) {
    providerBadge.textContent = localizedOllamaStatus(ollamaState).toLocaleUpperCase();
  }
}

window.yukiAgent?.onOllamaStartupStatus?.((status) => {
  if (["starting", "loading", "error"].includes(status.state)) providerBadge.textContent = localizedOllamaStatus(status).toLocaleUpperCase();
  if (status.state === "loading") setModelPresetStatus(localizedOllamaStatus(status), "loading");
  else if (status.state === "ready") setModelPresetStatus(status.message);
  else if (status.state === "error") setModelPresetStatus(localizedOllamaStatus(status), "error");
  if (status.state === "ready") void loadStatus();
});

// Translate known local runtime states while leaving model names intact.
// Bilinen yerel çalışma durumlarını çevir, model adlarını olduğu gibi bırak.
function localizedOllamaStatus(status) {
  const model = status.message.match(/(?:qwen|llama)[\w:.-]*/i)?.[0] || "Ollama";
  if (status.state === "starting") return t("ollamaStarting");
  if (status.state === "loading") return t("modelLoadingMemory", { model });
  if (status.state === "ready") return t("ollamaReady", { model });
  if (/not installed|kurulu değil/i.test(status.message)) return t("modelNotInstalled", { model });
  if (/not found|bulamadım|kurulu olduğunu/i.test(status.message)) return t("ollamaMissing");
  if (/service stopped|servisi kapandı/i.test(status.message)) return t("ollamaStopped");
  if (/remote|uzak/i.test(status.message) && /connect|bağlan/i.test(status.message)) return t("remoteOllamaUnavailable");
  if (/could not connect|bağlanamadım|servis/i.test(status.message)) return t("ollamaUnavailable");
  return t("ollamaStartFailed");
}

function createProceduralAvatar() {
  const mount = document.querySelector("#avatarStage");
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(25, 1, 0.1, 100);
  camera.position.set(0, 0.04, 5.5);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  mount.append(renderer.domElement);
  const group = new THREE.Group();
  group.position.y = -.08;
  scene.add(group);

  scene.add(new THREE.AmbientLight(0xffeadc, 1.7));
  const key = new THREE.DirectionalLight(0xfff7ed, 3.2); key.position.set(-2.4, 3.6, 4.2); scene.add(key);
  const rim = new THREE.PointLight(0xffad7a, 7, 10); rim.position.set(2.2, .5, 2.6); scene.add(rim);
  const fill = new THREE.PointLight(0x8ca8ff, 2.2, 8); fill.position.set(-2, -.5, 2); scene.add(fill);

  const skin = new THREE.MeshStandardMaterial({ color: 0xffd8ce, roughness: .7 });
  const skinShade = new THREE.MeshStandardMaterial({ color: 0xe8a99f, roughness: .8 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x241c1a, roughness: .52, metalness: .04 });
  const hairLight = new THREE.MeshStandardMaterial({ color: 0x51362b, roughness: .48, metalness: .05 });
  const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xfffbf7, roughness: .32 });
  const iris = new THREE.MeshStandardMaterial({ color: 0x78b9c7, emissive: 0x183d48, emissiveIntensity: .42, roughness: .28 });
  const pupil = new THREE.MeshStandardMaterial({ color: 0x10141b, roughness: .25 });
  const eyeShine = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const dark = new THREE.MeshStandardMaterial({ color: 0x281a1c, roughness: .5 });
  const blazer = new THREE.MeshStandardMaterial({ color: 0x282a35, roughness: .72 });
  const blouse = new THREE.MeshStandardMaterial({ color: 0xf0e6dd, roughness: .7 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xb36b4c, roughness: .55, metalness: .12 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd7a65d, roughness: .35, metalness: .55 });

  const shoulders = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), blazer);
  shoulders.position.set(0, -1.48, -.02); shoulders.scale.set(1.48, .62, .62); group.add(shoulders);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.82, 1.05, 8, 20), blazer);
  torso.position.set(0, -1.52, .02); torso.scale.set(1.08, .83, .56); group.add(torso);
  const blousePanel = new THREE.Mesh(new THREE.CapsuleGeometry(.28, .68, 6, 16), blouse);
  blousePanel.position.set(0, -1.4, .49); blousePanel.scale.set(.9, 1, .22); group.add(blousePanel);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(.18, .23, .38, 20), skin);
  neck.position.set(0, -.82, .02); group.add(neck);
  const collarL = new THREE.Mesh(new THREE.BoxGeometry(.27, .42, .04), blouse); collarL.position.set(-.2, -.96, .5); collarL.rotation.z = -.34; group.add(collarL);
  const collarR = collarL.clone(); collarR.position.x = .2; collarR.rotation.z = .34; group.add(collarR);
  const tie = new THREE.Mesh(new THREE.CapsuleGeometry(.07, .34, 5, 12), accent); tie.position.set(0, -1.12, .57); tie.scale.set(1, 1, .35); group.add(tie);

  const head = new THREE.Mesh(new THREE.SphereGeometry(1.02, 48, 32), skin);
  head.position.set(0, .24, .02); head.scale.set(.92, 1.08, .8); group.add(head);
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(1.1, 48, 32, 0, Math.PI * 2, 0, Math.PI * .67), hair);
  hairCap.position.set(0, .55, -.05); hairCap.scale.set(1, 1.08, .93); group.add(hairCap);

  const movingHair = [];
  function hairLock(x, y, z, sx, sy, sz, rotation = 0, material = hair) {
    const lock = new THREE.Mesh(new THREE.SphereGeometry(.34, 24, 16), material);
    lock.position.set(x, y, z); lock.scale.set(sx, sy, sz); lock.rotation.z = rotation; group.add(lock); movingHair.push({ lock, base: rotation, x }); return lock;
  }
  hairLock(-.82, .12, .08, .42, 1.35, .5, -.13, hair);
  hairLock(.82, .12, .08, .42, 1.35, .5, .13, hair);
  hairLock(-.7, -.48, .18, .25, 1.25, .34, -.17, hairLight);
  hairLock(.7, -.48, .18, .25, 1.25, .34, .17, hairLight);

  const bangs = [];
  [-.56, -.3, 0, .3, .56].forEach((x, index) => {
    const lock = hairLock(x, .69 - Math.abs(x) * .08, .71, .24 - Math.abs(x) * .035, .62 + (index % 2) * .08, .22, x * -.13, index === 2 ? hairLight : hair);
    bangs.push(lock);
  });
  const clip = new THREE.Mesh(new THREE.TorusGeometry(.105, .024, 8, 18), gold);
  clip.position.set(-.7, .65, .8); clip.rotation.x = Math.PI / 2; clip.rotation.z = -.35; group.add(clip);
  const clipBar = new THREE.Mesh(new THREE.BoxGeometry(.22, .035, .035), gold);
  clipBar.position.set(-.7, .65, .82); clipBar.rotation.z = -.35; group.add(clipBar);

  function createEye(x) {
    const white = new THREE.Mesh(new THREE.SphereGeometry(.19, 24, 18), eyeWhite);
    white.position.set(x, .36, .72); white.scale.set(.8, 1.22, .48); group.add(white);
    const colored = new THREE.Mesh(new THREE.SphereGeometry(.112, 20, 16), iris);
    colored.position.set(x, .35, .86); colored.scale.set(.82, 1.18, .45); group.add(colored);
    const darkPupil = new THREE.Mesh(new THREE.SphereGeometry(.052, 16, 12), pupil);
    darkPupil.position.set(x, .35, .92); darkPupil.scale.set(.8, 1.2, .4); group.add(darkPupil);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(.027, 12, 10), eyeShine);
    shine.position.set(x - .035, .415, .965); group.add(shine);
    return { white, colored, darkPupil, shine };
  }
  const eyes = [createEye(-.34), createEye(.34)];
  const browL = new THREE.Mesh(new THREE.BoxGeometry(.25, .045, .035), dark); browL.position.set(-.34, .62, .76); browL.rotation.z = .08; group.add(browL);
  const browR = browL.clone(); browR.position.x = .34; browR.rotation.z = -.08; group.add(browR);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(.045, 14, 10), skinShade); nose.position.set(0, .16, .79); nose.scale.set(.7, .55, .32); group.add(nose);
  const cheekL = new THREE.Mesh(new THREE.SphereGeometry(.105, 16, 10), new THREE.MeshBasicMaterial({ color: 0xf19b9b, transparent: true, opacity: .26 })); cheekL.position.set(-.56, .08, .71); cheekL.scale.set(1.55, .42, .18); group.add(cheekL);
  const cheekR = cheekL.clone(); cheekR.position.x = .56; group.add(cheekR);
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(.105, 20, 14), dark); mouth.position.set(0, -.04, .79); mouth.scale.set(.78, .16, .26); group.add(mouth);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(.105, .018, 8, 18, Math.PI), accent); lip.position.set(0, -.025, .805); lip.rotation.z = Math.PI; lip.scale.set(.82, .55, 1); group.add(lip);

  let talking = false; let running = true; let visible = true; let t = 0; let blinkStart = -1; let nextBlink = 2.4;
  function resize() {
    const rect = mount.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(mount); resize();
  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    if (!visible) return;
    t += .016;
    if (blinkStart < 0 && !talking && t > nextBlink) { blinkStart = t; nextBlink = t + 2.8 + Math.random() * 3.8; }
    let blink = 0;
    if (blinkStart >= 0) {
      const elapsed = t - blinkStart;
      if (elapsed < .22) blink = Math.sin((elapsed / .22) * Math.PI);
      else blinkStart = -1;
    }
    const eyeFactor = 1 - blink * .94;
    for (const eyeSet of eyes) {
      eyeSet.white.scale.y = 1.22 * eyeFactor;
      eyeSet.colored.scale.y = 1.18 * eyeFactor;
      eyeSet.darkPupil.scale.y = 1.2 * eyeFactor;
      eyeSet.shine.scale.y = eyeFactor;
    }
    group.rotation.y = -.045 + Math.sin(t * .55) * .026;
    group.rotation.x = Math.sin(t * .7) * .008;
    group.position.y = -.08 + Math.sin(t * 1.15) * .018;
    for (const { lock, base, x } of movingHair) lock.rotation.z = base + Math.sin(t * .8 + x * 3) * .018;
    browL.rotation.z = .08 + Math.sin(t * .5) * .008;
    browR.rotation.z = -.08 - Math.sin(t * .5) * .008;
    mouth.scale.y = talking ? .22 + Math.abs(Math.sin(t * 15)) * .6 : .14;
    mouth.scale.x = talking ? .72 + Math.abs(Math.sin(t * 15)) * .14 : .78;
    lip.visible = !talking;
    renderer.render(scene, camera);
  }
  loop();
  return {
    setTalking(value) { talking = value; },
    setMood() {},
    setVisible(value) {
      visible = Boolean(value);
      renderer.domElement.style.display = visible ? "block" : "none";
      if (visible) resize();
    },
    resize,
    dispose() { running = false; renderer.dispose(); }
  };
}

function createAvatar() {
  let real = null;
  let talking = false;
  let mood = "neutral";
  let visible = true;
  const controller = {
    setTalking(value) {
      talking = Boolean(value);
      real?.setTalking(talking);
    },
    setMood(value) {
      mood = value || "neutral";
      real?.setMood(mood);
    },
    setVisible(value) {
      visible = Boolean(value);
      real?.setVisible(visible);
      if (visible) requestAnimationFrame(() => real?.resize?.());
    }
  };

  loadVrmAvatar()
    .then((loadedAvatar) => {
      real = loadedAvatar;
      real.setTalking(talking);
      real.setMood(mood);
      real.setVisible(visible);
      avatarLoadStatus.hidden = true;
    })
    .catch((error) => {
      console.error("Yuki's selected VRM could not be loaded.", error);
      if (avatar === controller) avatar = null;
      avatarLoadStatus.textContent = t("avatarLoadFailed", { error: error.message || t("checkAvatarFile") });
      avatarLoadStatus.hidden = !avatarEnabled;
    });

  return controller;
}

function loadVrmAvatar() {
  const mount = document.querySelector("#avatarStage");
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  return new Promise((resolve, reject) => {
    loader.load("/assets/yuki.vrm", (gltf) => {
      try {
      const vrm = gltf.userData.vrm;
      if (!vrm) {
        reject(new Error("The VRM file did not contain a character."));
        return;
      }

      if (vrm.meta?.metaVersion === "0") VRMUtils.rotateVRM0(vrm);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(29, 1, 0.05, 100);
      camera.position.set(0, 2.3, 3.0);
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.5));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = .88;
      mount.append(renderer.domElement);

      scene.add(new THREE.HemisphereLight(0xffeee5, 0x1b1a23, 1.45));
      const key = new THREE.DirectionalLight(0xfff5e9, 3.4);
      key.position.set(-2.5, 4.2, 5);
      scene.add(key);
      key.intensity = 2.35;
      const faceFill = new THREE.DirectionalLight(0xffe8df, .75);
      faceFill.position.set(0, 2.4, 4.5);
      scene.add(faceFill);
      const warm = new THREE.PointLight(0xffb17d, 1.45, 8);
      warm.position.set(2.2, 1.1, 2.8);
      scene.add(warm);
      scene.add(vrm.scene);

      const originalBox = new THREE.Box3().setFromObject(vrm.scene);
      const originalHeight = Math.max(originalBox.max.y - originalBox.min.y, 0.1);
      vrm.scene.scale.setScalar(3.45 / originalHeight);
      const scaledBox = new THREE.Box3().setFromObject(vrm.scene);
      vrm.scene.position.y = -scaledBox.min.y - 0.55;
      const baseModelY = vrm.scene.position.y;
      camera.lookAt(0, 2.3, 0);
      console.log("VRM loaded", {
        height: originalHeight,
        scaledMinY: scaledBox.min.y,
        scaledMaxY: scaledBox.max.y,
        children: vrm.scene.children.length
      });

      let talking = false;
      let running = true;
      let visible = true;
      let t = 0;
      let blinkStart = -1;
      let nextBlink = 2.2;
      let mood = "neutral";
      const getBone = (name) => vrm.humanoid?.getNormalizedBoneNode?.(name)
        || vrm.humanoid?.getRawBoneNode?.(name)
        || null;
      const head = getBone("head");
      const leftUpperArm = getBone("leftUpperArm");
      const rightUpperArm = getBone("rightUpperArm");
      const leftLowerArm = getBone("leftLowerArm");
      const rightLowerArm = getBone("rightLowerArm");
      // Keep the resting pose natural: arms relaxed down beside the body.
      // Dinlenme duruşunu doğal tut: kollar gövdenin yanında serbestçe aşağı sarksın.
      if (leftUpperArm) leftUpperArm.rotation.z = 1.12;
      if (rightUpperArm) rightUpperArm.rotation.z = -1.12;
      if (leftLowerArm) leftLowerArm.rotation.z = .12;
      if (rightLowerArm) rightLowerArm.rotation.z = -.12;
      const lipMaterial = new THREE.MeshBasicMaterial({ color: 0xd16a7a, transparent: true, opacity: .98, depthWrite: false });
      const mouthMaterial = new THREE.MeshBasicMaterial({ color: 0x351b25, transparent: true, opacity: .96, depthWrite: false });
      const mouthOverlay = new THREE.Group();
      const innerMouth = new THREE.Mesh(new THREE.SphereGeometry(.07, 20, 12), mouthMaterial);
      innerMouth.scale.set(1.15, .28, .42);
      innerMouth.position.set(0, -.125, .17);
      const lips = new THREE.Mesh(new THREE.SphereGeometry(.075, 20, 12), lipMaterial);
      lips.scale.set(1.22, .20, .28);
      lips.position.set(0, -.118, .185);
      mouthOverlay.add(innerMouth, lips);
      if (head) head.add(mouthOverlay);

      function setExpression(name, value) {
        try { vrm.expressionManager?.setValue(name, value); } catch { /* Some older VRMs lack this expression. / Bazı eski VRM'lerde bu ifade bulunmaz. */ }
      }

      function updateMoodExpressions() {
        for (const name of ["happy", "sad", "angry", "relaxed", "surprised"]) setExpression(name, 0);
        const expression = mood === "happy" ? "happy" : mood === "concerned" ? "sad" : mood === "curious" ? "surprised" : "relaxed";
        setExpression(expression, .28);
      }

      function resize() {
        const rect = mount.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return;
        renderer.setSize(rect.width, rect.height, false);
        camera.aspect = Math.max(rect.width / Math.max(rect.height, 1), .95);
        camera.updateProjectionMatrix();
      }
      new ResizeObserver(resize).observe(mount);
      resize();

      const clock = new THREE.Clock();
      function loop() {
        if (!running) return;
        requestAnimationFrame(loop);
        if (!visible) return;
        const delta = clock.getDelta();
        t += delta;
        updateMoodExpressions();
        if (blinkStart < 0 && !talking && t > nextBlink) {
          blinkStart = t;
          nextBlink = t + 2.8 + Math.random() * 3.8;
        }
        let blink = 0;
        if (blinkStart >= 0) {
          const elapsed = t - blinkStart;
          if (elapsed < .22) blink = Math.sin((elapsed / .22) * Math.PI);
          else blinkStart = -1;
        }
        setExpression("blink", blink);
        setExpression("aa", talking ? .34 + Math.abs(Math.sin(t * 14)) * .3 : 0);
        setExpression("ih", talking ? .1 + Math.abs(Math.sin(t * 11 + 1)) * .12 : 0);
        setExpression("ou", talking ? .08 + Math.abs(Math.sin(t * 9 + .8)) * .08 : 0);
        innerMouth.scale.y = talking ? .28 + Math.abs(Math.sin(t * 14)) * .26 : .2;
        lips.scale.y = talking ? .2 + Math.abs(Math.sin(t * 14)) * .08 : .2;
        if (head) {
          const idleMotion = talking ? .35 : 1;
          const moodTilt = mood === "happy" ? .018 : mood === "concerned" ? -.02 : mood === "curious" ? .028 : 0;
          head.rotation.y = Math.sin(t * .55) * .05 * idleMotion;
          head.rotation.x = Math.sin(t * .7) * .016 * idleMotion;
          head.rotation.z = Math.sin(t * .32) * .012 * idleMotion + moodTilt;
        }
        vrm.scene.position.y = baseModelY + Math.sin(t * .8) * .008;
        vrm.scene.rotation.z = Math.sin(t * .34) * .009;
        vrm.update(delta);
        renderer.render(scene, camera);
      }
      loop();

      resolve({
        setTalking(value) { talking = Boolean(value); },
        setMood(value) { mood = value || "neutral"; },
        setVisible(value) {
          visible = Boolean(value);
          renderer.domElement.style.display = visible ? "block" : "none";
          if (visible) resize();
        },
        resize,
        dispose() { running = false; renderer.dispose(); }
      });
      } catch (error) {
        reject(error);
      }
    }, undefined, reject);
  });
}

setAvatarEnabled(avatarEnabled);
void initializeConversations();
loadStatus().catch(() => { providerBadge.textContent = t("offline"); }).finally(() => {
  updateVoiceButton();
  if (alwaysListening) void runVoiceLoop();
});
