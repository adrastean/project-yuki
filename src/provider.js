import https from "node:https";
import { execFile, spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { getYukiSystemPrompt } from "./persona.js";

// Provider adapters keep model-specific request and speech details out of the UI.
// Sağlayıcı bağdaştırıcıları, modele ve konuşma üretimine özel ayrıntıları arayüzden ayırır.
function hasOpenAIProvider() { return Boolean(process.env.OPENAI_API_KEY); }
function hasOllamaProvider() { return Boolean(process.env.OLLAMA_URL); }
function hasGeminiProvider() { return Boolean(process.env.GEMINI_API_KEY); }
function hasQloraProvider() { return (process.env.YUKI_PROVIDER || "").toLowerCase() === "qlora"; }
function sanitizeAssistantText(text) {
  return String(text || "")
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "")
    .replace(/<think\b[^>]*>[\s\S]*$/gi, "")
    .replace(/<\|think\|>[\s\S]*?<\|\/think\|>/gi, "")
    .replace(/<\|think\|>[\s\S]*$/gi, "")
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
export function ensureSir(text, language = "en") {
  const value = sanitizeAssistantText(text);
  const soundsTurkish = /[çğıöşü]/i.test(value) || /\b(nasilsin|merhaba|gunaydin|bugun|yardimci|tesekkur|iyiyim)\b/i.test(value);
  if (language === "tr" || soundsTurkish) {
    const withoutEnglishTitle = value.replace(/\bsir\b[,.:]?\s*/gi, "").replace(/\s+([,.!?])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
    return withoutEnglishTitle || "Yardımcı olmaya hazırım.";
  }
  return value && /\bsir\b/i.test(value) ? value : value ? `Sir, ${value}` : "Sir, I am ready to help.";
}
function validateReplyLanguage(text, language = "en") {
  const value = sanitizeAssistantText(text);
  const hasCjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
  const englishWords = (value.match(/\b(?:the|and|is|are|of|to|in|as|on|for|with|around|would|like|please|according|estimates|population|people|world|current|from|this|that|you|can|i|it|was|were|have|has|will|about|than|more|less)\b/gi) || []).length;
  const turkishWords = (value.match(/\b(?:ve|bir|bu|şu|için|ile|olarak|yaklaşık|dünya|nüfus|insan|kişi|olabilir|değişebilir|ister|misin|istersen|üzgünüm|kaynak|yanıt|cevap|güvenilir|sayı|tahmin|göre|ancak|fakat|çünkü|şimdi|bugün|kaç|tane|var|yok|ederim|edebilirim)\b/gi) || []).length;
  const wrongLanguage = language === "tr"
    ? englishWords >= 5 && englishWords > turkishWords
    : turkishWords >= 5 && turkishWords > englishWords;
  if (hasCjk || wrongLanguage) {
    return language === "tr"
      ? "Üzgünüm, yanıtımın dili karıştı; bu yüzden güvenilir bir cevap veremedim. Bir kez daha dener misin?"
      : "Sorry, sir. My reply mixed languages, so I could not give you a reliable answer. Please try again.";
  }
  return value;
}
export function providerStatus() {
  if (hasQloraProvider()) return { mode: "qlora-local", model: "Qwen2.5-3B-Instruct + Yuki Turkish LoRA" };
  if ((process.env.YUKI_PROVIDER || "").toLowerCase() === "ollama" && hasOllamaProvider()) return { mode: "ollama", model: process.env.OLLAMA_MODEL || "llama3.2:3b" };
  if (hasGeminiProvider()) return { mode: "gemini", model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite" };
  if (hasOpenAIProvider()) return { mode: "openai-compatible", model: process.env.YUKI_MODEL || "gpt-4o-mini" };
  if (hasOllamaProvider()) return { mode: "ollama", model: process.env.OLLAMA_MODEL || "llama3.2:3b" };
  return { mode: "demo", model: null };
}

export function voiceStatus() {
  const configuredVoice = process.env.TTS_PROVIDER?.toLowerCase();
  if (["qwen", "qwen3", "qwen3-tts"].includes(configuredVoice)) {
    return { mode: "qwen3-tts", model: process.env.QWEN_TTS_MODEL || "Qwen/Qwen3-TTS-12Hz-0.6B-Base", language: "en" };
  }
  if (configuredVoice === "xtts") {
    return { mode: "xtts", model: "XTTS-v2", language: process.env.XTTS_LANGUAGE || "tr" };
  }
  if (configuredVoice === "edge" || configuredVoice === "edge-tts") {
    return { mode: "edge-tts", model: process.env.EDGE_TTS_VOICE || "en-US-JennyNeural", language: "en-US" };
  }
  const localPiperVoice = configuredVoice === "piper";
  const localWindowsVoice = process.platform === "win32" && configuredVoice === "sapi";
  return {
    mode: process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID ? "elevenlabs" : localPiperVoice ? "piper" : localWindowsVoice ? "sapi" : "browser",
    model: process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2"
  };
}

let xttsProcess = null;
let xttsReady = null;
const xttsRequests = new Map();
let qwenProcess = null;
let qwenReady = null;
const qwenRequests = new Map();
let qloraProcess = null;
let qloraReady = null;
let qloraRequestId = 0;
const qloraRequests = new Map();

export function shutdownSpeechProcesses() {
  for (const child of [qwenProcess, xttsProcess, qloraProcess]) {
    if (child && !child.killed) child.kill();
  }
}

function startQlora() {
  if (qloraProcess && !qloraProcess.killed && qloraReady) return qloraReady;
  const python = resolve(process.env.YUKI_QLORA_PYTHON || "training/.venv/Scripts/python.exe");
  const script = resolve("training/serve_qlora.py");
  qloraProcess = spawn(python, ["-u", script], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const child = qloraProcess;
  const lines = createInterface({ input: child.stdout });
  qloraReady = new Promise((resolveReady, rejectReady) => {
    let settled = false;
    const startupTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      rejectReady(new Error("QLoRA model startup timed out."));
      child.kill();
    }, Number(process.env.YUKI_QLORA_STARTUP_TIMEOUT_MS || 180000));
    lines.on("line", (line) => {
      let event;
      try { event = JSON.parse(line); }
      catch { console.error(`Yuki QLoRA: ${line}`); return; }
      if (event.ready && !settled) {
        settled = true;
        clearTimeout(startupTimer);
        resolveReady();
      }
      if (event.id && qloraRequests.has(event.id)) {
        const pending = qloraRequests.get(event.id);
        qloraRequests.delete(event.id);
        clearTimeout(pending.timer);
        if (event.error) pending.reject(new Error(event.error));
        else pending.resolve(event.reply || "");
      }
      if (event.fatal && !settled) {
        settled = true;
        clearTimeout(startupTimer);
        rejectReady(new Error(event.fatal));
      }
    });
    child.stderr.on("data", (chunk) => console.error(`Yuki QLoRA: ${chunk.toString().trimEnd()}`));
    child.once("error", (error) => {
      if (!settled) { settled = true; clearTimeout(startupTimer); rejectReady(error); }
    });
    child.once("exit", (code) => {
      if (!settled) { settled = true; clearTimeout(startupTimer); rejectReady(new Error(`QLoRA process exited (${code}).`)); }
      for (const pending of qloraRequests.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`QLoRA process exited (${code}).`));
      }
      qloraRequests.clear();
      qloraReady = null;
      qloraProcess = null;
    });
  });
  return qloraReady;
}

async function qlora(messages, { language = "en" } = {}) {
  await startQlora();
  const child = qloraProcess;
  if (!child || child.killed || !child.stdin.writable) throw new Error("QLoRA process is not available.");
  const id = String(++qloraRequestId);
  return new Promise((resolveReply, rejectReply) => {
    const timeoutMs = Number(process.env.YUKI_QLORA_TIMEOUT_MS || 120000);
    const timer = setTimeout(() => {
      qloraRequests.delete(id);
      rejectReply(new Error("QLoRA response timed out."));
    }, timeoutMs);
    qloraRequests.set(id, { resolve: resolveReply, reject: rejectReply, timer });
    child.stdin.write(`${JSON.stringify({ id, messages, language })}\n`, (error) => {
      if (!error) return;
      clearTimeout(timer);
      qloraRequests.delete(id);
      rejectReply(error);
    });
  });
}

process.once("exit", shutdownSpeechProcesses);

export function listenForSpeech() {
  const python = process.env.STT_PYTHON || process.env.VOSK_PYTHON || process.env.EDGE_TTS_PYTHON || "python";
  const executable = resolve(python);
  const provider = (process.env.STT_PROVIDER || "whisper").toLowerCase();
  const whisper = provider === "whisper";
  const timeoutMs = Number(whisper ? (process.env.STT_TIMEOUT_MS || 30000) : (process.env.VOSK_TIMEOUT_MS || 15000));
  const script = resolve(process.env.STT_SCRIPT || (whisper ? "tools/whisper/listen.py" : "tools/vosk/listen.py"));
  const args = [script];
  if (whisper) {
    args.push(
      "--model", process.env.STT_MODEL || "small.en",
      "--cache-dir", resolve(process.env.STT_MODEL_DIR || "tools/whisper/models"),
      "--device", process.env.STT_DEVICE || "cuda",
      "--compute-type", process.env.STT_COMPUTE_TYPE || "float16",
      "--timeout-ms", process.env.STT_TIMEOUT_MS || "30000",
      "--silence-ms", process.env.STT_SILENCE_MS || "1800",
      "--energy-threshold", process.env.STT_ENERGY_THRESHOLD || "80"
    );
  } else {
    args.push(
      "--model", resolve(process.env.VOSK_MODEL || "tools/vosk/models/vosk-model-small-en-us-0.15"),
      "--timeout-ms", process.env.VOSK_TIMEOUT_MS || "15000",
      "--silence-ms", process.env.VOSK_SILENCE_MS || "1500"
    );
  }
  return new Promise((resolveSpeech, rejectSpeech) => {
    const child = spawn(executable, args, { cwd: resolve("."), windowsHide: true, windowsVerbatimArguments: false });
    let output = "";
    let errorOutput = "";
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) rejectSpeech(error); else resolveSpeech(result);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error("Voice input timed out"));
    }, timeoutMs + 3000);
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { errorOutput += chunk.toString(); });
    child.on("error", (error) => finish(new Error(`Local voice input error: ${error.message}`)));
    child.on("close", (code) => {
      try {
        if (code !== 0) throw new Error(errorOutput.trim() || `Local speech recognizer exited with code ${code}`);
        const result = JSON.parse(output.trim() || "{}");
        finish(null, String(result.text || "").trim());
      } catch (error) {
        finish(new Error(`Local voice input error: ${error.message}`));
      }
    });
  });
}

function startXttsProcess() {
  if (xttsProcess) return;
  const projectRoot = resolve(".");
  const python = process.env.XTTS_PYTHON
    ? resolve(process.env.XTTS_PYTHON)
    : resolve("tools/xtts/venv/Scripts/python.exe");
  const script = resolve(process.env.XTTS_SERVER_SCRIPT || "tools/xtts/xtts_server.py");
  const modelDir = resolve(process.env.XTTS_MODEL_DIR || "tools/xtts/models");
  const referenceWav = resolve(process.env.XTTS_REFERENCE_WAV || "tools/xtts/voices/yuki-reference.wav");
  const args = [script, "--model-dir", modelDir, "--reference-wav", referenceWav];
  if (process.env.XTTS_USE_CUDA !== "0") args.push("--cuda");

  xttsProcess = spawn(python, args, {
    cwd: projectRoot,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, COQUI_TOS_AGREED: "1" }
  });
  xttsReady = new Promise((resolveReady, rejectReady) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (error) rejectReady(error); else resolveReady();
    };
    xttsProcess.stdout.setEncoding("utf8");
    let buffer = "";
    xttsProcess.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.type === "ready") finish();
        else if (message.type === "fatal") finish(new Error(message.error));
        else if (message.id && xttsRequests.has(message.id)) {
          const request = xttsRequests.get(message.id);
          xttsRequests.delete(message.id);
          if (message.ok) request.resolve(message); else request.reject(new Error(message.error));
        }
      }
    });
    xttsProcess.stderr.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (text) console.error(`XTTS: ${text}`);
    });
    xttsProcess.once("error", (error) => finish(new Error(`XTTS process error: ${error.message}`)));
    xttsProcess.once("close", (code) => {
      if (!settled) finish(new Error(`XTTS process exited with code ${code}`));
      for (const request of xttsRequests.values()) request.reject(new Error("XTTS process kapandı"));
      xttsRequests.clear();
      xttsProcess = null;
      xttsReady = null;
    });
  });
}

async function generateXttsSpeech(text) {
  startXttsProcess();
  await xttsReady;
  const outputPath = join(tmpdir(), `project-yuki-xtts-${randomUUID()}.wav`);
  const id = randomUUID();
  const result = await new Promise((resolveRequest, rejectRequest) => {
    const timeout = setTimeout(() => {
      xttsRequests.delete(id);
      rejectRequest(new Error("XTTS voice generation timeout"));
    }, Number(process.env.XTTS_TIMEOUT_MS || 120000));
    xttsRequests.set(id, {
      resolve: (value) => { clearTimeout(timeout); resolveRequest(value); },
      reject: (error) => { clearTimeout(timeout); rejectRequest(error); }
    });
    xttsProcess.stdin.write(`${JSON.stringify({
      id,
      text,
      language: process.env.XTTS_LANGUAGE || "tr",
      speaker_wav: resolve(process.env.XTTS_REFERENCE_WAV || "tools/xtts/voices/yuki-reference.wav"),
      output: outputPath
    })}\n`);
  });
  try {
    return { buffer: await readFile(result.output), mime: "audio/wav" };
  } finally {
    await rm(result.output, { force: true }).catch(() => {});
    await rm(outputPath, { force: true }).catch(() => {});
  }
}

function startQwenProcess() {
  if (qwenProcess) return;
  const projectRoot = resolve(".");
  const python = process.env.QWEN_TTS_PYTHON
    ? resolve(process.env.QWEN_TTS_PYTHON)
    : resolve("tools/qwen-tts/venv/Scripts/python.exe");
  const script = resolve(process.env.QWEN_TTS_SCRIPT || "tools/qwen-tts/qwen_tts_server.py");
  const referenceWav = resolve(process.env.QWEN_TTS_REFERENCE_WAV || "tools/qwen-tts/voices/yuki-design-reference.wav");
  const args = [
    script,
    "--model-id", process.env.QWEN_TTS_MODEL || "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
    "--reference-wav", referenceWav,
    "--reference-text", process.env.QWEN_TTS_REFERENCE_TEXT || "It's in the top drawer... wait, it's empty? No way, that's impossible! I'm sure I put it there!"
  ];

  qwenProcess = spawn(python, args, {
    cwd: projectRoot,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      HF_HOME: resolve(process.env.QWEN_TTS_CACHE || "tools/qwen-tts/cache")
    }
  });

  qwenReady = new Promise((resolveReady, rejectReady) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimeout);
      if (error) rejectReady(error); else resolveReady();
    };
    const startupTimeout = setTimeout(() => {
      qwenProcess?.kill();
      finish(new Error("Qwen3-TTS did not finish loading before the startup timeout"));
    }, Number(process.env.QWEN_TTS_STARTUP_TIMEOUT_MS || 600000));
    qwenProcess.stdout.setEncoding("utf8");
    let buffer = "";
    qwenProcess.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.type === "ready") finish();
        else if (message.type === "fatal") finish(new Error(message.error));
        else if (message.id && qwenRequests.has(message.id)) {
          const request = qwenRequests.get(message.id);
          qwenRequests.delete(message.id);
          if (message.ok) request.resolve(message); else request.reject(new Error(message.error));
        }
      }
    });
    qwenProcess.stderr.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (text) console.error(`Qwen3-TTS: ${text}`);
    });
    qwenProcess.once("error", (error) => finish(new Error(`Qwen3-TTS process error: ${error.message}`)));
    qwenProcess.once("close", (code) => {
      if (!settled) finish(new Error(`Qwen3-TTS process exited with code ${code}`));
      for (const request of qwenRequests.values()) request.reject(new Error("Qwen3-TTS process closed"));
      qwenRequests.clear();
      qwenProcess = null;
      qwenReady = null;
    });
  });
}

async function generateQwenSpeech(text) {
  startQwenProcess();
  await qwenReady;
  const outputPath = join(tmpdir(), `project-yuki-qwen-${randomUUID()}.wav`);
  const id = randomUUID();
  const result = await new Promise((resolveRequest, rejectRequest) => {
    const timeout = setTimeout(() => {
      qwenRequests.delete(id);
      rejectRequest(new Error("Qwen3-TTS voice generation timeout"));
    }, Number(process.env.QWEN_TTS_TIMEOUT_MS || 120000));
    qwenRequests.set(id, {
      resolve: (value) => { clearTimeout(timeout); resolveRequest(value); },
      reject: (error) => { clearTimeout(timeout); rejectRequest(error); }
    });
    qwenProcess.stdin.write(`${JSON.stringify({ id, text, output: outputPath })}\n`);
  });
  try {
    return { buffer: await readFile(result.output), mime: "audio/wav" };
  } finally {
    await rm(result.output, { force: true }).catch(() => {});
    await rm(outputPath, { force: true }).catch(() => {});
  }
}

async function openAICompatible(messages) {
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetch(`${base}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: JSON.stringify({ model: process.env.YUKI_MODEL || "gpt-4o-mini", messages, temperature: 0.85, max_tokens: 300 }) });
  if (!response.ok) throw new Error(`OpenAI-compatible provider error: ${response.status}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "Buna cevap veremedim...";
}

function postJson(urlString, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const maxRetries = Number(process.env.GEMINI_RETRIES || 3);
    const isRetryable = (error) => ["ECONNRESET", "EPROTO", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH", "ECONNREFUSED"].includes(error?.code)
      || /timeout/i.test(error?.message || "");
    const attempt = (retriesLeft) => {
      const request = https.request({
        hostname: url.hostname,
        family: 4,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: { ...headers, "content-length": Buffer.byteLength(body) },
        agent: new https.Agent({ keepAlive: false, maxCachedSessions: 0 })
      }, (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { raw += chunk; });
        response.on("end", () => resolve({ status: response.statusCode || 0, body: raw }));
      });
      request.setTimeout(Number(process.env.GEMINI_TIMEOUT_MS || 30000), () => request.destroy(new Error("istek zaman aşımına uğradı")));
      request.on("error", (error) => {
        if (retriesLeft > 0 && isRetryable(error)) {
          const retryNumber = maxRetries - retriesLeft + 1;
          return setTimeout(() => attempt(retriesLeft - 1), Math.min(2000, retryNumber * 500));
        }
        reject(error);
      });
      request.write(body);
      request.end();
    };
    attempt(maxRetries);
  });
}

async function gemini(messages) {
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  const apiKey = process.env.GEMINI_API_KEY;
  const system = messages.find((message) => message.role === "system")?.content || "";
  const contents = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] }));
  let response;
  try {
    response = await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      JSON.stringify({ system_instruction: { parts: [{ text: system }] }, contents, generationConfig: { maxOutputTokens: 300 } }),
      { "content-type": "application/json", "x-goog-api-key": apiKey }
    );
  } catch (error) {
    const reason = error?.code || error?.message || "bilinmeyen ağ hatası";
    throw new Error(`Gemini network error: ${reason}`);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Gemini provider error: ${response.status} ${response.body.slice(0, 300)}`);
  }
  const data = JSON.parse(response.body);
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "Buna cevap veremedim...";
}

const ollamaThinkingSupport = new Map();

async function supportsOllamaThinking(base, model) {
  if (ollamaThinkingSupport.has(model)) return ollamaThinkingSupport.get(model);
  let supported = false;
  try {
    const response = await fetch(`${base}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model })
    });
    if (response.ok) {
      const data = await response.json();
      supported = Array.isArray(data.thinking?.values) && data.thinking.values.some((value) => value === true || typeof value === "string");
    }
  } catch {}
  ollamaThinkingSupport.set(model, supported);
  return supported;
}

async function ollama(messages, { think = false, language = "en", gpuMode = "quality", ollamaModel } = {}) {
  const base = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = ["qwen2.5:7b", "qwen2.5-coder:7b"].includes(ollamaModel) ? ollamaModel : (process.env.OLLAMA_MODEL || "llama3.2:3b");
  const options = language === "tr"
    ? { temperature: 0.45, top_p: 0.85, repeat_penalty: 1.08, num_ctx: 4096 }
    : { temperature: 0.7 };
  if (gpuMode === "performance") {
    // Ollama's num_gpu is a layer count, not a memory quota. Qwen2.5 7B has 28 layers;
    // offload roughly 40% to GPU and leave the rest on system RAM.
    // Ollama'daki num_gpu bellek kotası değil, katman sayısıdır. Qwen2.5 7B 28 katmanlıdır;
    // yaklaşık yüzde 40'ını GPU'ya, kalanını sistem belleğine aktar.
    const isQwen7B = /qwen2\.5(?:-coder)?:7b(?:-|$)/i.test(model);
    options.num_gpu = isQwen7B ? 12 : 8;
  } else {
    // Ask Ollama to place all layers on GPU; if VRAM is insufficient, the request can fail.
    // Ollama'dan tüm katmanları GPU'ya koymasını iste; VRAM yetmezse istek başarısız olabilir.
    options.num_gpu = 99;
  }
  const supportsThinking = await supportsOllamaThinking(base, model);
  const requestMessages = think && !supportsThinking
    ? [{ role: "system", content: language === "tr"
        ? "Yanıtlamadan önce dikkatlice düşün. İç akıl yürütmeni açıklama; yalnızca kısa ve doğru cevabı ver."
        : "Think carefully before answering. Keep your reasoning private and provide only the concise final answer." }, ...messages]
    : messages;
  const body = { model, messages: requestMessages, stream: false, options };
  if (supportsThinking) body.think = think;
  const response = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Ollama provider error: ${response.status}${details ? ` ${details.slice(0, 400)}` : ""}`);
  }
  const data = await response.json();
  return data.message?.content?.trim() || "Buna cevap veremedim...";
}

function generateWindowsSpeech(text) {
  const outputPath = join(tmpdir(), `project-yuki-${randomUUID()}.wav`);
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
if (-not [string]::IsNullOrWhiteSpace($env:YUKI_SAPI_VOICE)) {
  try { $synth.SelectVoice($env:YUKI_SAPI_VOICE) } catch { $synth.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::Female) }
} else {
  $synth.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::Female)
}
$synth.Rate = 1
$synth.Volume = 100
$synth.SetOutputToWaveFile($env:YUKI_SAPI_OUTPUT)
$synth.Speak($env:YUKI_SAPI_TEXT)
$synth.Dispose()
`;
  return new Promise((resolveSpeech, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      windowsHide: true,
      timeout: 15000,
      env: { ...process.env, YUKI_SAPI_TEXT: text, YUKI_SAPI_OUTPUT: outputPath, YUKI_SAPI_VOICE: process.env.SAPI_VOICE || "" }
    }, async (error) => {
      try {
        if (error) throw error;
        resolveSpeech({ buffer: await readFile(outputPath), mime: "audio/wav" });
      } catch (readError) {
        reject(new Error(`Windows voice error: ${readError.message}`));
      } finally {
        await rm(outputPath, { force: true }).catch(() => {});
      }
    });
  });
}

function generatePiperSpeech(text) {
  const model = resolve(process.env.PIPER_MODEL || "tools/piper/voices/en_US-lessac-medium.onnx");
  const outputPath = join(tmpdir(), `project-yuki-piper-${randomUUID()}.wav`);
  const python = process.env.PIPER_PYTHON || "py";
  const executable = process.env.PIPER_EXECUTABLE ? resolve(process.env.PIPER_EXECUTABLE) : python;
  const pythonVersion = process.env.PIPER_PYTHON_VERSION ? [`-${process.env.PIPER_PYTHON_VERSION}`] : [];
  const args = process.env.PIPER_EXECUTABLE
    ? ["--model", model, "--output_file", outputPath]
    : [...pythonVersion, "-m", "piper", "-m", model, "-f", outputPath, "--", text];
  return new Promise((resolveSpeech, reject) => {
    const child = spawn(executable, args, { windowsHide: true, windowsVerbatimArguments: false });
    let errorOutput = "";
    child.stderr.on("data", (chunk) => { errorOutput += chunk.toString(); });
    child.on("error", (error) => reject(new Error(`Piper voice error: ${error.message}`)));
    child.on("close", async (code) => {
      try {
        if (code !== 0) throw new Error(errorOutput.trim() || `Piper exited with code ${code}`);
        resolveSpeech({ buffer: await readFile(outputPath), mime: "audio/wav" });
      } catch (error) {
        reject(new Error(`Piper voice error: ${error.message}`));
      } finally {
        await rm(outputPath, { force: true }).catch(() => {});
      }
    });
    if (process.env.PIPER_EXECUTABLE) child.stdin.end(`${text}\n`);
  });
}

function generateEdgeTtsSpeech(text) {
  const outputPath = join(tmpdir(), `project-yuki-edge-${randomUUID()}.mp3`);
  const python = process.env.EDGE_TTS_PYTHON || "py";
  const executable = process.env.EDGE_TTS_EXECUTABLE ? resolve(process.env.EDGE_TTS_EXECUTABLE) : python;
  const pythonVersion = process.env.EDGE_TTS_PYTHON_VERSION ? [`-${process.env.EDGE_TTS_PYTHON_VERSION}`] : [];
  const script = resolve(process.env.EDGE_TTS_SCRIPT || "tools/edge-tts/synthesize.py");
  const args = [
    ...pythonVersion,
    script,
    "--text", text,
    "--output", outputPath,
    "--voice", process.env.EDGE_TTS_VOICE || "en-US-JennyNeural",
    "--rate", process.env.EDGE_TTS_RATE || "+5%",
    "--volume", process.env.EDGE_TTS_VOLUME || "+0%",
    "--pitch", process.env.EDGE_TTS_PITCH || "+0Hz"
  ];
  return new Promise((resolveSpeech, reject) => {
    const child = spawn(executable, args, { windowsHide: true, windowsVerbatimArguments: false });
    let errorOutput = "";
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error("Edge TTS voice generation timeout"));
    }, Number(process.env.EDGE_TTS_TIMEOUT_MS || 30000));
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error); else resolveSpeech(result);
    };
    child.stderr.on("data", (chunk) => { errorOutput += chunk.toString(); });
    child.on("error", (error) => finish(new Error(`Edge TTS voice error: ${error.message}`)));
    child.on("close", async (code) => {
      try {
        if (code !== 0) throw new Error(errorOutput.trim() || `Edge TTS exited with code ${code}`);
        finish(null, { buffer: await readFile(outputPath), mime: "audio/mpeg" });
      } catch (error) {
        finish(new Error(`Edge TTS voice error: ${error.message}`));
      } finally {
        await rm(outputPath, { force: true }).catch(() => {});
      }
    });
  });
}

export async function generateReply(history, options = {}) {
  const messages = [{ role: "system", content: getYukiSystemPrompt(options.language) }];
  if (options.memoryContext) {
    const memoryInstruction = options.language === "tr"
      ? "Aşağıdaki yerel hafızayı yalnızca doğrudan ilgiliyse kullan. Listede olmayan bir anıyı varmış gibi anlatma."
      : "Use this local long-term memory only when relevant. Do not claim a memory that is not listed here.";
    messages.push({ role: "system", content: `${memoryInstruction}\n${options.memoryContext}` });
  }
  if (options.webContext) messages.push({ role: "system", content: options.webContext });
  messages.push(...history.slice(-12));
  messages.push({
    role: "system",
    content: options.language === "tr"
      ? "SON YANIT KURALI: Sadece doğal ve düzgün Türkçe yaz. Önceki mesajlar veya kaynaklar başka dilde olsa bile onları taklit etme. İngilizce/Çince cümle, düşünce dökümü veya ilgisiz ek bilgi yazma."
      : "FINAL RESPONSE RULE: Write only in natural English. Do not imitate other languages in earlier messages or sources. Do not include Turkish/Chinese sentences, hidden reasoning, or unrelated extra facts."
  });
  let reply = null;
  if (hasQloraProvider() && (options.language === "tr" || !hasOllamaProvider())) reply = await qlora(messages, options);
  else if (hasQloraProvider() && hasOllamaProvider()) reply = await ollama(messages, options);
  else if ((process.env.YUKI_PROVIDER || "").toLowerCase() === "ollama" && hasOllamaProvider()) reply = await ollama(messages, options);
  else if (hasGeminiProvider()) reply = await gemini(messages);
  else if (hasOpenAIProvider()) reply = await openAICompatible(messages);
  else if (hasOllamaProvider()) reply = await ollama(messages, options);
  return reply ? ensureSir(validateReplyLanguage(reply, options.language), options.language) : null;
}

export async function generateSpeech(text) {
  if (["qwen", "qwen3", "qwen3-tts"].includes(process.env.TTS_PROVIDER?.toLowerCase())) return generateQwenSpeech(text);
  if (process.env.TTS_PROVIDER?.toLowerCase() === "xtts") return generateXttsSpeech(text);
  if (["edge", "edge-tts"].includes(process.env.TTS_PROVIDER?.toLowerCase())) return generateEdgeTtsSpeech(text);
  if (process.env.TTS_PROVIDER?.toLowerCase() === "piper") return generatePiperSpeech(text);
  if (process.platform === "win32" && process.env.TTS_PROVIDER?.toLowerCase() === "sapi") return generateWindowsSpeech(text);
  if (!process.env.ELEVENLABS_API_KEY || !process.env.ELEVENLABS_VOICE_ID) return null;
  const voiceId = encodeURIComponent(process.env.ELEVENLABS_VOICE_ID);
  const format = encodeURIComponent(process.env.ELEVENLABS_OUTPUT_FORMAT || "mp3_44100_128");
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${format}`, {
    method: "POST",
    headers: { "content-type": "application/json", "xi-api-key": process.env.ELEVENLABS_API_KEY },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2",
      voice_settings: { stability: 0.42, similarity_boost: 0.78, style: 0.35, use_speaker_boost: true, speed: 1.04 }
    })
  });
  if (!response.ok) throw new Error(`ElevenLabs provider error: ${response.status}`);
  return { buffer: Buffer.from(await response.arrayBuffer()), mime: "audio/mpeg" };
}
