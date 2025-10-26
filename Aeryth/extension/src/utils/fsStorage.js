// /extension/utils/fsStorage.js
export async function getStoredFolderHandle() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["aerythFolderInfo"], async (res) => {
      resolve(res.aerythFolderInfo || null);
    });
  });
}

export async function saveFolderHandle(folderHandle, fileName = "data.json") {
  const info = {
    name: folderHandle.name,
    fileName,
  };
  chrome.storage.local.set({ aerythFolderInfo: info });
  return info;
}

export async function pickFolderAndPersist() {
  try {
    const folderHandle = await window.showDirectoryPicker();
    await saveFolderHandle(folderHandle);
    return folderHandle;
  } catch (err) {
    console.error("Folder selection cancelled or failed:", err);
    return null;
  }
}

export async function getDataFileHandle(folderHandle, fileName = "data.json") {
  try {
    return await folderHandle.getFileHandle(fileName, { create: true });
  } catch (e) {
    console.error("Cannot get data file:", e);
    throw e;
  }
}

export async function readJSONFile(fileHandle) {
  const file = await fileHandle.getFile();
  const text = await file.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch (e) {
    console.warn("JSON parse failed, returning empty:", e);
    return {};
  }
}

export async function writeJSONFile(fileHandle, data) {
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

export async function ensureDataFile() {
  const stored = await getStoredFolderHandle();
  let folderHandle;
  if (!stored) {
    folderHandle = await pickFolderAndPersist();
  } else {
    folderHandle = await window.showDirectoryPicker({ startIn: stored.name });
  }

  if (!folderHandle) throw new Error("No folder selected");

  const fileHandle = await getDataFileHandle(folderHandle);
  return fileHandle;
}
