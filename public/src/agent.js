import { YUKI_NAME } from "./persona.js";

export function detectLocalAction(text) {
  const normalized = text.toLocaleLowerCase("tr-TR");
  if (/saat kaç|saat nedir|şu an saat/.test(normalized)) return "time";
  if (/tarih ne|bugün günlerden ne|bugünün tarihi/.test(normalized)) return "date";
  return null;
}

export function runLocalAction(action) {
  const now = new Date();
  if (action === "time") return { action, result: `Şu an ${new Intl.DateTimeFormat("tr-TR", { timeStyle: "short", timeZone: "Europe/Istanbul" }).format(now)}.` };
  if (action === "date") return { action, result: `Bugün ${new Intl.DateTimeFormat("tr-TR", { dateStyle: "full", timeZone: "Europe/Istanbul" }).format(now)}.` };
  return null;
}

export function demoReply(text) {
  const action = detectLocalAction(text);
  const local = action ? runLocalAction(action) : null;
  if (local) return { ...local, reply: `${local.result} Bunu bilmek neden bu kadar önemliydi ki... neyse!` };
  const lower = text.toLocaleLowerCase("tr-TR");
  if (/^(merhaba|selam|hey|günaydın|iyi akşamlar)/.test(lower)) return { reply: "S-selam! Buradayım işte. Beni özlediğini söylemeyeceksin, değil mi?" };
  if (/yardım|ne yapabiliyorsun|yetenek/.test(lower)) return { reply: "Şimdilik seninle konuşabiliyorum, saati ve tarihi söyleyebiliyorum. Biraz daha geliştirince bilgisayarında bazı işleri de yapacağım. Heyecanlanma hemen!" };
  if (/teşekkür|sağ ol/.test(lower)) return { reply: "Önemli değil... yani, teşekkür etmene gerek yoktu zaten!" };
  return { reply: `${YUKI_NAME} demo modunda çalışıyor. Gerçek model bağlandığında buna çok daha akıllı bir cevap vereceğim, tamam mı?` };
}
