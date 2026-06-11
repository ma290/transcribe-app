// transcription.mjs
// Handles audio upload, API calls, and the live transcript UI.

const transcriptionApiUrl = "/api/transcribe";

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
const transcriptionTools = document.getElementById("transcription-tools");
const speakerManagerList = document.getElementById("speaker-manager-list");
const liveTranscript = document.getElementById("live-transcript");
const syncTranscriptBtn = document.getElementById("sync-transcript-button");
const noteEditor = document.getElementById("note");

export function initTranscription() {
  // Setup upload zone
  browseBtn.addEventListener("click", () => fileInput.click());
  
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

  // Setup Audio Player Time Update
  audioPlayer.addEventListener("timeupdate", handleTimeUpdate);

  // Sync button
  syncTranscriptBtn.addEventListener("click", syncToEditor);
}

async function handleAudioFile(file) {
  // Validate file type
  const validTypes = ["audio/mpeg", "audio/wav", "audio/x-m4a", "audio/m4a"];
  // If we want to be more lenient, we can just check extensions
  const fileName = file.name.toLowerCase();
  if (!fileName.endsWith('.mp3') && !fileName.endsWith('.wav') && !fileName.endsWith('.m4a')) {
    alert("Please upload a valid audio file (.mp3, .wav, .m4a)");
    return;
  }

  // Set audio source for player
  const objectUrl = URL.createObjectURL(file);
  audioPlayer.src = objectUrl;
  audioPlayerContainer.style.display = "block";

  // Upload to API
  uploadStatus.textContent = "Transcribing audio... this may take a while.";
  transcriptionTools.style.display = "none";
  
  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch(transcriptionApiUrl, {
      method: "POST",
      headers: {
        "accept": "application/json"
      },
      body: formData
    });

    if (!response.ok) {
      throw new Error(`API returned status ${response.status}`);
    }

    const data = await response.json();

    const fullPayload = data.full_response?.data || data.full_response || data.data || {};
    const transcription = fullPayload.transcription || fullPayload.result?.transcription || data.transcription || data.result?.transcription;
    const words = transcription?.words || transcription?.segments || [];

    if (data.success && words.length > 0) {
      processTranscription(words);
      uploadStatus.textContent = "Transcription complete!";
      setTimeout(() => { uploadStatus.textContent = ""; }, 3000);
      return;
    }

    if (data.success && data.transcript) {
      uploadStatus.textContent = "Transcription complete!";
      setTimeout(() => { uploadStatus.textContent = ""; }, 3000);
      return;
    }

    throw new Error("Invalid response format from transcription API.");

  } catch (error) {
    console.error(error);
    uploadStatus.textContent = "Error during transcription: " + error.message;
  }
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
  
  transcriptionTools.style.display = "block";
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
  // Using innerText preserves the newlines.
  noteEditor.innerText = textContent.trim();
  
  // Highlight the Editor so the user sees it happened
  noteEditor.style.backgroundColor = "rgba(0, 153, 255, 0.2)";
  setTimeout(() => {
    noteEditor.style.backgroundColor = "";
  }, 500);
}
