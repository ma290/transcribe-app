// transcription.mjs
// Handles audio upload, API calls, and the live transcript UI.

const transcriptionApiUrl = "/api/transcribe";
const MAX_CHUNK_SECONDS = 5 * 60;

// State
let transcriptionWords = [];
let speakerMap = {};
let currentHighlightedWordIndex = -1;

// Elements
const uploadZone = document.getElementById("audio-upload-zone");
const fileInput = document.getElementById("audio-file-input");
const browseBtn = document.getElementById("browse-audio-button");
const uploadStatus = document.getElementById("upload-status");

const audioPlayerContainer = document.getElementById("audio-player-container");
const audioPlayer = document.getElementById("audio-player");
const playPauseBtn = document.getElementById("play-pause-btn");
const equalizerBars = document.getElementById("equalizer-bars");
const nowPlayingLabel = document.getElementById("now-playing-label");
const audioSeek = document.getElementById("audio-seek");
const audioCurrentTime = document.getElementById("audio-current-time");
const audioDuration = document.getElementById("audio-duration");
const transcriptionTools = document.getElementById("transcription-tools");
const speakerManagerList = document.getElementById("speaker-manager-list");
const liveTranscript = document.getElementById("live-transcript");
const syncTranscriptBtn = document.getElementById("sync-transcript-button");
const noteEditor = document.getElementById("note");

export function initTranscription() {
  browseBtn.addEventListener("click", () => fileInput.click());

  uploadZone.addEventListener("click", (e) => {
    if (e.target === browseBtn || browseBtn.contains(e.target)) return;
    fileInput.click();
  });

  uploadZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadZone.classList.add("dragover");
  });
  
  uploadZone.addEventListener("dragleave", (e) => {
    e.preventDefault();
    uploadZone.classList.remove("dragover");
  });
  
  uploadZone.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadZone.classList.remove("dragover");
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleAudioFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleAudioFile(e.target.files[0]);
    }
  });

  // Setup Audio Player
  audioPlayer.addEventListener("timeupdate", handleTimeUpdate);
  audioPlayer.addEventListener("loadedmetadata", updateAudioDuration);
  audioPlayer.addEventListener("play", () => setPlayingState(true));
  audioPlayer.addEventListener("pause", () => setPlayingState(false));
  audioPlayer.addEventListener("ended", () => setPlayingState(false));

  playPauseBtn.addEventListener("click", togglePlayPause);
  audioSeek.addEventListener("input", handleSeek);

  document.addEventListener("keydown", handleSpacebar);

  syncTranscriptBtn.addEventListener("click", syncToEditor);
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function handleSpacebar(e) {
  if (e.code !== "Space" && e.key !== " ") return;
  if (isTypingTarget(e.target)) return;
  if (!audioPlayerContainer.classList.contains("visible")) return;

  e.preventDefault();
  togglePlayPause();
}

function togglePlayPause() {
  if (!audioPlayer.src) return;
  if (audioPlayer.paused) {
    audioPlayer.play();
  } else {
    audioPlayer.pause();
  }
}

function setPlayingState(playing) {
  playPauseBtn.classList.toggle("playing", playing);
  equalizerBars.classList.toggle("playing", playing);
  nowPlayingLabel.textContent = playing ? "Now playing" : "Paused";
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function updateAudioDuration() {
  audioDuration.textContent = formatTime(audioPlayer.duration);
  audioSeek.max = audioPlayer.duration || 100;
}

function handleSeek() {
  const time = parseFloat(audioSeek.value);
  audioPlayer.currentTime = time;
  updateSeekBar();
}

function updateSeekBar() {
  const pct = audioPlayer.duration
    ? (audioPlayer.currentTime / audioPlayer.duration) * 100
    : 0;
  audioSeek.value = audioPlayer.currentTime;
  audioSeek.style.setProperty("--seek-pct", `${pct}%`);
  audioCurrentTime.textContent = formatTime(audioPlayer.currentTime);
}

function setUploadStatus(text, type = "") {
  uploadStatus.textContent = text;
  uploadStatus.className = "upload-status" + (type ? ` ${type}` : "");
}

function showPlayer(fileName) {
  audioPlayerContainer.classList.add("visible");
  nowPlayingLabel.textContent = fileName || "Ready to play";
}

function showTranscriptionTools() {
  transcriptionTools.classList.add("visible");
}

async function handleAudioFile(file) {
  const fileName = file.name.toLowerCase();
  if (!fileName.endsWith('.mp3') && !fileName.endsWith('.wav') && !fileName.endsWith('.m4a')) {
    alert("Please upload a valid audio file (.mp3, .wav, .m4a)");
    return;
  }

  const objectUrl = URL.createObjectURL(file);
  audioPlayer.src = objectUrl;
  showPlayer(file.name);

  setUploadStatus("Preparing audio for transcription...", "loading");
  transcriptionTools.classList.remove("visible");

  try {
    let decodedInfo = null;

    try {
      decodedInfo = await decodeAudioForDuration(file);
    } catch (decodeError) {
      console.warn("Browser decode failed, falling back to direct upload.", decodeError);
    }

    const durationInSeconds = decodedInfo ? decodedInfo.duration : 0;

    if (decodedInfo && durationInSeconds > MAX_CHUNK_SECONDS) {
      try {
        await transcribeInChunks(file, durationInSeconds, decodedInfo.audioBuffer);
      } catch (chunkError) {
        console.warn("Chunked transcription failed, falling back to direct upload.", chunkError);
        await transcribeSingleFile(file);
      }
    } else {
      await transcribeSingleFile(file);
    }
  } catch (error) {
    console.error(error);
    setUploadStatus("Error during transcription: " + error.message, "error");
  } finally {
    // Keep objectUrl alive so audioPlayer can continue playing it.
  }
}

async function transcribeSingleFile(file) {
  setUploadStatus("Transcribing audio... this may take a while.", "loading");

  const data = await sendTranscriptionRequest(file);
  const words = extractWordsFromResponse(data);

  if (words.length > 0) {
    processTranscription(words);
    setUploadStatus("Transcription complete!", "success");
    setTimeout(() => { setUploadStatus(""); }, 3000);
    return;
  }

  throw new Error("Invalid response format from transcription API.");
}

async function transcribeInChunks(file, durationInSeconds, audioBuffer) {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const decodedBuffer = audioBuffer || await audioContext.decodeAudioData(await file.arrayBuffer().then((buffer) => buffer.slice(0)));
    const finalBuffer = decodedBuffer || audioBuffer;
    const totalChunks = Math.ceil(durationInSeconds / MAX_CHUNK_SECONDS);

    const allWords = [];
    for (let index = 0; index < totalChunks; index += 1) {
      const chunkStart = index * MAX_CHUNK_SECONDS;
      const chunkEnd = Math.min(chunkStart + MAX_CHUNK_SECONDS, durationInSeconds);
      const chunkBuffer = createChunkBuffer(finalBuffer, chunkStart, chunkEnd);
      const chunkBlob = audioBufferToWav(chunkBuffer);

      setUploadStatus(`Transcribing chunk ${index + 1} of ${totalChunks}...`, "loading");

      const data = await sendTranscriptionRequest(chunkBlob, `${file.name}-${index + 1}.wav`);
      const words = extractWordsFromResponse(data);

      words.forEach((word) => {
        const adjustedWord = { ...word };
        if (typeof adjustedWord.start === "number") adjustedWord.start += chunkStart;
        if (typeof adjustedWord.end === "number") adjustedWord.end += chunkStart;
        allWords.push(adjustedWord);
      });
    }

    allWords.sort((a, b) => (a.start || 0) - (b.start || 0));
    processTranscription(allWords);
    setUploadStatus("Transcription complete!", "success");
    setTimeout(() => { setUploadStatus(""); }, 3000);
  } finally {
    await audioContext.close().catch(() => {});
  }
}

async function decodeAudioForDuration(file) {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();

  try {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    return {
      duration: Number.isFinite(audioBuffer.duration) ? audioBuffer.duration : 0,
      audioBuffer
    };
  } finally {
    await audioContext.close().catch(() => {});
  }
}

async function sendTranscriptionRequest(fileLike, fileName = null) {
  const formData = new FormData();
  formData.append("file", fileLike, fileName || undefined);

  const response = await fetch(transcriptionApiUrl, {
    method: "POST",
    headers: { accept: "application/json" },
    body: formData
  });

  if (!response.ok) {
    throw new Error(`API returned status ${response.status}`);
  }

  return response.json();
}

function extractWordsFromResponse(data) {
  const fullPayload = (data.full_response && data.full_response.data) || data.full_response || data.data || {};
  const transcription = fullPayload.transcription ||
    (fullPayload.result && fullPayload.result.transcription) ||
    data.transcription ||
    (data.result && data.result.transcription) ||
    {};
  return transcription.words || transcription.segments || [];
}

function createChunkBuffer(audioBuffer, startSeconds, endSeconds) {
  const startSample = Math.floor(startSeconds * audioBuffer.sampleRate);
  const endSample = Math.min(audioBuffer.length, Math.floor(endSeconds * audioBuffer.sampleRate));
  const sampleLength = Math.max(1, endSample - startSample);
  const chunkBuffer = new AudioBuffer({
    length: sampleLength,
    numberOfChannels: audioBuffer.numberOfChannels,
    sampleRate: audioBuffer.sampleRate
  });

  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const sourceData = audioBuffer.getChannelData(channel);
    const chunkData = chunkBuffer.getChannelData(channel);

    for (let i = 0; i < sampleLength; i += 1) {
      chunkData[i] = sourceData[startSample + i] || 0;
    }
  }

  return chunkBuffer;
}

function audioBufferToWav(audioBuffer) {
  const numberOfChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numberOfChannels * bytesPerSample;
  const dataLength = audioBuffer.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i += 1) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < audioBuffer.length; i += 1) {
    for (let channel = 0; channel < numberOfChannels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(channel)[i] || 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function processTranscription(words) {
  transcriptionWords = words;
  
  // Extract unique speakers
  const speakers = new Set();
  words.forEach(w => {
    if (w.speaker_id) speakers.add(w.speaker_id);
  });
  
  speakerMap = {};
  speakers.forEach(spk => {
    speakerMap[spk] = spk; // Default name is the ID itself
  });

  renderSpeakerManager();
  renderLiveTranscript();

  showTranscriptionTools();
}

function renderSpeakerManager() {
  speakerManagerList.innerHTML = "";
  Object.keys(speakerMap).forEach(spk => {
    const div = document.createElement("div");
    div.className = "speaker-item";
    
    const label = document.createElement("label");
    label.textContent = spk;
    
    const input = document.createElement("input");
    input.type = "text";
    input.value = speakerMap[spk];
    input.placeholder = "New name...";
    
    input.addEventListener("input", (e) => {
      speakerMap[spk] = e.target.value;
      updateSpeakerLabelsInTranscript();
    });

    div.appendChild(label);
    div.appendChild(input);
    speakerManagerList.appendChild(div);
  });
}

function renderLiveTranscript() {
  liveTranscript.innerHTML = "";
  if (transcriptionWords.length === 0) {
    liveTranscript.innerHTML = "<em>No transcription data found.</em>";
    return;
  }

  let currentSpeaker = null;
  let currentBlock = null;

  transcriptionWords.forEach((wordObj, index) => {
    // Check if we need a new speaker block
    if (wordObj.speaker_id !== currentSpeaker) {
      currentSpeaker = wordObj.speaker_id;
      currentBlock = document.createElement("div");
      currentBlock.className = "transcript-speaker-block";
      
      const speakerNameEl = document.createElement("span");
      speakerNameEl.className = "transcript-speaker-name";
      speakerNameEl.dataset.speakerId = currentSpeaker;
      speakerNameEl.textContent = speakerMap[currentSpeaker] + ": ";
      
      currentBlock.appendChild(speakerNameEl);
      liveTranscript.appendChild(currentBlock);
    }

    // Create word element
    const wordSpan = document.createElement("span");
    wordSpan.className = "transcript-word";
    wordSpan.textContent = wordObj.text;
    wordSpan.dataset.index = index;
    
    // If it's not the first word in a block, prepend a space
    // Wait, the word.text usually doesn't have spaces, we need to add spacing.
    const spaceNode = document.createTextNode(" ");
    
    wordSpan.addEventListener("click", () => {
      audioPlayer.currentTime = wordObj.start;
      audioPlayer.play();
    });

    currentBlock.appendChild(spaceNode);
    currentBlock.appendChild(wordSpan);
  });
}

function updateSpeakerLabelsInTranscript() {
  const labels = liveTranscript.querySelectorAll(".transcript-speaker-name");
  labels.forEach(lbl => {
    const spkId = lbl.dataset.speakerId;
    if (spkId && speakerMap[spkId]) {
      lbl.textContent = speakerMap[spkId] + ": ";
    }
  });
}

function handleTimeUpdate() {
  const currentTime = audioPlayer.currentTime;
  updateSeekBar();
  
  // Optional: Optimize with binary search if transcriptionWords is very large
  // For now, simple linear iteration or keeping track of an index works.
  
  let newHighlightIndex = -1;
  // We can just find the first word that contains the current time
  for (let i = 0; i < transcriptionWords.length; i++) {
    const w = transcriptionWords[i];
    if (currentTime >= w.start && currentTime <= w.end) {
      newHighlightIndex = i;
      break;
    }
  }

  // If no exact match (e.g., silence), keep the last spoken word or unhighlight.
  // We will unhighlight if we are outside of any word.

  if (newHighlightIndex !== currentHighlightedWordIndex) {
    // Remove old highlight
    if (currentHighlightedWordIndex !== -1) {
      const oldWordEl = liveTranscript.querySelector(`.transcript-word[data-index="${currentHighlightedWordIndex}"]`);
      if (oldWordEl) {
        oldWordEl.classList.remove("highlight");
      }
    }

    // Add new highlight
    if (newHighlightIndex !== -1) {
      const newWordEl = liveTranscript.querySelector(`.transcript-word[data-index="${newHighlightIndex}"]`);
      if (newWordEl) {
        newWordEl.classList.add("highlight");
        // Auto-scroll logic could be added here
        newWordEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    currentHighlightedWordIndex = newHighlightIndex;
  }
}

function syncToEditor() {
  if (transcriptionWords.length === 0) return;

  let textContent = "";
  let currentSpeaker = null;

  transcriptionWords.forEach(w => {
    if (w.speaker_id !== currentSpeaker) {
      currentSpeaker = w.speaker_id;
      // Add speaker name and newline if not the first
      if (textContent.length > 0) {
        textContent += "\n\n";
      }
      textContent += speakerMap[currentSpeaker] + ":\n";
    }
    // Append word
    textContent += w.text + " ";
  });

  // The existing editor is a contenteditable div, so we can set its innerText or innerHTML.
  // Using innerHTML with <br/> preserves the newlines.
  noteEditor.innerHTML = textContent.trim().replace(/\n/g, '<br/>');
  
  // Highlight the Editor so the user sees it happened
  noteEditor.style.backgroundColor = "rgba(0, 153, 255, 0.2)";
  setTimeout(() => {
    noteEditor.style.backgroundColor = "";
  }, 500);
}
