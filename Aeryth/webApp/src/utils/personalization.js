// src/utils/personalization.js
// Build a compact profile summary and persist. Uses callGeminiTemp when available.

import { saveAsync } from "./storage";
import { callGeminiTemp, availableModel } from "./ai";

export async function buildAndPersistProfileSummary({ settings, routines, diary, limit = 500 }) {
  try {
    const base = {
      tone: settings?.aerythTone,
      userInfo: settings?.userInfo,
      routineCriteria: settings?.routineCriteria,
      recentGoals: (routines || []).slice(0, 10).map(r => ({ name: r.name, desc: r.description })),
      diarySamples: Object.keys(diary || {}).slice(-3).flatMap(k => Object.keys(diary[k] || {}).slice(0,3).flatMap(d => (diary[k][d]||[]).map(e => e.text))).slice(0,20),
    };
    let summary = JSON.stringify(base);
    if (summary.length > limit && availableModel && availableModel()) {
      try {
        const prompt = `You are Aeryth. Summarize the following user profile into a short persona (max ${limit} chars):\n\n${summary}`;
        const res = await callGeminiTemp("profile-summarizer", [{ role: "user", text: prompt }], settings, routines);
        summary = (typeof res === "string" ? res : String(res)).slice(0, limit);
      } catch (e) {
        summary = summary.slice(0, limit);
      }
    } else {
      summary = summary.slice(0, limit);
    }
    await saveAsync("aeryth_profile", summary);
    return summary;
  } catch (e) {
    console.error("buildAndPersistProfileSummary error", e);
    return null;
  }
}
