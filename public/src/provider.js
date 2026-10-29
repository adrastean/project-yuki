import { YUKI_SYSTEM_PROMPT } from "./persona.js";

function hasOpenAIProvider() { return Boolean(process.env.OPENAI_API_KEY); }
function hasOllamaProvider() { return Boolean(process.env.OLLAMA_URL); }
export function providerStatus() {
  if (hasOpenAIProvider()) return { mode: "openai-compatible", model: process.env.YUKI_MODEL || "gpt-4o-mini" };
  if (hasOllamaProvider()) return { mode: "ollama", model: process.env.OLLAMA_MODEL || "llama3.2:3b" };
  return { mode: "demo", model: null };
}

async function openAICompatible(messages) {
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetch(`${base}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: JSON.stringify({ model: process.env.YUKI_MODEL || "gpt-4o-mini", messages, temperature: 0.85, max_tokens: 300 }) });
  if (!response.ok) throw new Error(`OpenAI-compatible provider error: ${response.status}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "Buna cevap veremedim...";
}

async function ollama(messages) {
  const base = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
  const response = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: process.env.OLLAMA_MODEL || "llama3.2:3b", messages, stream: false, options: { temperature: 0.85 } }) });
  if (!response.ok) throw new Error(`Ollama provider error: ${response.status}`);
  const data = await response.json();
  return data.message?.content?.trim() || "Buna cevap veremedim...";
}

export async function generateReply(history) {
  const messages = [{ role: "system", content: YUKI_SYSTEM_PROMPT }, ...history.slice(-12)];
  if (hasOpenAIProvider()) return openAICompatible(messages);
  if (hasOllamaProvider()) return ollama(messages);
  return null;
}
