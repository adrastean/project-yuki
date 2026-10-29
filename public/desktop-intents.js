export function desktopIntent(message) {
  const directText = String(message || "").trim().replace(/^(?:hey\s+)?yuki[, :\s]+/i, "").replace(/^please\s+/i, "");
  const turkishRead = directText.match(/^(?:oku|dosyayı oku|dosyanın içeriğini oku)\s+["“]?(.+?)["”]?[.!?]*$/i);
  if (turkishRead?.[1]?.trim()) return { type: "read-file", path: turkishRead[1].trim() };
  const turkishOpen = directText.match(/^(?:dosyayı aç|aç)\s+["“]?(.+?)["”]?[.!?]*$/i);
  if (turkishOpen?.[1]?.trim()) return { type: "open-file", path: turkishOpen[1].trim() };
  const directPathRead = String(message || "").trim().match(/^(?:read|show|inspect)\s+(?:the\s+)?(?:file\s+)?["“]?(.+?)["”]?[.!?]*$/i);
  if (directPathRead && (/[\\/]/.test(directPathRead[1]) || /\.[a-z0-9]{1,8}$/i.test(directPathRead[1]))) return { type: "read-file", path: directPathRead[1].trim() };
  const directPathOpen = String(message || "").trim().match(/^(?:open|launch)\s+(?:the\s+)?file\s+["“]?(.+?)["”]?[.!?]*$/i);
  if (directPathOpen?.[1]?.trim()) return { type: "open-file", path: directPathOpen[1].trim() };
  const writeFileCommand = String(message || "").trim().match(/^(?:write|create)\s+(?:the\s+)?file\s+["“]?(.+?)\s+with\s+content:\s*([\s\S]+)$/i);
  if (writeFileCommand?.[1]?.trim()) return { type: "write-file", path: writeFileCommand[1].trim(), content: writeFileCommand[2] };
  const writeFileTr = String(message || "").trim().match(/^dosyaya\s+yaz\s+["“]?(.+?)["”]?\s*:\s*([\s\S]+)$/i);
  if (writeFileTr?.[1]?.trim()) return { type: "write-file", path: writeFileTr[1].trim(), content: writeFileTr[2] };
  let text = String(message || "").trim().replace(/^(?:hey\s+)?yuki[,:\s]+/i, "");
  text = text.replace(/^(?:(?:yes|sure|okay|ok)[,.!?\s]+)+/i, "").replace(/^please[,.!?\s]+/i, "").trim();
  const googlePatterns = [
    /^(?:(?:can|could|would)\s+you\s+)?(?:please\s+)?(?:search(?:\s+on)?\s+google|google)\s+(?:for\s+)?(.+?)(?:\s+(?:please|for\s+me))*[.!?]*$/i,
    /^(?:(?:can|could|would)\s+you\s+)?(?:please\s+)?(?:open|search\s+for)\s+(.+?)\s+(?:in|on)\s+google[.!?]*$/i
  ];
  for (const pattern of googlePatterns) {
    const match = text.match(pattern);
    if (match?.[1]?.trim()) return { type: "google-search", query: match[1].trim().replace(/[.!?]+$/, "") };
  }
  const openMatch = text.match(/^(?:(?:can|could|would)\s+you\s+)?(?:please\s+)?(?:open|launch|start)\s+(?:the\s+)?(notepad|calculator|calc|file explorer|explorer)(?:\s+(?:directly|for\s+me|by\s+yourself))*[.!?]*$/i);
  if (openMatch) return { type: "open-app", app: /calculator|calc/i.test(openMatch[1]) ? "calculator" : /explorer/i.test(openMatch[1]) ? "explorer" : "notepad" };
  if (/^(?:notepad|not\s+defteri)(?:'i)?\s+aç[.!?]*$/i.test(text)) return { type: "open-app", app: "notepad" };
  if (/^hesap\s+makinesini\s+aç[.!?]*$/i.test(text)) return { type: "open-app", app: "calculator" };
  if (/^dosya\s+gezginini\s+aç[.!?]*$/i.test(text)) return { type: "open-app", app: "explorer" };
  const searchPatterns = [
    /^(?:search|find|look\s+for)\s+(?:my\s+)?(?:files|folder)\s+for\s+(.+)$/i,
    /^(?:search|find)\s+(.+?)\s+in\s+(?:my\s+)?folder$/i,
    /^(?:search|find|look\s+for)\s+(.+?)\s+in\s+(?:the\s+)?(?:selected|chosen|my)\s+(?:folder|files)$/i,
    /^search\s+the\s+selected\s+folder\s+for\s+(.+)$/i,
    /^(?:klasörde|dosyalarda|dosyada)\s+ara\s+(.+)$/i
  ];
  for (const pattern of searchPatterns) {
    const match = text.match(pattern);
    if (match?.[1]?.trim()) return { type: "search-files", query: match[1].trim() };
  }
  return null;
}
