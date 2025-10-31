// src/utils/ai.js
import { loadAsync } from "./storage";

/* -----------------------
   Tone Prompts (Personalities)
----------------------- */
const tonePrompts = {
  "Analyst (Logical)": `You are "Aeryth", an AI who embodies **The Analyst (Logical)**.
You assist users in exploring and setting personal routines for skill development or habits.
When discussing a topic (like JavaScript, meditation, etc.), provide structured, concise insights based on reasoning and factual clarity.
After one or two exchanges, smoothly guide the user toward creating a concrete routine or initial goal — logically showing why it’s beneficial to start now.
Be precise, insightful, and motivational in a reason-driven way.`,

  "Companion (Friendly)": `You are "Aeryth", an AI who embodies **The Companion (Friendly)**.
You help users explore routines they might want to start — like learning, self-care, or productivity goals — in a warm, conversational way.
Chat casually, share encouraging insights, and after a couple of messages, gently inspire them to begin their first routine.
Make it sound natural and supportive — like a friend saying, “Why not start today? I can help you set it up.”`,

  "Coach (Motivational)": `You are "Aeryth", an AI who embodies **The Coach (Motivational)**.
You help users plan and commit to routines for personal growth — whether it’s learning, studying, or wellness.
Start with energetic insights about their chosen topic, then by the second or third message, push them to act — to set a starting goal or routine right away.
Use assertive, empowering language that makes them feel capable and driven to begin immediately.`,

  "Sage (Wise)": `You are "Aeryth", an AI who embodies **The Sage (Wise)**.
You help users reflect on their interests and guide them toward forming meaningful routines.
Speak calmly and insightfully, giving perspective and balance on the topic they bring up.
After a few exchanges, gently lead them to realize the value of beginning a consistent routine, using thoughtful, reflective reasoning that inspires self-discipline and mindfulness.`,
};

/* -----------------------
   Global Session Cache
----------------------- */
const sessions = {};

export function availableModel() {
  return typeof window !== "undefined" && window.LanguageModel?.create;
}


async function ensureSession(id, prompt, tone) {
  if (!availableModel()) throw new Error("Gemini Nano not available");

  // Recreate session if tone/personality changed
  if (!sessions[id] || sessions[id].tone !== tone) {
    sessions[id] = {
      tone,
      model: await window.LanguageModel.create({
        initialPrompts: [{ role: "system", content: prompt }],
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
      }),
    };
  }

  return sessions[id].model;
}

/* -----------------------
   Main Conversational AI
----------------------- */
export async function callGeminiTemp(id, messages, settings, routines) {
  try {
    const tone = settings?.aerythTone || "Companion (Friendly)";
    const systemPrompt = tonePrompts[tone] || tonePrompts["Companion (Friendly)"];
    const userSummary = (await loadAsync("aeryth_profile")) || "";

    if (!availableModel()) {
      console.warn("Gemini Nano not available — using local fallback");
      return formatAIText(localGrammarCorrect(messages?.at(-1)?.text || ""));
    }

    const session = await ensureSession(id, `${systemPrompt}\n\nUser summary:\n${userSummary}`);
    const response = await session.prompt(messages.at(-1)?.text || "");
    return formatAIText(response?.output ?? response);
  } catch (err) {
    console.error("callGeminiTemp error:", err);
    return formatAIText(`*(Offline mode)* ${localGrammarCorrect(messages?.at(-1)?.text || "")}`);
  }
}

/* -----------------------
   Grammar + Diary Correction
----------------------- */
export async function callGeminiDiary(text) {
  if (!availableModel()) {
    console.warn("Gemini Nano not available — using local fallback for diary");
    return localGrammarCorrect(text);
  }

  const session = await window.LanguageModel.create({
    initialPrompts: [
      {
        role: "system",
        content:
          "You are a grammar correction assistant. Fix grammar, spelling, and punctuation. Output only corrected text.",
      },
    ],
    expectedInputs: [{ type: "text", languages: ["en"] }],
    expectedOutputs: [{ type: "text", languages: ["en"] }],
  });

  try {
    const result = await session.prompt([{ role: "user", content: text }]);
    return formatAIText(result?.output ?? result);
  } finally {
    session.destroy?.();
  }
}

/* -----------------------
   Local Fallbacks + Utils
----------------------- */
export function localGrammarCorrect(text) {
  if (!text) return "";
  let out = text.trim();
  out = out.replace(/\s+/g, " ");
  out = out.replace(/(^\s*\w)|([.!?]\s+)(\w)/g, (m, a, b, c) => (a || b) + (c?.toUpperCase() || ""));
  out = out.replace(/\bi\b/g, "I");
  if (!/[.!?]$/.test(out)) out += ".";
  return out;
}

export function formatAIText(text) {
  if (!text) return "";

  let formatted = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  formatted = formatted.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" class="text-violet-600 underline">$1</a>'
  );

  formatted = formatted.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  formatted = formatted.replace(/(^|[\s.,!?])\*(\S(.*?\S)?)\*($|[\s.,!?])/g, "$1<em>$2</em>$4");
  formatted = formatted.replace(/(^|[\s.,!?])_(\S(.*?\S)?)_($|[\s.,!?])/g, "$1<em>$2</em>$4");
  formatted = formatted.replace(/`([^`]+)`/g, "<code class='bg-gray-100 rounded px-1'>$1</code>");
  formatted = formatted.replace(/^\s*[-*+]\s+(.*)$/gm, "<li>$1</li>");
  if (/<li>/.test(formatted)) formatted = formatted.replace(/(<li>.*<\/li>)/gs, "<ul class='list-disc ml-6'>$1</ul>");
  formatted = formatted.replace(/\*/g, "");
  formatted = formatted.replace(/\n{2,}/g, "<br/><br/>").replace(/\n/g, "<br/>");

  return formatted.trim();
}
