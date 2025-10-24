// src/utils/storage.js
// Async storage wrapper using chrome.storage.local when available else localStorage
const isChromeStorage =
  typeof chrome !== "undefined" &&
  chrome?.storage?.local &&
  chrome?.runtime?.id;

export async function loadAsync(key, fallback) {
  if (isChromeStorage) {
    return new Promise((res) => {
      chrome.storage.local.get([key], (obj) => {
        if (obj && obj[key] !== undefined) res(obj[key]);
        else res(fallback);
      });
    });
  } else {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.error("local load error", e);
      return fallback;
    }
  }
}

export async function saveAsync(key, value) {
  if (isChromeStorage) {
    return new Promise((res, rej) => {
      try {
        chrome.storage.local.set({ [key]: value }, () => res());
      } catch (e) { rej(e); }
    });
  } else {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return;
    } catch (e) {
      console.error("local save error", e);
    }
  }
}
