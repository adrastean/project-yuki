import { YUKI_NAME } from "./persona.js";

// Keep local, deterministic actions separate from language-model responses.
// Yerel ve öngörülebilir eylemleri dil modeli yanıtlarından ayrı tut.
export function detectLocalAction(text) {
  const normalized = text.toLocaleLowerCase("tr-TR");
  if (/saat kaç|saat nedir|şu an saat|what(?:'s| is) the time|tell me (?:the )?time|current time|time (?:in|for)\b/.test(normalized)) return "time";
  if (/tarih ne|bugün günlerden ne|bugünün tarihi|what(?:'s| is) the date|tell me (?:the )?date|today(?:'s)? date/.test(normalized)) return "date";
  return null;
}

export function detectLocalSmallTalk(text, language = "en") {
  if (language !== "tr") return null;
  const normalized = String(text).toLocaleLowerCase("tr-TR")
    .replace(/[ıİ]/g, "i")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length > 100) return null;
  if (/\b(nasilsin|iyi misin|ne haber|naber)\b/.test(normalized)) {
    return "İyiyim, teşekkür ederim. Sen nasılsın?";
  }
  if (/\b(gunaydin|iyi sabahlar|merhaba|selam)\b/.test(normalized)) {
    return "Günaydın! Nasılsın?";
  }
  return null;
}

export function detectLanguagePreference(text) {
  const normalized = String(text).toLocaleLowerCase("tr-TR")
    .replace(/[ıİ]/g, "i")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(?:turkce|turkish)\s+(?:konus|cevap ver|yanit ver|devam et|konusmaya devam et)\b/.test(normalized)
    || /\b(?:speak|reply|answer|talk|continue)\s+(?:in\s+)?turkish\b/.test(normalized)
    || /\b(?:switch|change)\s+to\s+turkish\b/.test(normalized)
    || /\b(?:from now on|starting now)\s+(?:reply in\s+)?turkish\b/.test(normalized)
    || /\b(?:neden|niye|why)\b.{0,100}\b(?:turkce|turkish)\b.{0,60}\b(?:soylemedin|cevap vermedin|yanitlamadin|konusmadin|answer in|speak in)\b/.test(normalized)
    || /\b(?:turkce|turkish)\b.{0,80}\b(?:soylemedin|cevap vermedin|yanitlamadin|konusmadin)\b/.test(normalized)) return "tr";
  if (/\b(?:ingilizce|english)\s+(?:konus|cevap ver|yanit ver|devam et|konusmaya devam et)\b/.test(normalized)
    || /\b(?:speak|reply|answer|talk|continue)\s+(?:in\s+)?english\b/.test(normalized)
    || /\b(?:switch|change)\s+to\s+english\b/.test(normalized)
    || /\b(?:from now on|starting now)\s+(?:reply in\s+)?english\b/.test(normalized)) return "en";
  return null;
}

export function runLocalAction(action, language = "en") {
  const now = new Date();
  const turkish = language === "tr";
  if (action === "time") return { action, result: `${turkish ? "Şu an saat" : "The current time is"} ${new Intl.DateTimeFormat(turkish ? "tr-TR" : "en-US", { timeStyle: "short", timeZone: "Europe/Istanbul" }).format(now)}.` };
  if (action === "date") return { action, result: `${turkish ? "Bugün" : "Today is"} ${new Intl.DateTimeFormat(turkish ? "tr-TR" : "en-US", { dateStyle: "full", timeZone: "Europe/Istanbul" }).format(now)}.` };
  return null;
}

export function demoReply(text, language = "en") {
  const action = detectLocalAction(text);
  const turkish = language === "tr";
  const local = action ? runLocalAction(action, language) : null;
  if (local) return { ...local, reply: local.result };
  const lower = text.toLocaleLowerCase("tr-TR");
  if (turkish) {
    if (/^(alo|merhaba|selam|hey|günaydın|iyi akşamlar|hello|hi|good morning|good evening)/.test(lower)) return { reply: "Merhaba. Seni duyuyorum, hazırım." };
    if (/^tamam|peki|olur|okay|ok|alright/.test(lower)) return { reply: "Peki. Ne yapmak istersin?" };
    if (/nasılsın|iyi misin|how are you/.test(lower)) return { reply: "İyiyim, teşekkür ederim. Sen nasılsın?" };
    if (/kimsin|adın ne|who are you|what is your name/.test(lower)) return { reply: "Ben masaüstü yapay zekâ yardımcın Yuki'yim." };
    if (/yardım|ne yapabiliyorsun|yetenek|help|what can you do/.test(lower)) return { reply: "Sohbet edebilir, saat ve tarihi söyleyebilir, ayrıca birkaç temel masaüstü komutunu tanıyabilirim." };
    if (/teşekkür|sağ ol|thanks|thank you/.test(lower)) return { reply: "Rica ederim." };
    return { reply: "Yerel model bağlantısını bekliyorum. Mesajını aldım ama henüz akıllı bir yanıt üretemedim." };
  }
  if (/^(alo|merhaba|selam|hey|günaydın|iyi akşamlar|hello|hi|good morning|good evening)/.test(lower)) return { reply: "Hello. I can hear you, and I am ready when you are." };
  if (/^tamam|peki|olur|okay|ok|alright/.test(lower)) return { reply: "All right. What would you like to do?" };
  if (/nasılsın|iyi misin|how are you/.test(lower)) return { reply: "I am doing well and ready to help." };
  if (/kimsin|adın ne|who are you|what is your name/.test(lower)) return { reply: "I am Yuki, your desktop AI companion." };
  if (/yardım|ne yapabiliyorsun|yetenek|help|what can you do/.test(lower)) return { reply: "I can chat, tell you the time or date, and recognize a few simple desktop commands." };
  if (/teşekkür|sağ ol|thanks|thank you/.test(lower)) return { reply: "You are welcome." };
  return { reply: `${YUKI_NAME} is waiting for the local model connection. I received your message, but I could not generate a smart reply yet.` };
}
