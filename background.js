const OFFSCREEN_URL = chrome.runtime.getURL("offscreen.html");
let recordingDownloadId = null;

const ensureOffscreen = async () => {
  const hasDocument = await chrome.offscreen.hasDocument();
  if (hasDocument) {
    return;
  }
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["DISPLAY_MEDIA", "BLOBS"],
    justification: "タブの画面録画や画像処理に使用します。"
  });
};

const timestampLabel = () => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

const runCountdownOverlay = async (tabId, seconds) => {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (duration) => {
      return new Promise((resolve) => {
        const existing = document.getElementById("__tab_capture_countdown");
        if (existing) {
          existing.remove();
        }
        if (!document.getElementById("__tab_capture_countdown_style")) {
          const style = document.createElement("style");
          style.id = "__tab_capture_countdown_style";
          style.textContent = `
            @keyframes tcs-pop {
              0% { transform: scale(0.88); opacity: 0.2; }
              35% { transform: scale(1.08); opacity: 1; }
              100% { transform: scale(1); opacity: 1; }
            }
            @keyframes tcs-ring {
              0% { transform: scale(0.7); opacity: 0.0; }
              40% { opacity: 0.35; }
              100% { transform: scale(1.2); opacity: 0.0; }
            }
            #__tab_capture_countdown {
              position: fixed;
              inset: 0;
              display: grid;
              place-items: center;
              background: transparent;
              z-index: 2147483647;
            }
            #__tab_capture_countdown .tcs-wrap {
              position: relative;
              display: grid;
              place-items: center;
            }
            #__tab_capture_countdown .tcs-number {
              font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif;
              font-size: 120px;
              font-weight: 600;
              letter-spacing: 0.04em;
              color: #ffffff;
              text-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
              animation: tcs-pop 0.45s ease-out;
            }
          `;
          document.head.appendChild(style);
        }

        const overlay = document.createElement("div");
        overlay.id = "__tab_capture_countdown";
        const wrap = document.createElement("div");
        wrap.className = "tcs-wrap";
        const number = document.createElement("div");
        number.className = "tcs-number";
        number.textContent = String(duration);
        wrap.appendChild(number);
        overlay.appendChild(wrap);
        (document.body || document.documentElement).appendChild(overlay);

        let remaining = duration;
        const tick = () => {
          remaining -= 1;
          if (remaining <= 0) {
            overlay.remove();
            resolve(true);
            return;
          }
          number.textContent = String(remaining);
          number.style.animation = "none";
          void number.offsetHeight;
          number.style.animation = "tcs-pop 0.45s ease-out";
        };

        const intervalId = setInterval(tick, 1000);
        setTimeout(() => clearInterval(intervalId), duration * 1000 + 200);
      });
    },
    args: [seconds]
  });
};

const getStoredOptions = async () => {
  if (!chrome.storage?.local) {
    return {
      tabAudio: true,
      micAudio: false,
      frameRate: 30,
      videoBitrateKbps: 5000,
      resolutionScale: 1,
      captureScale: 1,
      captureFormat: "png",
      captureFormat: "png",
      captureQuality: 90,
      defaultWindowSize: "1280x720"
    };
  }
  return chrome.storage.local.get({
    tabAudio: true,
    micAudio: false,
    countdownSeconds: 3,
    frameRate: 30,
    videoBitrateKbps: 5000,
    resolutionScale: 1,
    captureScale: 1,
    captureFormat: "png",
    captureFormat: "png",
    captureQuality: 90,
    defaultWindowSize: "1280x720"
  });
};

const parseViewportSize = (value) => {
  if (!value || value === "none") return null;
  const [width, height] = value.split("x").map((item) => Number(item));
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  return { width, height };
};

const saveWindowBounds = async (windowId) => {
  if (!chrome.storage?.local) {
    throw new Error("保存領域が利用できません。");
  }
  const { originalWindowBounds } = await chrome.storage.local.get({
    originalWindowBounds: null
  });
  if (originalWindowBounds?.windowId) {
    return;
  }
  const current = await chrome.windows.get(windowId);
  await chrome.storage.local.set({
    originalWindowBounds: {
      windowId,
      width: current.width,
      height: current.height,
      left: current.left,
      top: current.top
    }
  });
};

const resizeWindowToViewport = async (tabId, windowId, viewport) => {
  if (!viewport) return;
  await saveWindowBounds(windowId);
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight
    })
  });
  if (!result?.result) {
    throw new Error("サイズ情報の取得に失敗しました。");
  }
  const deltaWidth = Math.max(0, result.result.outerWidth - result.result.innerWidth);
  const deltaHeight = Math.max(0, result.result.outerHeight - result.result.innerHeight);
  await chrome.windows.update(windowId, {
    width: Math.round(viewport.width + deltaWidth),
    height: Math.round(viewport.height + deltaHeight)
  });
};

const restoreWindowBounds = async () => {
  if (!chrome.storage?.local) {
    throw new Error("保存領域が利用できません。");
  }
  const { originalWindowBounds } = await chrome.storage.local.get({
    originalWindowBounds: null
  });
  if (!originalWindowBounds?.windowId) {
    throw new Error("元のサイズが保存されていません。");
  }
  await chrome.windows.update(originalWindowBounds.windowId, {
    width: originalWindowBounds.width,
    height: originalWindowBounds.height,
    left: originalWindowBounds.left,
    top: originalWindowBounds.top
  });
  await chrome.storage.local.remove("originalWindowBounds");
};

const isBlockedUrl = (url) => {
  if (!url) return true;
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:")
  );
};

const getCaptureSize = async (tabId, scale) => {
  if (!scale || scale >= 1) {
    return null;
  }
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return {
          width: window.innerWidth,
          height: window.innerHeight,
          dpr: window.devicePixelRatio || 1
        };
      }
    });
    if (!result?.result) {
      return null;
    }
    const { width, height, dpr } = result.result;
    return {
      maxWidth: Math.round(width * dpr * scale),
      maxHeight: Math.round(height * dpr * scale)
    };
  } catch (error) {
    return null;
  }
};

const setRecordingState = async (isRecording) => {
  if (!chrome.storage?.local) {
    return;
  }
  await chrome.storage.local.set({ isRecording });
};

const startRecording = async (countdownSeconds = 0, options = {}) => {
  const storedOptions = await getStoredOptions();
  const mergedOptions = {
    tabAudio: options.tabAudio ?? storedOptions.tabAudio,
    micAudio: options.micAudio ?? storedOptions.micAudio,
    frameRate: options.frameRate ?? storedOptions.frameRate,
    videoBitrateKbps: options.videoBitrateKbps ?? storedOptions.videoBitrateKbps,
    resolutionScale: options.resolutionScale ?? storedOptions.resolutionScale
  };
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("アクティブなタブが見つかりません。");
  }
  if (isBlockedUrl(tab.url)) {
    throw new Error("このページでは録画できません。");
  }
  const captureSize = await getCaptureSize(tab.id, mergedOptions.resolutionScale);
  if (countdownSeconds > 0) {
    try {
      await runCountdownOverlay(tab.id, countdownSeconds);
    } catch (error) {
      throw new Error(`カウントダウン表示に失敗しました: ${error.message}`);
    }
  }
  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: tab.id
  });
  await ensureOffscreen();
  const response = await chrome.runtime.sendMessage({
    type: "offscreen-start",
    streamId,
    tabAudio: mergedOptions.tabAudio,
    micAudio: mergedOptions.micAudio,
    frameRate: mergedOptions.frameRate,
    videoBitrateKbps: mergedOptions.videoBitrateKbps,
    maxWidth: captureSize?.maxWidth,
    maxHeight: captureSize?.maxHeight
  });
  if (!response?.ok) {
    throw new Error(response?.error ?? "画面録画開始に失敗しました。");
  }
};

const setRecordingBadge = async (isRecording) => {
  if (isRecording) {
    await chrome.action.setBadgeText({ text: "REC" });
    await chrome.action.setBadgeBackgroundColor({ color: "#c54823" });
  } else {
    await chrome.action.setBadgeText({ text: "" });
  }
};

const stopRecording = async () => {
  const response = await chrome.runtime.sendMessage({ type: "offscreen-stop" });
  if (!response?.ok) {
    throw new Error(response?.error ?? "画面録画停止に失敗しました。");
  }
};

const captureTab = async () => {
  const storedOptions = await getStoredOptions();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.windowId) {
    throw new Error("タブのウィンドウ情報が取得できません。");
  }
  if (isBlockedUrl(tab.url)) {
    throw new Error("このページではスクリーンショットできません。");
  }
  const captureOptions = { format: storedOptions.captureFormat };
  if (storedOptions.captureFormat !== "png") {
    captureOptions.quality = storedOptions.captureQuality;
  }
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(
      tab.windowId,
      captureOptions,
      async (dataUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        let finalUrl = dataUrl;
        if (storedOptions.captureScale && storedOptions.captureScale < 1) {
          await ensureOffscreen();
          const resizeResponse = await chrome.runtime.sendMessage({
            type: "offscreen-resize",
            dataUrl,
            scale: storedOptions.captureScale,
            format: storedOptions.captureFormat,
            quality: storedOptions.captureQuality
          });
          if (!resizeResponse?.ok) {
            reject(new Error(resizeResponse?.error ?? "画像のリサイズに失敗しました。"));
            return;
          }
          finalUrl = resizeResponse.dataUrl;
        }
        const filename = `tab-capture-${timestampLabel()}.${storedOptions.captureFormat}`;
        chrome.downloads.download({ url: finalUrl, filename, saveAs: true }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve();
        });
      }
    );
  });
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "start-recording") {
    startRecording(message.countdownSeconds ?? 0, {
      tabAudio: message.tabAudio,
      micAudio: message.micAudio,
      frameRate: message.frameRate,
      videoBitrateKbps: message.videoBitrateKbps
    })
      .then(() => setRecordingState(true))
      .then(() => setRecordingBadge(true))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "stop-recording") {
    stopRecording()
      .then(() => setRecordingState(false))
      .then(() => setRecordingBadge(false))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "capture-tab") {
    captureTab()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "resize-window") {
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => {
        if (!tab?.id || !tab?.windowId) {
          throw new Error("アクティブなタブが見つかりません。");
        }
        if (isBlockedUrl(tab.url)) {
          throw new Error("このページではサイズ変更できません。");
        }
        const viewport = message.width && message.height
          ? { width: Number(message.width), height: Number(message.height) }
          : parseViewportSize(message.size);
        if (!viewport) {
          throw new Error("サイズを選択してください。");
        }
        return resizeWindowToViewport(tab.id, tab.windowId, viewport);
      })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "reset-window-size") {
    restoreWindowBounds()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "recording-url") {
    chrome.downloads.download(
      { url: message.url, filename: message.filename, saveAs: true },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error("download failed", chrome.runtime.lastError.message);
          return;
        }
        recordingDownloadId = downloadId;
      }
    );
  }

  return false;
});

chrome.downloads.onChanged.addListener((delta) => {
  if (!recordingDownloadId || delta.id !== recordingDownloadId) {
    return;
  }
  if (delta.state?.current === "complete") {
    recordingDownloadId = null;
    chrome.runtime.sendMessage({ type: "recording-saved" }).catch(() => undefined);
  }
});

const syncBadgeFromStorage = async () => {
  if (!chrome.storage?.local) {
    return;
  }
  const { isRecording = false } = await chrome.storage.local.get({ isRecording: false });
  await setRecordingBadge(isRecording);
};

chrome.runtime.onStartup.addListener(() => {
  syncBadgeFromStorage().catch(() => undefined);
});

chrome.runtime.onInstalled.addListener(() => {
  syncBadgeFromStorage().catch(() => undefined);
});

syncBadgeFromStorage().catch(() => undefined);

// キーボードショートカット
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-recording") {
    const { isRecording = false } = await chrome.storage.local.get({ isRecording: false });
    if (isRecording) {
      stopRecording()
        .then(() => setRecordingState(false))
        .then(() => setRecordingBadge(false))
        .catch((error) => console.error("録画停止失敗:", error.message));
    } else {
      const { countdownSeconds = 3 } = await chrome.storage.local.get({ countdownSeconds: 3 });
      startRecording(countdownSeconds)
        .then(() => setRecordingState(true))
        .then(() => setRecordingBadge(true))
        .catch((error) => console.error("録画開始失敗:", error.message));
    }
  }


  if (command === "capture-screenshot") {
    captureTab().catch((error) => console.error("スクリーンショット失敗:", error.message));
  }
});
