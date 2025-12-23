const tabAudioToggle = document.getElementById("tab-audio");
const micAudioToggle = document.getElementById("mic-audio");
const frameRateSelect = document.getElementById("frame-rate");
const videoBitrateInput = document.getElementById("video-bitrate");
const resolutionScaleSelect = document.getElementById("resolution-scale");
const captureFormatSelect = document.getElementById("capture-format");
const captureQualitySelect = document.getElementById("capture-quality");
const captureScaleSelect = document.getElementById("capture-scale");
const statusText = document.getElementById("status");

const setStatus = (text) => {
  statusText.textContent = text;
};

const requireStorage = () => {
  if (!chrome.storage?.local) {
    throw new Error("storage APIが利用できません。拡張を再読み込みしてください。");
  }
  return chrome.storage.local;
};

const loadOptions = async () => {
  const storage = requireStorage();
  const options = await storage.get({
    tabAudio: true,
    micAudio: false,
    frameRate: 30,
    videoBitrateKbps: 5000,
    resolutionScale: 1,
    captureFormat: "png",
    captureQuality: 90,
    captureScale: 1
  });
  tabAudioToggle.checked = options.tabAudio;
  micAudioToggle.checked = options.micAudio;
  frameRateSelect.value = String(options.frameRate);
  videoBitrateInput.value = String(options.videoBitrateKbps);
  resolutionScaleSelect.value = String(options.resolutionScale);
  captureFormatSelect.value = options.captureFormat;
  captureQualitySelect.value = String(options.captureQuality);
  captureScaleSelect.value = String(options.captureScale);
  updateQualityAvailability();
};

const saveOptions = async () => {
  const storage = requireStorage();
  await storage.set({
    tabAudio: tabAudioToggle.checked,
    micAudio: micAudioToggle.checked,
    frameRate: Number(frameRateSelect.value),
    videoBitrateKbps: Number(videoBitrateInput.value || 0),
    resolutionScale: Number(resolutionScaleSelect.value),
    captureFormat: captureFormatSelect.value,
    captureQuality: Number(captureQualitySelect.value),
    captureScale: Number(captureScaleSelect.value)
  });
  chrome.runtime.sendMessage({ type: "options-updated" }).catch(() => undefined);
  setStatus("保存しました");
  setTimeout(() => setStatus(""), 1500);
};

const updateQualityAvailability = () => {
  const disabled = captureFormatSelect.value === "png";
  captureQualitySelect.disabled = disabled;
};

[
  tabAudioToggle,
  micAudioToggle,
  frameRateSelect,
  videoBitrateInput,
  resolutionScaleSelect,
  captureFormatSelect,
  captureQualitySelect,
  captureScaleSelect
].forEach((element) => {
  element.addEventListener("change", () => {
    saveOptions().catch((error) => {
      setStatus(`保存失敗: ${error.message}`);
    });
  });
});

captureFormatSelect.addEventListener("change", updateQualityAvailability);

loadOptions().catch((error) => {
  setStatus(`読み込み失敗: ${error.message}`);
});
