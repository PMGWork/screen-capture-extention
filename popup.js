const recordToggleButton = document.getElementById("record-toggle");
const recordLabel = document.getElementById("record-label");
const statusIndicator = document.getElementById("status-indicator");
const captureButton = document.getElementById("capture");
const statusText = document.getElementById("status");
const openSettingsButton = document.getElementById("open-settings");
const windowSizeSelect = document.getElementById("window-size");
const applyWindowSizeButton = document.getElementById("apply-window-size");
const resetWindowSizeButton = document.getElementById("reset-window-size");


let isRecording = false;
let canRecord = true;
const recordingClasses = [
  "bg-red-600",
  "border-red-600",
  "text-white",
  "hover:bg-red-700",
  "hover:border-red-700"
];

const setStatus = (text) => {
  statusText.textContent = text;
};

const setButtonsDisabled = (disabled) => {
  recordToggleButton.disabled = disabled || (!canRecord && !isRecording);
  captureButton.disabled = disabled || !canRecord;
  applyWindowSizeButton.disabled = disabled || !canRecord;
  resetWindowSizeButton.disabled = disabled || !canRecord;
  windowSizeSelect.disabled = disabled || !canRecord;
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
      applyWindowSizeButton.disabled = true;
      resetWindowSizeButton.disabled = true;
      windowSizeSelect.disabled = true;
      if (!isRecording) {
        setStatus("このページでは使用できません");
        if (statusIndicator) statusIndicator.style.display = "none";
      }
      return;
    }
    canRecord = true;
    recordToggleButton.disabled = false;
    captureButton.disabled = false;
    applyWindowSizeButton.disabled = false;
    resetWindowSizeButton.disabled = false;
    windowSizeSelect.disabled = false;
    if (!isRecording) {
      setStatus("待機中");
      if (statusIndicator) statusIndicator.style.display = "";
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
        countdownSeconds: 3,
        frameRate: 30,
        videoBitrateKbps: 5000
      });
      const response = await sendMessage("start-recording", {
        countdownSeconds: storedOptions.countdownSeconds,
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

applyWindowSizeButton.addEventListener("click", async () => {
  if (windowSizeSelect.value === "none") {
    setStatus("プリセットを選択してください");
    return;
  }
  const response = await sendMessage("resize-window", { size: windowSizeSelect.value });
  if (response?.ok) {
    setStatus("サイズを変更しました");
  } else {
    setStatus(response?.error ?? "サイズ変更に失敗しました。");
  }
});

resetWindowSizeButton.addEventListener("click", async () => {
  try {
    const response = await sendMessage("reset-window-size");
    if (response?.ok) {
      setStatus("元に戻しました");
    } else {
      setStatus(response?.error ?? "元のサイズが保存されていません。");
    }
  } catch (error) {
    setStatus("元に戻せませんでした。");
  }
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
  if (recordLabel) {
    recordLabel.textContent = recording ? "録画停止" : "画面録画";
  }
  recordingClasses.forEach((className) => {
    recordToggleButton.classList.toggle(className, recording);
  });
  if (recording) {
    setStatus("録画中");
  }
};

const initializeState = async () => {
  const storage = requireStorage();
  const stored = await storage.get({ isRecording: false, defaultWindowSize: "1280x720" });
  setRecordingState(stored.isRecording);

  if (stored.defaultWindowSize) {
    windowSizeSelect.value = stored.defaultWindowSize;
  }

  await refreshAvailability();
};

initializeState().catch((error) => {
  setStatus(`録画準備失敗: ${error.message}`);
});
