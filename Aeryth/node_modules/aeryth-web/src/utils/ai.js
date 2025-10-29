// src/utils/ai.js
// Gemini Nano wrappers + formatting + robust fallback

let sessions = {};
export const availableModel = () => !!(window && window.LanguageModel && window.LanguageModel.create);

export async function ensureSession(id, prompt) {
  if (!availableModel()) throw new Error("Gemini Nano not available.");
  if (!sessions[id]) {
    sessions[id] = await window.LanguageModel.create({
      initialPrompts: [{ role: "system", content: prompt }]
    });
  }
  return sessions[id];
}

export async function callGeminiTemp(id, history, settings, routines) {
  const last = history.at(-1)?.text || "";
  const system = `You are Aeryth. Tone:${settings?.aerythTone || "Friendly"}.`;

  if (!availableModel()) {
    console.warn("Gemini Nano not available, using local fallback");
    return formatAIText(`*(Offline mode)* ${localGrammarCorrect(last)}`);
  }

  try {
    const s = await ensureSession(id, system);
    const r = await s.prompt(last);
    const output = r?.output ?? r;
    return formatAIText(output);
  } catch (e) {
    console.error("callGeminiTemp error:", e);
    return formatAIText(`*(Offline mode)* ${localGrammarCorrect(last)}`);
  }
}

export async function callGeminiDiary(text) {
  if (!availableModel()) {
    console.warn("Gemini Nano not available, using local fallback for diary");
    return localGrammarCorrect(text);
  }

  const s = await window.LanguageModel.create({
    initialPrompts: [{ role: "system", content: "Correct grammar and spelling. Output only corrected text." }]
  });

  try {
    const r = await s.prompt(text);
    return formatAIText(r?.output ?? r);
  } finally {
    s.destroy?.();
  }
}

export function localGrammarCorrect(text) {
  if (!text) return "";
  let out = text.trim();
  out = out.replace(/\s+/g, " ");
  out = out.replace(/(^\s*\w|[.!?]\s*\w)/g, (c) => c.toUpperCase());
  out = out.replace(/\bi\b/g, "I");
  if (!/[.!?]$/.test(out)) out = out + ".";
  return out;
}

/* ------------------ Improved Markdown formatter ------------------ */
export function formatAIText(text) {
  if (!text) return "";

  let formatted = text;

  // Escape HTML
  formatted = formatted
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Links [text](url)
  formatted = formatted.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" class="text-violet-600 underline">$1</a>');

  // Bold **text**
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

  // Italics *text* or _text_
  // only convert if inside spaces or boundaries to avoid partials
  formatted = formatted.replace(/(^|[\s.,!?])\*(\S(.*?\S)?)\*($|[\s.,!?])/g, '$1<em>$2</em>$4');
  formatted = formatted.replace(/(^|[\s.,!?])_(\S(.*?\S)?)_($|[\s.,!?])/g, '$1<em>$2</em>$4');

  // Code
  formatted = formatted.replace(/`([^`]+)`/g, "<code class='bg-gray-100 rounded px-1'>$1</code>");

  // Lists
  formatted = formatted.replace(/^\s*[-*+]\s+(.*)$/gm, "<li>$1</li>");
  if (/<li>/.test(formatted)) formatted = formatted.replace(/(<li>.*<\/li>)/gs, "<ul class='list-disc ml-6'>$1</ul>");

  // Remove leftover single asterisks
  formatted = formatted.replace(/\*/g, "");

  // Newlines
  formatted = formatted.replace(/\n{2,}/g, "<br/><br/>").replace(/\n/g, "<br/>");

  return formatted.trim();
}
