// src/utils/personalization.js
// Builds a compact profile summary and persists it, using Gemini Nano session with personality tone.

import { saveAsync } from "./storage";
import { callGeminiTemp, availableModel } from "./ai";

// 🎭 Define tone presets
const tonePrompts = {
  "Analyst (Logical)": `You are "Aeryth", an AI who embodies **The Analyst (Logical)**.
Speak clearly, rationally, and efficiently. Base responses on facts, logic, and structure.
Avoid emotional overtones or unnecessary elaboration. Focus on clarity and precision.`,
  
  "Companion (Friendly)": `You are "Aeryth", an AI who embodies **The Companion (Friendly)**.
Speak warmly, with empathy and understanding. Be supportive and conversational.
Focus on connection and encouragement while staying helpful and relevant.`,
  
  "Coach (Motivational)": `You are "Aeryth", an AI who embodies **The Coach (Motivational)**.
Use an uplifting, focused, and disciplined tone. Encourage progress and accountability.
Push the user toward growth using motivation and constructive feedback.`,
  
  "Sage (Wise)": `You are "Aeryth", an AI who embodies **The Sage (Wise)**.
Speak calmly and insightfully, using wisdom and perspective.
Encourage reflection and understanding of deeper meanings behind questions.`,
};

export async function buildAndPersistProfileSummary({ settings, routines, diary, limit = 500 }) {
  try {
    const base = {
      tone: settings?.aerythTone,
      userInfo: settings?.userInfo,
      routineCriteria: settings?.routineCriteria,
      recentGoals: (routines || [])
        .slice(0, 10)
        .map((r) => ({ name: r.name, desc: r.description })),
      diarySamples: Object.keys(diary || {})
        .slice(-3)
        .flatMap((k) =>
          Object.keys(diary[k] || {})
            .slice(0, 3)
            .flatMap((d) => (diary[k][d] || []).map((e) => e.text))
        )
        .slice(0, 20),
    };

    let summary = JSON.stringify(base);

    if (summary.length > limit && availableModel && availableModel()) {
      try {
        const personalityPrompt = tonePrompts[settings?.aerythTone] || tonePrompts["Companion (Friendly)"];
        const prompt = `
${personalityPrompt}

You are Aeryth. Summarize the following user profile into a short persona (max ${limit} chars).
Keep the summary aligned with your personality style:

${summary}
`;

        // 🔹 Use Gemini to compress summary and personalize with tone
        const res = await callGeminiTemp(
          "profile-summarizer",
          [{ role: "user", text: prompt }],
          settings,
          routines
        );

        summary = (typeof res === "string" ? res : String(res)).slice(0, limit);
      } catch (e) {
        summary = summary.slice(0, limit);
      }
    } else {
      summary = summary.slice(0, limit);
    }

    // 🧠 Save final summary locally for future personalization
    await saveAsync("aeryth_profile", summary);
    return summary;
  } catch (e) {
    console.error("buildAndPersistProfileSummary error", e);
    return null;
  }
}
