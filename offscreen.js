let recorder = null;
let recordedChunks = [];
let activeStreams = [];
let audioContext = null;

const timestampLabel = () => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

const pickMimeType = () => {
  const candidates = [
    "video/webm; codecs=vp9",
    "video/webm; codecs=vp8",
    "video/webm"
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
};

const pickVideoBitsPerSecond = (videoBitrateKbps) => {
  const parsed = Number(videoBitrateKbps);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.round(parsed * 1000);
  }
  return 5_000_000;
};

const mixAudioTracks = (tabStream, micStream) => {
  audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();

  if (tabStream?.getAudioTracks().length) {
    const tabSource = audioContext.createMediaStreamSource(tabStream);
    tabSource.connect(destination);
  }

  if (micStream?.getAudioTracks().length) {
    const micSource = audioContext.createMediaStreamSource(micStream);
    micSource.connect(destination);
  }

  return destination.stream;
};

const blobToDataUrl = (blob) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("dataUrl生成に失敗しました。"));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
};

const resizeImage = async (dataUrl, scale, format, quality) => {
  const normalizedScale = Math.min(Math.max(Number(scale) || 1, 0.1), 1);
  const response = await fetch(dataUrl);
  const sourceBlob = await response.blob();
  const bitmap = await createImageBitmap(sourceBlob);
  const width = Math.max(1, Math.round(bitmap.width * normalizedScale));
  const height = Math.max(1, Math.round(bitmap.height * normalizedScale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);

  const mime =
    format === "jpeg"
      ? "image/jpeg"
      : format === "webp"
      ? "image/webp"
      : "image/png";
  const qualityValue =
    mime === "image/png" ? undefined : Math.min(Math.max(quality / 100, 0.1), 1);

  const resizedBlob = await new Promise((resolve) => {
    canvas.toBlob(resolve, mime, qualityValue);
  });
  if (!resizedBlob) {
    throw new Error("画像のリサイズに失敗しました。");
  }
  return blobToDataUrl(resizedBlob);
};

const stopActiveStreams = () => {
  activeStreams.forEach((stream) => {
    stream.getTracks().forEach((track) => track.stop());
  });
  activeStreams = [];
  if (audioContext) {
    audioContext.close().catch(() => undefined);
    audioContext = null;
  }
};

const startRecording = async (streamId, options = {}) => {
  if (recorder?.state === "recording") {
    return;
  }

  const tabAudioEnabled = options.tabAudio ?? true;
  const micAudioEnabled = options.micAudio ?? false;
  const frameRate = Number(options.frameRate) || 30;
  const videoBitrateKbps = options.videoBitrateKbps ?? 5000;
  const maxWidth = Number(options.maxWidth) || null;
  const maxHeight = Number(options.maxHeight) || null;

  const mandatoryVideo = {
    chromeMediaSource: "tab",
    chromeMediaSourceId: streamId,
    maxFrameRate: frameRate
  };
  if (maxWidth) {
    mandatoryVideo.maxWidth = maxWidth;
  }
  if (maxHeight) {
    mandatoryVideo.maxHeight = maxHeight;
  }
  const constraints = {
    audio: tabAudioEnabled
      ? {
          mandatory: {
            chromeMediaSource: "tab",
            chromeMediaSourceId: streamId
          }
        }
      : false,
    video: {
      mandatory: mandatoryVideo
    }
  };

  let tabStream = null;
  try {
    tabStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (error) {
    throw new Error("タブの録画が許可されていません。");
  }
  activeStreams.push(tabStream);

  let micStream = null;
  if (micAudioEnabled) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      activeStreams.push(micStream);
    } catch (error) {
      stopActiveStreams();
      throw new Error("マイクの許可が必要です。");
    }
  }

  let outputStream = new MediaStream();
  tabStream.getVideoTracks().forEach((track) => outputStream.addTrack(track));

  if (tabAudioEnabled || micAudioEnabled) {
    const mixedAudioStream = mixAudioTracks(tabStream, micStream);
    mixedAudioStream.getAudioTracks().forEach((track) => outputStream.addTrack(track));
  }

  recordedChunks = [];
  const mimeType = pickMimeType();
  const recorderOptions = {
    videoBitsPerSecond: pickVideoBitsPerSecond(videoBitrateKbps)
  };
  if (mimeType) {
    recorderOptions.mimeType = mimeType;
  }
  recorder = new MediaRecorder(outputStream, recorderOptions);

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  });

  recorder.addEventListener("stop", async () => {
    const blob = new Blob(recordedChunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const filename = `tab-recording-${timestampLabel()}.webm`;
    try {
      await chrome.runtime.sendMessage({
        type: "recording-url",
        url,
        filename
      });
    } catch (error) {
      console.error("sendMessage failed", error);
    }
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    stopActiveStreams();
  });

  recorder.start(1000);
};

const stopRecording = () => {
  if (recorder?.state === "recording") {
    recorder.stop();
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "offscreen-start") {
    startRecording(message.streamId, {
      tabAudio: message.tabAudio,
      micAudio: message.micAudio,
      frameRate: message.frameRate,
      videoBitrateKbps: message.videoBitrateKbps,
      maxWidth: message.maxWidth,
      maxHeight: message.maxHeight
    })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "offscreen-resize") {
    resizeImage(message.dataUrl, message.scale, message.format, message.quality)
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "offscreen-stop") {
    stopRecording();
    sendResponse({ ok: true });
    return true;
  }

  return false;
});
