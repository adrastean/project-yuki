import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// Chat archives and memory are written only to local per-user storage.
// Sohbet arşivi ve hafıza yalnızca kullanıcının yerel depolama alanına yazılır.
const memoryFile = () => resolve(process.env.YUKI_MEMORY_FILE || "data/yuki-memory.json");
const conversationFile = () => resolve(process.env.YUKI_CONVERSATION_FILE || "data/yuki-conversations.jsonl");
const MAX_FACTS = 200;
const MAX_RELEVANT_MESSAGES = 8;
const MAX_CONTEXT_CHARS = 4500;
const MAX_ARCHIVE_SESSIONS = 80;
const SESSION_GAP_MS = 45 * 60 * 1000;

let writeQueue = Promise.resolve();

function queueWrite(task) {
  const next = writeQueue.then(task, task);
  writeQueue = next.catch(() => {});
  return next;
}

async function ensureParent(path) {
  await mkdir(dirname(path), { recursive: true });
}

async function readMemory() {
  const path = memoryFile();
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return { version: 1, facts: Array.isArray(parsed.facts) ? parsed.facts : [] };
  } catch (error) {
    if (error.code !== "ENOENT") console.error(`Yuki memory read error: ${error.message}`);
    return { version: 1, facts: [] };
  }
}

function cleanText(value, limit = 700) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function tokens(value) {
  return new Set(
    cleanText(value, 2000)
      .toLocaleLowerCase("en-US")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2)
  );
}

function overlapScore(queryTokens, text) {
  const textTokens = tokens(text);
  let score = 0;
  for (const token of queryTokens) if (textTokens.has(token)) score += 1;
  return score;
}

export function parseMemoryCommand(text) {
  const value = cleanText(text);
  if (/^(?:forget|delete|remove)\s+(?:everything|all(?: my)? memories?|all memory)$/i.test(value)) {
    return { type: "forget-all" };
  }
  const remember = value.match(/^(?:remember(?: that)?|please remember(?: that)?|don't forget(?: that)?)\s+(.+)$/i);
  if (remember) return { type: "remember", text: cleanText(remember[1]) };
  const forget = value.match(/^(?:forget|delete|remove)(?: that)?\s+(.+)$/i);
  if (forget) return { type: "forget", text: cleanText(forget[1]) };
  return null;
}

export async function rememberFact(text) {
  const fact = cleanText(text);
  if (!fact) return false;
  return queueWrite(async () => {
    const path = memoryFile();
    const memory = await readMemory();
    const existing = memory.facts.find((entry) => entry.text.toLocaleLowerCase("en-US") === fact.toLocaleLowerCase("en-US"));
    if (existing) {
      existing.updatedAt = new Date().toISOString();
    } else {
      memory.facts.push({ text: fact, createdAt: new Date().toISOString() });
      memory.facts = memory.facts.slice(-MAX_FACTS);
    }
    await ensureParent(path);
    await writeFile(path, `${JSON.stringify(memory, null, 2)}\n`, "utf8");
    return true;
  });
}

export async function forgetFacts(query = "") {
  return queueWrite(async () => {
    const path = memoryFile();
    const memory = await readMemory();
    const before = memory.facts.length;
    if (!query) memory.facts = [];
    else {
      const queryTokens = tokens(query);
      memory.facts = memory.facts.filter((entry) => overlapScore(queryTokens, entry.text) === 0);
    }
    await ensureParent(path);
    await writeFile(path, `${JSON.stringify(memory, null, 2)}\n`, "utf8");
    return before - memory.facts.length;
  });
}

export async function clearMemory() {
  return queueWrite(async () => {
    await rm(memoryFile(), { force: true });
    await rm(conversationFile(), { force: true });
  });
}

export async function recordConversation(role, content) {
  const text = cleanText(content, 2000);
  if (!text) return;
  const path = conversationFile();
  try {
    await queueWrite(async () => {
      await ensureParent(path);
      await appendFile(path, `${JSON.stringify({ at: new Date().toISOString(), role, text })}\n`, "utf8");
    });
  } catch (error) {
    console.error(`Yuki conversation write error: ${error.message}`);
  }
}

async function readConversation() {
  try {
    const raw = await readFile(conversationFile(), "utf8");
    return raw.split(/\r?\n/).filter(Boolean).slice(-5000).flatMap((line) => {
      try {
        const parsed = JSON.parse(line);
        return parsed?.text && parsed?.role ? [parsed] : [];
      } catch {
        return [];
      }
    });
  } catch (error) {
    if (error.code !== "ENOENT") console.error(`Yuki conversation read error: ${error.message}`);
    return [];
  }
}

export async function listConversationSessions() {
  const entries = await readConversation();
  const sessions = [];
  let current = null;
  let previousAt = 0;
  for (const entry of entries) {
    const at = Date.parse(entry.at);
    if (!current || (Number.isFinite(at) && previousAt && at - previousAt > SESSION_GAP_MS)) {
      current = {
        id: `archive-${Number.isFinite(at) ? at : Date.now()}-${sessions.length}`,
        title: "New chat",
        updatedAt: entry.at || new Date().toISOString(),
        messages: []
      };
      sessions.push(current);
    }
    current.messages.push({ role: entry.role, content: entry.text });
    current.updatedAt = entry.at || current.updatedAt;
    if (entry.role === "user" && current.title === "New chat") current.title = entry.text.replace(/\s+/g, " ").trim().slice(0, 38) || "New chat";
    if (Number.isFinite(at)) previousAt = at;
  }
  return sessions.slice(-MAX_ARCHIVE_SESSIONS);
}

export async function getMemoryContext(query) {
  const [memory, conversations] = await Promise.all([readMemory(), readConversation()]);
  const queryTokens = tokens(query);
  const facts = memory.facts.slice(-30).map((entry) => `- ${entry.text}`);
  const relevant = conversations
    .map((entry, index) => ({ entry, index, score: overlapScore(queryTokens, entry.text) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.index - left.index)
    .slice(0, MAX_RELEVANT_MESSAGES)
    .sort((left, right) => left.index - right.index)
    .map(({ entry }) => `- ${entry.role}: ${entry.text}`);
  const sections = [];
  if (facts.length) sections.push(`Remembered facts:\n${facts.join("\n")}`);
  if (relevant.length) sections.push(`Relevant older conversation:\n${relevant.join("\n")}`);
  if (!sections.length) return "";
  return sections.join("\n\n").slice(0, MAX_CONTEXT_CHARS);
}
