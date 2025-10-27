// src/utils/ai.js
// Gemini Nano wrappers (kept as in original single file)
let sessions = {};
export const availableModel = () => !!(window && window.LanguageModel && window.LanguageModel.create);

export async function ensureSession(id, prompt) {
  if (!availableModel()) throw new Error("Gemini Nano not available.");
  if (!sessions[id]) sessions[id] = await window.LanguageModel.create({ initialPrompts: [{ role: "system", content: prompt }] });
  return sessions[id];
}

export async function callGeminiTemp(id, history, settings, routines) {
  const last = history.at(-1)?.text || "";
  const system = `You are Aeryth. Tone:${settings?.aerythTone||"Friendly"}.`;
  const s = await ensureSession(id, system);
  const r = await s.prompt(last);
  return r?.output ?? r;
}

export async function callGeminiDiary(text) {
  if (!availableModel()) throw new Error("Gemini Nano not available.");
  const s = await window.LanguageModel.create({ initialPrompts: [{ role: "system", content: "Correct grammar and spelling. Output only corrected text." }] });
  try {
    const r = await s.prompt(text);
    return r?.output ?? r;
  } finally { s.destroy?.(); }
}

// small local fallback grammar corrector
export function localGrammarCorrect(text) {
  if (!text) return "";
  let out = text.trim();
  out = out.replace(/\s+/g, " ");
  out = out.replace(/(^\s*\w|[.!?]\s*\w)/g, (c) => c.toUpperCase());
  out = out.replace(/\bi\b/g, "I");
  if (!/[.!?]$/.test(out)) out = out + ".";
  return out;
}
