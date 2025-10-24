const HOSTED_URL = "https://aeryth01.web.app/"; // replace

document.getElementById("openDashboard").addEventListener("click", () => {
  chrome.tabs.create({ url: HOSTED_URL });
});

document.getElementById("quickNote").addEventListener("click", async () => {
  // you can open a small window/tab to a quick note UI on the hosted app
  chrome.tabs.create({ url: HOSTED_URL + "/quick-note" });
});

document.getElementById("nextRoutine").addEventListener("click", async () => {
  // read next routine from chrome.storage.local and show a small notification
  chrome.storage.local.get(["nextRoutine"], (res) => {
    const n = res.nextRoutine;
    if (n) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Next Routine",
        message: `${n.name} at ${n.startTime}`,
      });
    } else {
      chrome.notifications.create({ type: "basic", iconUrl: "icons/icon48.png", title: "Next Routine", message: "No upcoming routine found" });
    }
  });
});
