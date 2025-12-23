const recordToggleButton = document.getElementById("record-toggle");
const captureButton = document.getElementById("capture");
const statusText = document.getElementById("status");
const openSettingsButton = document.getElementById("open-settings");

let isRecording = false;
let canRecord = true;

const setStatus = (text) => {
  statusText.textContent = text;
};

const setButtonsDisabled = (disabled) => {
  recordToggleButton.disabled = disabled || (!canRecord && !isRecording);
  captureButton.disabled = disabled || !canRecord;
};

const sendMessage = async (type, payload = {}) => {
  return chrome.runtime.sendMessage({ type, ...payload });
};

const requireStorage = () => {
  if (!chrome.storage?.local) {
    throw new Error("storage APIが利用できません。拡張を再読み込みしてください。");
  }
  return chrome.storage.local;
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

const refreshAvailability = async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || isBlockedUrl(tab.url)) {
      canRecord = false;
      recordToggleButton.disabled = !isRecording;
      captureButton.disabled = true;
      if (!isRecording) {
        setStatus("このページでは録画できません");
      }
      return;
    }
    canRecord = true;
    recordToggleButton.disabled = false;
    captureButton.disabled = false;
    if (!isRecording) {
      setStatus("待機中");
    }
  } catch (error) {
    canRecord = false;
    recordToggleButton.disabled = true;
    setStatus(`録画準備失敗: ${error.message}`);
  }
};

recordToggleButton.addEventListener("click", async () => {
  setButtonsDisabled(true);
  try {
    if (!isRecording) {
      setStatus("カウントダウン中...");
      const storage = requireStorage();
      const storedOptions = await storage.get({
        tabAudio: true,
        micAudio: false,
        frameRate: 30,
        videoBitrateKbps: 5000
      });
      const response = await sendMessage("start-recording", {
        countdownSeconds: 3,
        tabAudio: storedOptions.tabAudio,
        micAudio: storedOptions.micAudio,
        frameRate: storedOptions.frameRate,
        videoBitrateKbps: storedOptions.videoBitrateKbps
      });
      if (response?.ok) {
        setRecordingState(true);
      } else {
        setStatus(`録画開始失敗: ${response?.error ?? "不明なエラー"}`);
      }
    } else {
      setStatus("録画を停止中...");
      const response = await sendMessage("stop-recording");
      if (response?.ok) {
        setRecordingState(false);
        setStatus("保存中");
      } else {
        setStatus(`録画停止失敗: ${response?.error ?? "不明なエラー"}`);
      }
    }
  } finally {
    setButtonsDisabled(false);
  }
});

captureButton.addEventListener("click", async () => {
  setStatus("スクリーンショット中...");
  const response = await sendMessage("capture-tab");
  if (response?.ok) {
    setStatus("ダイアログを確認してください。");
  } else {
    setStatus(`スクリーンショット失敗: ${response?.error ?? "不明なエラー"}`);
  }
});

openSettingsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "recording-saved") {
    if (!isRecording) {
      setStatus("待機中");
    }
  }
  if (message?.type === "options-updated") {
    if (!isRecording) {
      setStatus("設定を更新しました");
      setTimeout(() => {
        if (!isRecording) {
          setStatus("待機中");
        }
      }, 1500);
    }
  }
});

const setRecordingState = (recording) => {
  isRecording = recording;
  recordToggleButton.textContent = recording ? "録画停止" : "画面録画";
  recordToggleButton.classList.toggle("btn--recording", recording);
  if (recording) {
  setStatus("録画中");
  }
};

const initializeState = async () => {
  const storage = requireStorage();
  const stored = await storage.get({ isRecording: false });
  setRecordingState(stored.isRecording);
  await refreshAvailability();
};

initializeState().catch((error) => {
  setStatus(`録画準備失敗: ${error.message}`);
});
