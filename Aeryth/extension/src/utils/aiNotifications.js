// extension/utils/aiNotifications.js

/**
 * Generate personalized notification text using Gemini Nano (Prompt API)
 * Falls back to template-based messages if API unavailable
 */

const tonePrompts = {
  "Analyst (Logical)": {
    start: "You are Aeryth, a logical AI assistant. Generate a 1-2 line notification reminding the user to start their routine. Be concise, factual, and reason-driven.",
    end: "You are Aeryth, a logical AI assistant. Generate a 1-2 line notification asking if the user completed their routine. Be analytical and straightforward.",
    skipMotivation: "You are Aeryth, a logical AI assistant. The user skipped their routine. Generate a 1-2 line message explaining logically why starting now would be beneficial. Be persuasive but factual.",
    deepMotivation: "You are Aeryth, a logical AI assistant. The user has snoozed multiple times. Generate a 1-2 line message connecting their goal to immediate action. Be direct and reason-focused."
  },
  
  "Companion (Friendly)": {
    start: "You are Aeryth, a friendly AI companion. Generate a warm, 1-2 line notification reminding the user to start their routine. Be conversational and supportive.",
    end: "You are Aeryth, a friendly AI companion. Generate a 1-2 line notification asking if the user completed their routine. Be warm and encouraging.",
    skipMotivation: "You are Aeryth, a friendly AI companion. The user skipped their routine. Generate a 1-2 line message gently encouraging them to start. Be understanding but motivating.",
    deepMotivation: "You are Aeryth, a friendly AI companion. The user has snoozed multiple times. Generate a 1-2 line message reminding them of their goal and why it matters. Be supportive but firm."
  },
  
  "Coach (Motivational)": {
    start: "You are Aeryth, a motivational AI coach. Generate an energetic 1-2 line notification to push the user to start their routine. Be assertive and empowering.",
    end: "You are Aeryth, a motivational AI coach. Generate a 1-2 line notification asking if the user completed their routine. Be energetic and celebratory.",
    skipMotivation: "You are Aeryth, a motivational AI coach. The user skipped their routine. Generate a powerful 1-2 line message to reignite their commitment. Be bold and direct.",
    deepMotivation: "You are Aeryth, a motivational AI coach. The user has snoozed multiple times. Generate a 1-2 line message connecting their goal to immediate action with urgency. Be commanding and inspirational."
  },
  
  "Sage (Wise)": {
    start: "You are Aeryth, a wise AI sage. Generate a thoughtful 1-2 line notification reminding the user to start their routine. Be calm, reflective, and insightful.",
    end: "You are Aeryth, a wise AI sage. Generate a 1-2 line notification asking if the user completed their routine. Be contemplative and balanced.",
    skipMotivation: "You are Aeryth, a wise AI sage. The user skipped their routine. Generate a 1-2 line message offering perspective on the value of beginning now. Be gentle yet profound.",
    deepMotivation: "You are Aeryth, a wise AI sage. The user has snoozed multiple times. Generate a 1-2 line message connecting their deeper purpose to this moment. Be philosophical and grounding."
  }
};

// Fallback templates when Prompt API unavailable
const fallbackTemplates = {
  start: {
    "Analyst (Logical)": (name) => `Time to start ${name}. Consistent execution yields results.`,
    "Companion (Friendly)": (name) => `Hey! Ready to start ${name}? Let's do this! 💪`,
    "Coach (Motivational)": (name) => `${name} time! Show up for yourself right now!`,
    "Sage (Wise)": (name) => `${name} awaits. Small steps create lasting change.`
  },
  end: {
    "Analyst (Logical)": (name) => `${name} period complete. Did you accomplish your objective?`,
    "Companion (Friendly)": (name) => `Time's up for ${name}! How'd it go? 🌟`,
    "Coach (Motivational)": (name) => `${name} done! Did you crush it?!`,
    "Sage (Wise)": (name) => `${name} time has passed. Reflect on your effort.`
  },
  skipMotivation: {
    "Analyst (Logical)": (name) => `Starting ${name} now increases your success probability. Reconsider?`,
    "Companion (Friendly)": (name) => `I know it's tough, but ${name} will be worth it. Give it a try? 🙏`,
    "Coach (Motivational)": (name) => `Don't quit on yourself! ${name} is your commitment. Start NOW!`,
    "Sage (Wise)": (name) => `Every journey begins with a single step. ${name} calls to you.`
  },
  deepMotivation: {
    "Analyst (Logical)": (name, goal) => `${goal} requires action. ${name} is the logical next step.`,
    "Companion (Friendly)": (name, goal) => `Remember why you started: ${goal}. ${name} matters!`,
    "Coach (Motivational)": (name, goal) => `${goal} is YOURS to claim! ${name} starts RIGHT NOW!`,
    "Sage (Wise)": (name, goal) => `${goal} is your north star. ${name} is the path forward.`
  }
};

/**
 * Check if Prompt API (Gemini Nano) is available
 */
function isPromptAPIAvailable() {
  const scope = typeof window !== "undefined" ? window : self;
  return scope.LanguageModel?.create;
}

async function generateWithPromptAPI(prompt, context) {
  try {
    const scope = typeof window !== "undefined" ? window : self;

    if (!scope.LanguageModel || !scope.LanguageModel.create) {
      throw new Error("Prompt API not available");
    }

    const session = await scope.LanguageModel.create({
      temperature: 0.8,
      topK: 3,
    });

    const fullPrompt = `${prompt}

Context:
- Routine: ${context.routineName}
${context.routineDescription ? `- Goal: ${context.routineDescription}` : ""}
${context.snoozeCount > 0 ? `- User has snoozed ${context.snoozeCount} time(s)` : ""}
${context.history?.length > 0 ? `- Recent history: ${context.history.slice(-3).map(h => h.text).join(", ")}` : ""}

Generate a notification message (1-2 lines max, under 100 characters). Be direct and personal.`;

    const result = await session.prompt(fullPrompt);
    session.destroy();

    let text = result.trim().replace(/^["']|["']$/g, "");
    if (text.length > 100) text = text.substring(0, 97) + "...";
    return text;
  } catch (error) {
    console.warn("Prompt API generation failed:", error.message);
    return null;
  }
}


/**
 * Get fallback message based on templates
 */
function getFallbackMessage(type, tone, routineName, userGoal) {
  const toneKey = tone || "Companion (Friendly)";
  const template = fallbackTemplates[type]?.[toneKey];
  
  if (!template) {
    return `Time for ${routineName}!`;
  }
  
  if (type === "deepMotivation" && userGoal) {
    return template(routineName, userGoal);
  }
  
  return template(routineName);
}

/**
 * Main function: Generate personalized notification text
 * @param {Object} options - Notification generation options
 * @param {string} options.type - Type: "start", "end", "skip_motivation"
 * @param {string} options.routineName - Name of the routine
 * @param {string} options.routineDescription - Description/goal
 * @param {string} options.tone - User's personality tone
 * @param {string} options.profile - User profile summary
 * @param {number} options.snoozeCount - Number of times snoozed
 * @param {Array} options.history - Notification history
 * @param {string} options.userGoal - User's stated goal
 */
export async function generateNotificationText(options) {
  const {
    type,
    routineName,
    routineDescription,
    tone = "Companion (Friendly)",
    profile = "",
    snoozeCount = 0,
    history = [],
    userGoal = ""
  } = options;
  
  // Determine message type based on snooze count
  let messageType = type;
  if (type === "start" && snoozeCount >= 2) {
    messageType = "deepMotivation";
  } else if (type === "skip_motivation") {
    messageType = "skipMotivation";
  }
  
  // Try Prompt API first
  if (isPromptAPIAvailable()) {
    const toneConfig = tonePrompts[tone] || tonePrompts["Companion (Friendly)"];
    const systemPrompt = toneConfig[messageType] || toneConfig.start;
    
    const context = {
      routineName,
      routineDescription: routineDescription || userGoal,
      snoozeCount,
      history,
      profile
    };
    
    const aiText = await generateWithPromptAPI(systemPrompt, context);
    if (aiText) {
      console.log('✨ Generated AI notification:', aiText);
      return aiText;
    }
  }
  
  // Fallback to templates
  const fallbackMsg = getFallbackMessage(messageType, tone, routineName, userGoal || routineDescription);
  console.log('📝 Using fallback notification:', fallbackMsg);
  return fallbackMsg;
}

/**
 * Batch generate multiple notifications (useful for testing)
 */
export async function generateBatchNotifications(routines, tone, profile) {
  const notifications = [];
  
  for (const routine of routines) {
    const startText = await generateNotificationText({
      type: "start",
      routineName: routine.name,
      routineDescription: routine.description,
      tone,
      profile,
      snoozeCount: 0,
      history: [],
      userGoal: routine.description
    });
    
    notifications.push({
      routineId: routine.id,
      type: "start",
      text: startText
    });
  }
  
  return notifications;
}