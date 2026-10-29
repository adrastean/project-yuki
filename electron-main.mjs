import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, screen, session, shell } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import { extname, join, dirname, relative, sep, isAbsolute, parse } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Preserve the established profile so existing chats, language and permissions stay available.
// Önceden kullanılan profili koru; sohbetler, dil ve izin ayarları yerinde kalsın.
app.setName("project-yuki");
if (process.platform === "win32") app.setAppUserModelId("com.projectyuki.yuki");

const projectRoot = dirname(fileURLToPath(import.meta.url));
// Electron owns the desktop window, user approvals, local storage and optional Ollama startup.
// Masaüstü penceresi, kullanıcı onayları, yerel depolama ve isteğe bağlı Ollama başlangıcı Electron'da yönetilir.
let mainWindow = null;
let statusWindow = null;
let activeStatusText = "";
let unreadReplyCount = 0;
let yukiServer = null;
let ollamaProcess = null;
let ollamaProcessOwned = false;
let ollamaStartupStatus = { state: "idle", message: "" };
const ollamaModelPresets = { core: "qwen2.5:7b", code: "qwen2.5-coder:7b" };
let selectedOllamaPreset = "core";
let loadedOllamaModel = null;
let ollamaModelOperation = Promise.resolve();
let approvedFolders = [];
let computerFolders = [];
let previousCpuTimes = null;
const searchableExtensions = new Set([".txt", ".md", ".csv", ".json", ".js", ".ts", ".html", ".css", ".log", ".mjs", ".cjs", ".jsx", ".tsx", ".py", ".java", ".c", ".cpp", ".h", ".hpp", ".cs", ".go", ".rs", ".yaml", ".yml", ".toml", ".xml", ".sql", ".sh", ".ps1", ".ini", ".env", ".vue", ".svelte"]);
const readableExtensions = new Set(searchableExtensions);
const blockedOpenExtensions = new Set([".exe", ".com", ".bat", ".cmd", ".msi", ".msp", ".scr", ".ps1", ".vbs", ".js", ".jse", ".wsf", ".wsh", ".lnk"]);
const blockedSaveExtensions = new Set([".exe", ".com", ".bat", ".cmd", ".msi", ".msp", ".scr", ".lnk"]);
const skippedDirectoryNames = new Set([".git", "node_modules", "venv", ".venv", "windows", "program files", "program files (x86)"]);
const blockedFolderNames = new Set(["windows", "program files", "program files (x86)", "programdata", "system volume information", "$recycle.bin", "recovery"]);
const allowedApps = {
  notepad: { command: "notepad.exe", label: "Notepad" },
  calculator: { command: "calc.exe", label: "Calculator" },
  explorer: { command: "explorer.exe", label: "File Explorer" }
};

function sampleSystemCpu() {
  const cpus = os.cpus();
  const current = cpus.reduce((sum, cpu) => {
    const times = cpu.times;
    sum.idle += times.idle;
    sum.total += times.user + times.nice + times.sys + times.idle + times.irq;
    return sum;
  }, { idle: 0, total: 0 });
  const previous = previousCpuTimes;
  previousCpuTimes = current;
  if (!previous) return null;
  const totalDelta = current.total - previous.total;
  if (totalDelta <= 0) return null;
  return Math.round(Math.max(0, Math.min(100, (1 - (current.idle - previous.idle) / totalDelta) * 100)));
}

function readNvidiaUsage() {
  return new Promise((resolveUsage) => {
    let output = "";
    let settled = false;
    const child = spawn("nvidia-smi", ["--query-gpu=utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveUsage(value);
    };
    const timeout = setTimeout(() => { child.kill(); finish(null); }, 1800);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output = (output + chunk).slice(0, 512); });
    child.once("error", () => finish(null));
    child.once("close", (code) => {
      if (code !== 0) return finish(null);
      const [utilText, usedText, totalText] = output.trim().split(/\s*,\s*/);
      const util = Number.parseFloat(utilText);
      const usedMb = Number.parseFloat(usedText);
      const totalMb = Number.parseFloat(totalText);
      if (![util, usedMb, totalMb].every(Number.isFinite) || totalMb <= 0) return finish(null);
      finish({ util: Math.round(util), usedMb: Math.round(usedMb), totalMb: Math.round(totalMb) });
    });
  });
}

async function readResourceUsage() {
  const totalRam = os.totalmem();
  const freeRam = os.freemem();
  const gpu = await readNvidiaUsage();
  return {
    cpuPercent: sampleSystemCpu(),
    ramPercent: Math.round((totalRam - freeRam) / totalRam * 100),
    ramUsedGb: (totalRam - freeRam) / 1024 ** 3,
    ramTotalGb: totalRam / 1024 ** 3,
    gpuPercent: gpu?.util ?? null,
    vramUsedMb: gpu?.usedMb ?? null,
    vramTotalMb: gpu?.totalMb ?? null
  };
}

function accessSettingsPath() {
  return join(app.getPath("userData"), "yuki-access.json");
}

function ollamaPresetPath() { return join(app.getPath("userData"), "yuki-model-preset.json"); }

async function restoreOllamaPreset() {
  try {
    const stored = JSON.parse(await readFile(ollamaPresetPath(), "utf8"));
    if (stored.preset === "core" || stored.preset === "code") selectedOllamaPreset = stored.preset;
  } catch {}
}

async function restoreApprovedFolder() {
  try {
    const stored = JSON.parse(await readFile(accessSettingsPath(), "utf8"));
    const projectCandidates = Array.isArray(stored.folders) ? stored.folders : [stored.folder];
    const computerCandidates = Array.isArray(stored.computerFolders) ? stored.computerFolders : [];
    const restorePaths = async (candidates) => (await Promise.all(candidates.filter(Boolean).map(async (candidate) => {
      const path = await realpath(String(candidate)).catch(() => null);
      if (path && (await stat(path).catch(() => null))?.isDirectory()) return path;
      return null;
    }))).filter(Boolean);
    approvedFolders = await restorePaths(projectCandidates);
    computerFolders = await restorePaths(computerCandidates);
  } catch {
    approvedFolders = [];
    computerFolders = [];
  }
}

async function chooseApprovedFolder(kind = "project") {
  const isComputerFolder = kind === "computer";
  const result = await dialog.showOpenDialog(mainWindow, {
    title: isComputerFolder ? "Choose a folder Yuki may search and read" : "Choose a project folder Yuki may access",
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const folderPath = await realpath(result.filePaths[0]);
  const pathParts = relative(parse(folderPath).root, folderPath).split(/[\\/]/).filter(Boolean);
  if ((!isComputerFolder && pathParts.length < 2) || pathParts.some((part) => blockedFolderNames.has(part.toLowerCase()))) {
    return { error: isComputerFolder ? "Windows system folders cannot be added." : "Choose a specific project folder, not a drive root or Windows system folder." };
  }
  const destination = isComputerFolder ? computerFolders : approvedFolders;
  if (!destination.includes(folderPath)) destination.push(folderPath);
  await writeFile(accessSettingsPath(), JSON.stringify({ folders: approvedFolders, computerFolders }, null, 2), "utf8");
  return { folderPath, folderName: folderPath.split(/[\\/]/).filter(Boolean).at(-1) };
}

function getAccessStatus() {
  return { folders: computerFolders };
}

function allAccessibleFolders() { return [...new Set([...approvedFolders, ...computerFolders])]; }

function isDriveRoot(folderPath) {
  const root = parse(folderPath).root;
  return Boolean(root) && folderPath.toLowerCase().replace(/[\\/]+$/, "") === root.toLowerCase().replace(/[\\/]+$/, "");
}

function isWithinApprovedFolder(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`));
}

async function searchApprovedFolder(queryText) {
  const allRoots = allAccessibleFolders();
  const roots = allRoots.filter((root) => !isDriveRoot(root));
  if (allRoots.length && !roots.length) return { error: "Drive-root-wide search is disabled. Add a specific folder to search; exact-path file reading and opening still work." };
  if (!roots.length) return { error: "Add a project folder or a computer access folder first." };
  const query = String(queryText || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (query.length < 2) return { error: "Please provide at least two characters to search for." };
  const needle = query.toLocaleLowerCase();
  const pending = roots.map((root) => ({ path: root, root, depth: 0 }));
  const matches = [];
  let visitedFiles = 0;
  let scannedBytes = 0;
  let truncated = false;
  while (pending.length && visitedFiles < 2500 && scannedBytes < 32 * 1024 * 1024 && matches.length < 12) {
    const current = pending.shift();
    const safePath = await realpath(current.path).catch(() => null);
    if (!safePath || !isWithinApprovedFolder(current.root, safePath)) continue;
    let entries;
    try { entries = await readdir(safePath, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      if (matches.length >= 12 || visitedFiles >= 2500 || scannedBytes >= 32 * 1024 * 1024) break;
      if (entry.name.startsWith(".")) continue;
      const fullPath = join(safePath, entry.name);
      if (entry.isDirectory() && current.depth < 12 && !skippedDirectoryNames.has(entry.name.toLowerCase())) {
        if (pending.length < 2500) pending.push({ path: fullPath, root: current.root, depth: current.depth + 1 });
        else truncated = true;
        continue;
      }
      const extension = extname(entry.name).toLowerCase();
      if (!entry.isFile() || !searchableExtensions.has(extension)) continue;
      visitedFiles += 1;
      const fileInfo = await stat(fullPath).catch(() => null);
      if (!fileInfo || fileInfo.size > 512 * 1024 || scannedBytes + fileInfo.size > 16 * 1024 * 1024) continue;
      scannedBytes += fileInfo.size;
      const content = await readFile(fullPath, "utf8").catch(() => "");
      const index = content.toLocaleLowerCase().indexOf(needle);
      const nameMatches = entry.name.toLocaleLowerCase().includes(needle);
      if (index < 0 && !nameMatches) continue;
      const excerpt = index < 0 ? "Filename matches." : content.slice(Math.max(0, index - 90), Math.min(content.length, index + query.length + 150)).replace(/\s+/g, " ").trim();
      const rootName = current.root.split(/[\\/]/).filter(Boolean).at(-1);
      matches.push({ file: `${rootName}/${relative(current.root, fullPath)}`, excerpt });
    }
  }
  return { matches, scannedFiles: visitedFiles, truncated: truncated || pending.length > 0 || visitedFiles >= 2500 || scannedBytes >= 32 * 1024 * 1024 };
}

async function findApprovedFile(reference) {
  const raw = String(reference || "").trim().replace(/^['"]|['"]$/g, "");
  const roots = allAccessibleFolders();
  if (!raw || !roots.length) return { error: "Add a project folder or a computer access folder first." };
  const candidates = isAbsolute(raw) ? [raw] : roots.map((root) => join(root, raw));
  for (const candidate of candidates) {
    const safePath = await realpath(candidate).catch(() => null);
    if (!safePath) continue;
    const root = roots.find((folder) => isWithinApprovedFolder(folder, safePath));
    if (!root) continue;
    const info = await stat(safePath).catch(() => null);
    if (info?.isFile()) return { path: safePath, root, info };
  }
  return { error: "I could not find that file inside the folders you granted access to." };
}

async function removeComputerFolder(folderPath) {
  const target = await realpath(String(folderPath || "")).catch(() => null);
  if (!target) return { removed: false };
  computerFolders = computerFolders.filter((folder) => folder !== target);
  approvedFolders = approvedFolders.filter((folder) => folder !== target);
  await writeFile(accessSettingsPath(), JSON.stringify({ folders: approvedFolders, computerFolders }, null, 2), "utf8");
  return { removed: true };
}

async function readApprovedFile(reference) {
  const found = await findApprovedFile(reference);
  if (found.error) return found;
  if (!readableExtensions.has(extname(found.path).toLowerCase())) return { error: "That file type is not supported for text reading." };
  if (found.info.size > 512_000) return { error: "That file is larger than the 512 KB reading limit." };
  const content = await readFile(found.path, "utf8").catch(() => null);
  if (content === null || content.includes("\0")) return { error: "I could not read that file as plain text." };
  return { content: content.slice(0, 16_000), truncated: content.length > 16_000, relativePath: relative(found.root, found.path), rootName: found.root.split(/[\\/]/).filter(Boolean).at(-1) };
}

async function openApprovedFile(reference) {
  const found = await findApprovedFile(reference);
  if (found.error) return found;
  if (blockedOpenExtensions.has(extname(found.path).toLowerCase())) return { error: "For safety, Yuki cannot launch executable or script files directly." };
  const error = await shell.openPath(found.path);
  return error ? { error: `Windows could not open that file: ${error}` } : { opened: found.path.split(/[\\/]/).at(-1) };
}

async function saveUserFile(fileName, content) {
  const cleanName = String(fileName || "new-file.txt").replace(/[\\/:*?"<>|]/g, "_").slice(0, 120) || "new-file.txt";
  const text = String(content || "");
  if (!text.trim()) return { error: "There is no file content to save." };
  if (Buffer.byteLength(text, "utf8") > 1_000_000) return { error: "The file content exceeds the 1 MB limit." };
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Choose where to save Yuki's file",
    defaultPath: cleanName,
    properties: ["showOverwriteConfirmation"]
  });
  if (result.canceled || !result.filePath) return { error: "Save cancelled; no file was changed." };
  const extension = extname(result.filePath).toLowerCase();
  if (blockedSaveExtensions.has(extension)) return { error: "Yuki cannot save executable files." };
  await writeFile(result.filePath, text, "utf8");
  return { fileName: result.filePath.split(/[\\/]/).at(-1) };
}

function openApprovedApp(appKey) {
  const target = allowedApps[String(appKey || "").toLowerCase()];
  if (!target) return { error: "Yuki can currently open only Notepad, Calculator, or File Explorer." };
  return new Promise((resolveResult) => {
    const child = spawn(target.command, [], { detached: true, stdio: "ignore", windowsHide: false });
    child.once("spawn", () => {
      child.unref();
      resolveResult({ opened: target.label });
    });
    child.once("error", () => resolveResult({ error: `I could not open ${target.label}.` }));
  });
}

function runtimeRoot() {
  return app.isPackaged ? join(process.resourcesPath, "yuki-runtime") : projectRoot;
}

// Seed per-user settings once; never package the developer's private .env file.
// Kullanıcı ayarını yalnızca ilk çalıştırmada oluştur; geliştiricinin gizli .env dosyasını pakete koyma.
async function initializeUserEnv() {
  if (!app.isPackaged) return;
  const userEnvPath = join(app.getPath("userData"), ".env");
  const exampleEnvPath = join(runtimeRoot(), ".env.example");
  if (!existsSync(userEnvPath) && existsSync(exampleEnvPath)) {
    await mkdir(dirname(userEnvPath), { recursive: true });
    await copyFile(exampleEnvPath, userEnvPath);
  }
}

function loadEnvFile() {
  const root = runtimeRoot();
  const candidates = [
    ...(app.isPackaged ? [join(app.getPath("userData"), ".env")] : [join(root, ".env")]),
    join(dirname(process.execPath), ".env"),
    ...(app.isPackaged ? [] : [join(projectRoot, ".env"), join(process.cwd(), ".env")])
  ];
  const envPath = candidates.find((candidate) => existsSync(candidate));
  if (!envPath) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function publishOllamaStatus(state, message) {
  ollamaStartupStatus = { state, message };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("ollama:startup-status", ollamaStartupStatus);
}

async function requestOllamaTags(baseUrl, timeoutMs = 1200) {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function locateOllamaExecutable() {
  const candidates = [
    process.env.OLLAMA_EXECUTABLE,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs", "Ollama", "ollama.exe"),
    process.env.ProgramFiles && join(process.env.ProgramFiles, "Ollama", "ollama.exe")
  ].filter(Boolean);
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return new Promise((resolveExecutable) => {
    let output = "";
    const child = spawn("where.exe", ["ollama.exe"], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output = (output + chunk).slice(0, 2048); });
    child.once("error", () => resolveExecutable(null));
    child.once("close", (code) => resolveExecutable(code === 0 ? output.split(/\r?\n/).map((line) => line.trim()).find((line) => line && existsSync(line)) || null : null));
  });
}

function wait(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

async function ensureOllamaModel(model = ollamaModelPresets[selectedOllamaPreset]) {
  ollamaModelOperation = ollamaModelOperation.catch(() => {}).then(() => ensureOllamaModelNow(model));
  return ollamaModelOperation;
}

async function ensureOllamaModelNow(model) {
  const urlText = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
  let baseUrl;
  try {
    const parsed = new URL(urlText);
    baseUrl = urlText.replace(/\/$/, "");
    const isLocal = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    let tags = await requestOllamaTags(baseUrl);
    if (!tags && isLocal) {
      publishOllamaStatus("starting", "OLLAMA BAŞLATILIYOR…");
      const executable = await locateOllamaExecutable();
      if (!executable) throw new Error("Ollama kurulumunu bulamadım. Ollama uygulamasının kurulu olduğunu kontrol et.");
      const host = parsed.hostname.includes(":") ? `[${parsed.hostname}]` : parsed.hostname;
      ollamaProcess = spawn(executable, ["serve"], {
        windowsHide: true,
        stdio: "ignore",
        env: { ...process.env, OLLAMA_HOST: `${host}:${parsed.port || "11434"}` }
      });
      ollamaProcessOwned = true;
      ollamaProcess.once("error", (error) => publishOllamaStatus("error", `Ollama başlatılamadı: ${error.message}`));
      ollamaProcess.once("close", () => {
        if (ollamaProcessOwned && ollamaStartupStatus.state !== "ready") publishOllamaStatus("error", "Ollama servisi kapandı.");
      });
      for (let attempt = 0; attempt < 90 && !tags; attempt += 1) {
        await wait(500);
        tags = await requestOllamaTags(baseUrl);
      }
    }
    if (!tags) throw new Error(isLocal ? "Ollama servisine bağlanamadım." : "Uzak Ollama sunucusuna bağlanamadım.");
    const availableModels = Array.isArray(tags.models) ? tags.models.map((item) => String(item.name || item.model || "")) : [];
    const installed = availableModels.some((name) => name === model || name.startsWith(`${model}:`) || model.startsWith(`${name}:`));
    if (!installed) throw new Error(`${model} modeli kurulu değil. Otomatik indirme yapmadım.`);
    if (loadedOllamaModel && loadedOllamaModel !== model) {
      await fetch(`${baseUrl}/api/generate`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: loadedOllamaModel, prompt: "", stream: false, keep_alive: 0 }),
        signal: AbortSignal.timeout(30_000)
      }).catch(() => {});
    }
    publishOllamaStatus("loading", `${model} belleğe yükleniyor…`);
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt: "", stream: false, keep_alive: "10m", options: { num_predict: 1 } }),
      signal: AbortSignal.timeout(180_000)
    });
    if (!response.ok) throw new Error(`Ollama modeli başlatamadı (HTTP ${response.status}).`);
    await response.json();
    loadedOllamaModel = model;
    publishOllamaStatus("ready", `${model} hazır`);
  } catch (error) {
    console.error("Ollama startup failed:", error);
    publishOllamaStatus("error", error.message || "Ollama başlatılamadı.");
  }
}

function setMemoryPaths(root) {
  if (process.env.YUKI_MEMORY_FILE) return;
  const dataRoot = app.isPackaged
    ? join(dirname(dirname(dirname(process.execPath))), "data")
    : join(root, "data");
  process.env.YUKI_MEMORY_FILE = join(dataRoot, "yuki-memory.json");
  process.env.YUKI_CONVERSATION_FILE = join(dataRoot, "yuki-conversations.jsonl");
}

function syncStatusWindow() {
  if (!statusWindow) return;
  const label = activeStatusText || "Yuki çalışıyor...";
  if (!statusWindow.webContents.isLoading()) {
    statusWindow.webContents.executeJavaScript(`document.querySelector('#s').textContent=${JSON.stringify(label)}`).catch(() => {});
  }
  if (activeStatusText && mainWindow && (mainWindow.isMinimized() || !mainWindow.isFocused())) {
    statusWindow.setAlwaysOnTop(true, "floating");
    statusWindow.showInactive();
  } else {
    statusWindow.hide();
  }
}

function createUnreadOverlayIcon() {
  const size = 32;
  const pixels = Buffer.alloc(size * size * 4);
  const glyph = ["00010", "00110", "00010", "00010", "00010", "00010", "00111"];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x + 0.5 - 16, y + 0.5 - 16);
      let color = distance <= 15 ? [245, 247, 250, 255] : null;
      if (distance <= 13) color = [45, 125, 220, 255];
      const glyphX = Math.floor((x - 11) / 2);
      const glyphY = Math.floor((y - 9) / 2);
      if (glyphY >= 0 && glyphY < glyph.length && glyphX >= 0 && glyphX < 5 && glyph[glyphY][glyphX] === "1") color = [255, 255, 255, 255];
      if (!color) continue;
      pixels.set(color, (y * size + x) * 4);
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size, scaleFactor: 1 });
}

function updateUnreadOverlay() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const count = unreadReplyCount;
  mainWindow.setOverlayIcon(count ? createUnreadOverlayIcon() : null, count ? `${count} unread Yuki reply${count === 1 ? "" : "ies"}` : "");
}

function createWindow(url) {
  const iconPath = app.isPackaged ? join(runtimeRoot(), "iconyuki.ico") : join(projectRoot, "build", "iconyuki.ico");
  // The project may be built without a redistributable icon. / Proje, dağıtım izni olan bir simge olmadan da derlenebilir.
  const windowIcon = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  if (windowIcon.isEmpty() && existsSync(iconPath)) console.error("Yuki icon could not be loaded:", iconPath);
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 780,
    minWidth: 860,
    minHeight: 620,
    show: false,
    frame: false,
    backgroundColor: "#080a10",
    icon: windowIcon,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(projectRoot, "preload.cjs")
    }
  });

  if (process.platform === "win32") {
    mainWindow.setIcon(windowIcon);
    mainWindow.setAppDetails({ appId: "com.projectyuki.yuki", appIconPath: iconPath });
  }

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("minimize", syncStatusWindow);
  mainWindow.on("restore", syncStatusWindow);
  mainWindow.on("blur", syncStatusWindow);
  mainWindow.on("focus", () => {
    unreadReplyCount = 0;
    updateUnreadOverlay();
    syncStatusWindow();
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("Yuki renderer stopped:", details.reason, details.exitCode);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === "https:") void shell.openExternal(target.href);
    } catch {
      // Block malformed external URLs. / Hatalı dış bağlantıları engelle.
    }
    return { action: "deny" };
  });
  mainWindow.loadURL(url);
  const area = screen.getPrimaryDisplay().workArea;
  statusWindow = new BrowserWindow({
    width: 310, height: 76, x: area.x + area.width - 326, y: area.y + area.height - 96,
    show: false, frame: false, resizable: false, movable: true, alwaysOnTop: true,
    skipTaskbar: true, transparent: true, backgroundColor: "#00000000",
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  statusWindow.webContents.once("did-finish-load", syncStatusWindow);
  statusWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:transparent;font:13px 'Segoe UI',sans-serif;color:#f2f3f5}.card{height:68px;border:1px solid #ffffff24;border-radius:14px;background:rgba(23,23,23,.96);box-shadow:0 8px 30px #0009;display:flex;align-items:center;padding:0 15px;gap:11px}.dot{width:9px;height:9px;border-radius:50%;background:#8bbcff;box-shadow:0 0 12px #347ddd88;animation:pulse 1.6s ease-in-out infinite}.text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}@keyframes pulse{50%{opacity:.48}}</style><div class="card"><span class="dot"></span><span class="text" id="s">Yuki çalışıyor...</span></div>`));
  statusWindow.on("closed", () => { statusWindow = null; });
}

async function boot() {
  const root = runtimeRoot();
  await initializeUserEnv();
  loadEnvFile();
  if (app.isPackaged && !process.env.QWEN_TTS_CACHE) {
    process.env.QWEN_TTS_CACHE = join(app.getPath("userData"), "qwen-tts");
  }
  setMemoryPaths(root);
  process.chdir(root);
  const { startServer } = await import(pathToFileURL(join(root, "server.js")).href);
  yukiServer = await startServer(Number(process.env.PORT || 3030));
  createWindow(`http://127.0.0.1:${yukiServer.port}`);
  if ((process.env.YUKI_PROVIDER || "").toLowerCase() === "ollama" && process.env.OLLAMA_URL) {
    void ensureOllamaModel();
  }
}

ipcMain.on("window-minimize", () => mainWindow?.minimize());
ipcMain.on("window-toggle-maximize", () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on("window-close", () => mainWindow?.close());
ipcMain.on("status:update", (_event, text) => {
  activeStatusText = String(text || "").trim().slice(0, 90);
  syncStatusWindow();
});
ipcMain.on("app:background-reply", (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || mainWindow.isFocused()) return;
  unreadReplyCount += 1;
  updateUnreadOverlay();
});

function assertTrustedRenderer(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error("Untrusted Yuki window.");
}

ipcMain.handle("agent:copy-text", (event, text) => {
  assertTrustedRenderer(event);
  clipboard.writeText(String(text || "").slice(0, 1_000_000));
  return true;
});
ipcMain.handle("agent:choose-folder", async (event) => {
  assertTrustedRenderer(event);
  return chooseApprovedFolder();
});
ipcMain.handle("agent:choose-project-folder", async (event) => {
  assertTrustedRenderer(event);
  return chooseApprovedFolder("project");
});
ipcMain.handle("agent:choose-computer-folder", async (event) => {
  assertTrustedRenderer(event);
  return chooseApprovedFolder("computer");
});
ipcMain.handle("agent:remove-computer-folder", async (event, path) => {
  assertTrustedRenderer(event);
  return removeComputerFolder(path);
});
ipcMain.handle("agent:access-status", (event) => {
  assertTrustedRenderer(event);
  return getAccessStatus();
});
ipcMain.handle("agent:resource-usage", async (event) => {
  assertTrustedRenderer(event);
  return readResourceUsage();
});
ipcMain.handle("agent:ollama-startup-status", (event) => {
  assertTrustedRenderer(event);
  return ollamaStartupStatus;
});
ipcMain.handle("agent:ollama-model-preset", (event) => {
  assertTrustedRenderer(event);
  return { preset: selectedOllamaPreset, model: ollamaModelPresets[selectedOllamaPreset] };
});
ipcMain.handle("agent:set-ollama-model-preset", async (event, preset) => {
  assertTrustedRenderer(event);
  if (preset !== "core" && preset !== "code") throw new Error("Unknown Yuki model preset.");
  selectedOllamaPreset = preset;
  await writeFile(ollamaPresetPath(), JSON.stringify({ preset }, null, 2), "utf8");
  void ensureOllamaModel(ollamaModelPresets[preset]);
  return { preset, model: ollamaModelPresets[preset] };
});
ipcMain.handle("agent:search-files", async (event, query) => {
  assertTrustedRenderer(event);
  return searchApprovedFolder(query);
});
ipcMain.handle("agent:read-file", async (event, path) => {
  assertTrustedRenderer(event);
  return readApprovedFile(path);
});
ipcMain.handle("agent:open-file", async (event, path) => {
  assertTrustedRenderer(event);
  return openApprovedFile(path);
});
ipcMain.handle("agent:save-file", async (event, fileName, content) => {
  assertTrustedRenderer(event);
  return saveUserFile(fileName, content);
});
ipcMain.handle("agent:open-app", (event, appKey) => {
  assertTrustedRenderer(event);
  return openApprovedApp(appKey);
});
ipcMain.handle("agent:google-search", async (event, query) => {
  assertTrustedRenderer(event);
  const cleanQuery = String(query || "").replace(/\s+/g, " ").trim().slice(0, 240);
  if (!cleanQuery) return { error: "Type a search query first." };
  await shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(cleanQuery)}`);
  return { opened: true };
});

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
  });
  await restoreApprovedFolder();
  await restoreOllamaPreset();
  return boot();
}).catch((error) => {
  console.error("Yuki desktop app could not start:", error);
  app.quit();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  statusWindow?.close();
  yukiServer?.server.close();
  yukiServer?.shutdownSpeechProcesses();
  if (ollamaProcessOwned && ollamaProcess && !ollamaProcess.killed) {
    ollamaProcessOwned = false;
    ollamaProcess.kill();
  }
});
