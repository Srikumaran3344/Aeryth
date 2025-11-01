# Testing Instructions for Aeryth

## Project Overview

Aeryth is a hybrid application consisting of both a web application and a Chrome extension, designed to help users build consistent routines and combat procrastination through personalized AI assistance.

- **Web Application**: Hosted on Firebase at https://aeryth01.web.app/
- **Chrome Extension**: Provides background notifications and quick access to routines

---

## Prerequisites

### 1. Enable Gemini Nano API (Required)

Before installing the extension, you must enable the Gemini Nano API in Chrome:

1. Open Chrome and navigate to `chrome://flags`
2. Search for "Prompt API for Gemini Nano"
3. Set the flag to "Enabled"
4. Search for "Optimization Guide On Device Model"
5. Set this flag to "Enabled BypassPerfRequirement"
6. Restart Chrome
7. Wait a few minutes for the model to download in the background

To verify the model is ready:
1. Open DevTools (F12)
2. In Console, type: `await ai.languageModel.capabilities()`
3. You should see `available: "readily"` in the response

### 2. Google Account

A Google account is required for authentication and data synchronization across devices.

---

## Installation Instructions

### Web Application Setup

1. Navigate to https://aeryth01.web.app/ in any web browser
2. Click on the **Settings** panel (gear icon)
3. Click **Sign in with Google** to authenticate
4. Grant necessary permissions when prompted
5. Once signed in, you can begin using the web application

**Note**: Signing in on the web application is mandatory before using the Chrome extension, as it establishes your Aeryth account and synchronizes your data.

### Chrome Extension Setup

1. Download or clone the Aeryth project repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** using the toggle in the top-right corner
4. Click **Load unpacked**
5. Navigate to and select the `Aeryth/extension/dist` folder
6. The Aeryth extension icon should now appear in your Chrome toolbar
7. Click the extension icon to open the popup
8. Click **Sign in with Google** to connect to your Aeryth account
9. Grant necessary permissions for notifications and alarms

**Important**: The extension requires you to have already signed in on the web application. The extension enables background personalized notifications and provides quick access to your routines and calendar.

---

## Application Features and Usage

### 1. Explore Panel (New Chat)

**Purpose**: Discover new topics and routines before committing to a goal.

**How to use**:
- Navigate to the **Explore** or **New Chat** panel
- Engage in conversation with the AI assistant about potential routines, habits, or goals
- The AI provides personalized suggestions based on your interests
- The assistant will guide and nudge you toward setting up an official routine when you're ready
- Use this space to clarify your objectives before making commitments

### 2. Set Goal Panel (Create Routine)

**Purpose**: Officially establish a routine with specific parameters.

**How to use**:
- Navigate to the **Set Goal** panel
- Define your routine by providing:
  - **Topic**: The general category or area of focus
  - **Goal**: Specific objective you want to achieve
  - **Schedule**: Days of the week and time slots for your routine
  - **Description**: Optional details about what the routine involves
- After creating a routine, the **Sticky Notes** panel automatically opens

### 3. Sticky Notes Panel

**Purpose**: Set private, daily intentions and track self-reflection.

**How to use**:
- This panel opens automatically after creating a routine
- Write down what you expect to accomplish today
- Set goals for the next day
- Use this space for honest self-reflection
- Compare your expectations with actual achievements
- Track patterns in your planning versus execution
- Notes are private and serve as a personal accountability tool

### 4. Diary Panel

**Purpose**: Track daily progress and activities through written reflection.

**How to use**:
- Navigate to the **Diary** panel
- Write about your daily activities, progress, and experiences
- Use the built-in grammar correction feature for polished entries
- Be consistent with daily logging for best results
- At the end of each month, the AI automatically:
  - Analyzes your diary entries
  - Generates a comprehensive summary
  - Shows improvement trends
  - Evaluates routine adherence
  - Assesses whether you're staying on track with your goals
- Monthly summaries help you understand long-term patterns and progress

### 5. Settings Panel

**Purpose**: Manage account, preferences, and AI personality settings.

**How to use**:
- Navigate to the **Settings** panel
- **Authentication Options**:
  - Sign in with Google (recommended for data sync)
  - Use anonymous mode (data stored locally only)
- **Tone Settings**: Choose how the AI communicates with you:
  - Analyst (Logical): Data-driven, factual, analytical responses
  - Companion (Friendly): Warm, supportive, encouraging tone
  - Coach (Motivational): High-energy, assertive, commanding style
  - Sage (Wise): Philosophical, calm, reflective guidance
- **User Criteria**: Define how you want the AI to respond when you:
  - Skip a routine
  - Procrastinate on commitments
  - Struggle with consistency
- **About You**: Provide context about yourself, your goals, and preferences for more personalized AI interactions

### 6. Chrome Extension Features

**Background Notifications**:
- Receive personalized reminders at scheduled routine times
- Notifications work even when Chrome is minimized or closed
- Interactive buttons allow you to:
  - Start your routine immediately
  - Snooze for 2, 5, or 10 minutes
  - Skip with motivational follow-up
  - Mark completion status

**Quick View**:
- Click the extension icon for instant access to:
  - Today's upcoming events
  - Monthly calendar view with all scheduled routines
  - Current routine statuses (completed, in progress, skipped)
  - Settings and sign-out options

---

## Cross-Platform Compatibility

The web application (https://aeryth01.web.app/) is accessible from:
- Desktop browsers (Chrome, Firefox, Safari, Edge)
- Mobile browsers (iOS Safari, Android Chrome)
- Tablets

**Data Synchronization**: When signed in with your Google account, all data synchronizes across devices through Firebase. Changes made on mobile appear on desktop and vice versa.

**Note**: Background notifications are exclusive to the Chrome extension on desktop. Mobile users can access all other features through the web application.

---

## Testing Workflow

### Recommended Testing Sequence

1. **Initial Setup**:
   - Enable Gemini Nano API in Chrome
   - Sign in to web application at https://aeryth01.web.app/
   - Install Chrome extension
   - Sign in to extension with same Google account

2. **Explore Features**:
   - Start with Explore panel to understand AI capabilities
   - Create a test routine in Set Goal panel
   - Fill out the Sticky Notes that appear
   - Write a diary entry for today

3. **Test Notifications**:
   - Create a routine scheduled for 2-3 minutes from now
   - Close the extension popup
   - Wait for the notification to appear
   - Test notification buttons (Start, Snooze, Skip)
   - Verify motivation notification appears after skipping

4. **Check Synchronization**:
   - Make changes on web application
   - Open extension to verify updates appear
   - Mark routines as completed in notifications
   - Check calendar in extension to see status updates

5. **Test Settings**:
   - Change AI tone in Settings panel
   - Create a new routine and verify notification tone matches
   - Update user criteria and observe AI response changes

---

## Troubleshooting

**Extension not working**:
- Verify Gemini Nano API is enabled and downloaded
- Check that you're signed in on both web app and extension
- Ensure notification permissions are granted in Chrome settings

**Notifications not appearing**:
- Verify extension is installed and active
- Check that routines are scheduled for future times
- Ensure Chrome has notification permissions
- Try reloading the extension

**Data not syncing**:
- Confirm you're signed in with the same Google account on all devices
- Check internet connection
- Try signing out and back in

**Calendar not updating**:
- Open the extension popup to trigger a sync
- Wait 1 minute for automatic sync to occur
- Verify routine was properly saved in web application

---

## Support and Feedback

For issues, questions, or feedback during testing, please note the following information:
- Browser version
- Operating system
- Specific steps to reproduce the issue
- Screenshots if applicable

This helps improve Aeryth for all users.