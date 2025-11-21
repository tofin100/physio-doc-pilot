// app.js

// ---------- Global State & Constants ----------

const STORAGE_KEY = "physioDocPilot_v1";

let state = {
  patients: [],
  selectedPatientId: null,
  selectedSessionId: null
};

const COMPLAINT_OPTIONS = [
  { id: "pain", label: "Schmerz" },
  { id: "stiffness", label: "Steifigkeit" },
  { id: "weakness", label: "Schwäche" },
  { id: "numbness", label: "Taubheit / Kribbeln" },
  { id: "instability", label: "Instabilität" },
  { id: "limited_rom", label: "Beweglichkeit ↓" },
  { id: "swelling", label: "Schwellung" }
];

const MEASURE_OPTIONS = [
  { id: "mt", label: "Manuelle Therapie (MT)" },
  { id: "pt", label: "Krankengymnastik (KG)" },
  { id: "ml", label: "Lymphdrainage (MLD)" },
  { id: "exercise", label: "aktive Übungen" },
  { id: "edu", label: "Patienten­edukation" },
  { id: "taping", label: "Taping" },
  { id: "device", label: "Gerätetraining" }
];

// Web Speech
let recognition = null;
let isRecording = false;

// ---------- Storage Helpers ----------

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.patients)) {
      state = {
        patients: parsed.patients,
        selectedPatientId: null,
        selectedSessionId: null
      };
    }
  } catch (err) {
    console.error("Failed to load state:", err);
  }
}

function saveState() {
  try {
    const toSave = {
      patients: state.patients
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch (err) {
    console.error("Failed to save state:", err);
  }
}

// ---------- Util ----------

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0,
      v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function formatDateShort(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("de-DE");
}

// ---------- DOM Refs ----------

const patientListEl = document.getElementById("patient-list");
const patientDetailEl = document.getElementById("patient-detail");
const noPatientSelectedEl = document.getElementById("no-patient-selected");

const newPatientForm = document.getElementById("new-patient-form");
const patientNameInput = document.getElementById("patient-name-input");
const patientYearInput = document.getElementById("patient-year-input");
const patientRegionInput = document.getElementById("patient-region-input");

const patientTitleEl = document.getElementById("patient-title");
const patientMetaEl = document.getElementById("patient-meta");
const addSessionBtn = document.getElementById("add-session-btn");

const sessionListEl = document.getElementById("session-list");
const scoreChartEl = document.getElementById("score-chart");

const noSessionSelectedEl = document.getElementById("no-session-selected");
const sessionEditorEl = document.getElementById("session-editor");

const sessionTypeSelect = document.getElementById("session-type");
const sessionDateInput = document.getElementById("session-date");
const sessionRegionSelect = document.getElementById("session-region");

const complaintChipsEl = document.getElementById("complaint-chips");
const measureChipsEl = document.getElementById("measure-chips");

const painSlider = document.getElementById("pain-slider");
const painValueEl = document.getElementById("pain-value");
const functionSlider = document.getElementById("function-slider");
const functionValueEl = document.getElementById("function-value");

const speechToggleBtn = document.getElementById("speech-toggle-btn");
const speechHintEl = document.getElementById("speech-hint");
const speechNotesEl = document.getElementById("speech-notes");
const speechStatusIndicator = document.getElementById("speech-status-indicator");

const sessionNoteEl = document.getElementById("session-note");
const generateNoteBtn = document.getElementById("generate-note-btn");
const copyNoteBtn = document.getElementById("copy-note-btn");
const saveSessionBtn = document.getElementById("save-session-btn");
const deleteSessionBtn = document.getElementById("delete-session-btn");

const scoreValueEl = document.getElementById("score-value");
const scoreCategoryEl = document.getElementById("score-category");

// ---------- Rendering ----------

function render() {
  renderPatients();
  renderPatientDetail();
}

function renderPatients() {
  patientListEl.innerHTML = "";
  if (!state.patients.length) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="meta">Noch keine Patienten</span>`;
    li.style.cursor = "default";
    patientListEl.appendChild(li);
    return;
  }

  state.patients.forEach((p) => {
    const li = document.createElement("li");
    li.dataset.id = p.id;

    const nameSpan = document.createElement("span");
    nameSpan.textContent = p.name;

    const metaSpan = document.createElement("span");
    metaSpan.className = "meta";
    const agePart = p.birthYear ? `*${p.birthYear}` : "";
    const regionPart = p.mainRegion ? p.mainRegion : "";
    metaSpan.textContent = [agePart, regionPart].filter(Boolean).join(" · ");

    li.appendChild(nameSpan);
    li.appendChild(metaSpan);

    if (p.id === state.selectedPatientId) {
      li.classList.add("active");
    }

    li.addEventListener("click", () => {
      state.selectedPatientId = p.id;
      state.selectedSessionId = null;
      render();
    });

    patientListEl.appendChild(li);
  });
}

function renderPatientDetail() {
  const patient = state.patients.find((p) => p.id === state.selectedPatientId);
  if (!patient) {
    patientDetailEl.classList.add("hidden");
    noPatientSelectedEl.classList.remove("hidden");
    return;
  }

  noPatientSelectedEl.classList.add("hidden");
  patientDetailEl.classList.remove("hidden");

  patientTitleEl.textContent = patient.name || "Unbenannter Patient";

  const meta = [];
  if (patient.birthYear) meta.push(`*${patient.birthYear}`);
  if (patient.mainRegion) meta.push(`Hauptregion: ${patient.mainRegion}`);
  patientMetaEl.textContent = meta.join(" · ") || "Keine Zusatzinfos";

  renderSessions(patient);
  renderSessionEditor(patient);
  renderScoreChart(patient);
}

function renderSessions(patient) {
  sessionListEl.innerHTML = "";

  if (!patient.sessions || !patient.sessions.length) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="meta">Noch keine Sitzungen</span>`;
    li.style.cursor = "default";
    sessionListEl.appendChild(li);
    return;
  }

  const sorted = [...patient.sessions].sort((a, b) => {
    const da = new Date(a.date || 0).getTime();
    const db = new Date(b.date || 0).getTime();
    return db - da;
  });

  sorted.forEach((s) => {
    const li = document.createElement("li");
    li.dataset.id = s.id;
    if (s.id === state.selectedSessionId) li.classList.add("active");

    const main = document.createElement("span");
    const typeLabel = s.type === "initial" ? "Erstbefund" : "Folgetermin";
    const dateLabel = s.date ? formatDateShort(s.date) : "ohne Datum";
    main.textContent = `${typeLabel} – ${dateLabel}`;

    const meta = document.createElement("span");
    meta.className = "meta";
    const score = typeof s.score === "number" ? s.score.toFixed(0) : null;
    const region = s.region || "";
    const parts = [];
    if (region) parts.push(region);
    if (score !== null) parts.push(`Score ${score}`);
    meta.textContent = parts.join(" · ");

    li.appendChild(main);
    li.appendChild(meta);

    li.addEventListener("click", () => {
      state.selectedSessionId = s.id;
      renderPatientDetail();
    });

    sessionListEl.appendChild(li);
  });
}

function renderSessionEditor(patient) {
  const session =
    patient.sessions?.find((s) => s.id === state.selectedSessionId) || null;

  if (!session) {
    sessionEditorEl.classList.add("hidden");
    noSessionSelectedEl.classList.remove("hidden");
    return;
  }

  sessionEditorEl.classList.remove("hidden");
  noSessionSelectedEl.classList.add("hidden");

  sessionTypeSelect.value = session.type || "initial";
  sessionDateInput.value = session.date || "";
  sessionRegionSelect.value = session.region || patient.mainRegion || "";

  // complaints
  complaintChipsEl.innerHTML = "";
  const selectedComplaints = session.complaints || [];
  COMPLAINT_OPTIONS.forEach((opt) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = opt.label;
    if (selectedComplaints.includes(opt.id)) chip.classList.add("active");
    chip.addEventListener("click", () => {
      toggleChipSelection(selectedComplaints, opt.id);
      session.complaints = [...selectedComplaints];
      renderSessionEditor(patient);
    });
    complaintChipsEl.appendChild(chip);
  });

  // measures
  measureChipsEl.innerHTML = "";
  const selectedMeasures = session.measures || [];
  MEASURE_OPTIONS.forEach((opt) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = opt.label;
    if (selectedMeasures.includes(opt.id)) chip.classList.add("active");
    chip.addEventListener("click", () => {
      toggleChipSelection(selectedMeasures, opt.id);
      session.measures = [...selectedMeasures];
      renderSessionEditor(patient);
    });
    measureChipsEl.appendChild(chip);
  });

  // sliders
  const painVal = typeof session.pain === "number" ? session.pain : 5;
  painSlider.value = painVal;
  painValueEl.textContent = painVal;

  const funcVal =
    typeof session.function === "number" ? session.function : 5;
  functionSlider.value = funcVal;
  functionValueEl.textContent = funcVal;

  // speech notes & note text
  speechNotesEl.value = session.speechNotes || "";
  sessionNoteEl.value = session.note || "";

  // score
  if (typeof session.score === "number") {
    scoreValueEl.textContent = session.score.toFixed(0);
    const category = scoreCategoryFromValue(session.score);
    scoreCategoryEl.textContent = category.text;
    scoreCategoryEl.style.color = category.color;
  } else {
    scoreValueEl.textContent = "–";
    scoreCategoryEl.textContent = "Noch nicht berechnet";
    scoreCategoryEl.style.color = "var(--muted)";
  }
}

function toggleChipSelection(arr, id) {
  const idx = arr.indexOf(id);
  if (idx === -1) arr.push(id);
  else arr.splice(idx, 1);
}

// ---------- Score & Note Generation ----------

function calculateScore({ pain, func, complaintsCount }) {
  const painWeight = 0.4;
  const funcWeight = 0.4;
  const compWeight = 0.2;

  const painNorm = (pain / 10) * 100;
  const funcNorm = (func / 10) * 100;
  const compNorm = Math.min(complaintsCount, 5) / 5 * 100;

  const score = painNorm * painWeight + funcNorm * funcWeight + compNorm * compWeight;
  return Math.round(score);
}

function scoreCategoryFromValue(score) {
  if (score < 34)
    return { text: "milde Beschwerden", color: "#9ae6b4" };
  if (score < 67)
    return { text: "moderate Beschwerden", color: "#faf089" };
  return { text: "ausgeprägte Beschwerden", color: "#feb2b2" };
}

function generateNoteForSession(patient, session) {
  const typeLabel = session.type === "initial" ? "Erstbefund" : "Folgetermin";
  const dateLabel = session.date ? formatDateShort(session.date) : "ohne Datum";
  const regionLabel = session.region || patient.mainRegion || "nicht näher spezifiziert";

  const pain = typeof session.pain === "number" ? session.pain : null;
  const func = typeof session.function === "number" ? session.function : null;

  const complaintLabels = (session.complaints || []).map((id) => {
    const opt = COMPLAINT_OPTIONS.find((c) => c.id === id);
    return opt ? opt.label : id;
  });

  const measureLabels = (session.measures || []).map((id) => {
    const opt = MEASURE_OPTIONS.find((m) => m.id === id);
    return opt ? opt.label : id;
  });

  const score =
    typeof session.score === "number"
      ? session.score
      : calculateScore({
          pain: pain ?? 5,
          func: func ?? 5,
          complaintsCount: complaintLabels.length
        });

  const scoreCat = scoreCategoryFromValue(score);

  let subjective = `Subjektiv: `;
  if (complaintLabels.length) {
    subjective += `Patient:in berichtet über ${complaintLabels.join(", ")} im Bereich ${regionLabel}. `;
  } else {
    subjective += `Patient:in berichtet über Beschwerden im Bereich ${regionLabel}. `;
  }
  if (pain !== null) {
    subjective += `Schmerzintensität aktuell ${pain}/10. `;
  }
  if (func !== null) {
    subjective += `Alltags­einschränkung wird mit ${func}/10 angegeben. `;
  }

  let objective = `Objektiv: `;
  if (session.complaints?.includes("limited_rom")) {
    objective += `Beweglichkeit in der betroffenen Region reduziert. `;
  }
  if (session.complaints?.includes("weakness")) {
    objective += `Kraftdefizite in relevanten Muskelgruppen. `;
  }
  if (session.complaints?.includes("instability")) {
    objective += `subjektives Instabilitätsgefühl, Stabilitätskontrolle überprüft. `;
  }
  if (objective === "Objektiv: ") {
    objective += `Muskel- und Gelenkfunktion orientierend untersucht, weitere Tests je nach Verlauf. `;
  }

  let assessment = `Assessment: `;
  assessment += `Beschwerde-Score ${score}/100 (${scoreCat.text}). `;
  assessment += `Klinischer Befund vereinbar mit funktionellen Einschränkungen der Region ${regionLabel}. Prognose abhängig von Therapieadhärenz und Belastungsanpassung. `;

  if (session.speechNotes && session.speechNotes.trim()) {
    assessment += `Zusatznotizen: ${session.speechNotes.trim()} `;
  }

  let plan = `Plan: `;
  if (measureLabels.length) {
    plan += `Heute durchgeführt: ${measureLabels.join(", ")}. `;
  } else {
    plan += `Heutige Behandlung symptomorientiert durchgeführt. `;
  }
  plan += `Fortführung der Behandlung, Anpassung der Belastung im Alltag, Heimübungsprogramm je nach Verlauf. `;

  const header = `${typeLabel} am ${dateLabel} – Region: ${regionLabel}`;
  return `${header}\n\n${subjective}\n\n${objective}\n\n${assessment}\n\n${plan}`;
}

// ---------- Chart ----------

function renderScoreChart(patient) {
  if (!scoreChartEl) return;
  const ctx = scoreChartEl.getContext("2d");
  ctx.clearRect(0, 0, scoreChartEl.width, scoreChartEl.height);

  if (!patient.sessions || !patient.sessions.length) {
    ctx.fillStyle = "#4a5568";
    ctx.font = "12px system-ui";
    ctx.fillText("Noch keine Scores vorhanden", 10, 20);
    return;
  }

  const sessionsWithScore = patient.sessions
    .filter((s) => typeof s.score === "number" && s.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (!sessionsWithScore.length) {
    ctx.fillStyle = "#4a5568";
    ctx.font = "12px system-ui";
    ctx.fillText("Scores erscheinen hier, sobald berechnet wurde.", 10, 20);
    return;
  }

  const padding = 20;
  const w = scoreChartEl.width - padding * 2;
  const h = scoreChartEl.height - padding * 2;

  const minScore = 0;
  const maxScore = 100;

  ctx.strokeStyle = "#4a5568";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, padding + h);
  ctx.lineTo(padding, padding);
  ctx.lineTo(padding + w, padding);
  ctx.stroke();

  ctx.fillStyle = "#4a5568";
  ctx.font = "10px system-ui";
  ctx.fillText("Score", padding + 4, padding + 10);

  ctx.strokeStyle = "rgba(72, 187, 120, 0.4)";
  ctx.beginPath();
  const yMild = padding + h - (34 / 100) * h;
  ctx.moveTo(padding, yMild);
  ctx.lineTo(padding + w, yMild);
  ctx.stroke();

  ctx.strokeStyle = "rgba(246, 224, 94, 0.4)";
  ctx.beginPath();
  const yMod = padding + h - (67 / 100) * h;
  ctx.moveTo(padding, yMod);
  ctx.lineTo(padding + w, yMod);
  ctx.stroke();

  const stepX =
    sessionsWithScore.length > 1
      ? w / (sessionsWithScore.length - 1)
      : 0;

  ctx.strokeStyle = "#4fd1c5";
  ctx.lineWidth = 2;
  ctx.beginPath();
  sessionsWithScore.forEach((s, index) => {
    const x = padding + index * stepX;
    const norm = (s.score - minScore) / (maxScore - minScore);
    const y = padding + h - norm * h;

    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);

    ctx.fillStyle = "#63b3ed";
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.stroke();
}

// ---------- Speech ----------

function initSpeech() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    speechToggleBtn.disabled = true;
    speechHintEl.textContent =
      "Sprachfunktion in diesem Browser nicht verfügbar (am besten Chrome verwenden).";
    speechStatusIndicator.textContent = "Mikro nicht verfügbar";
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "de-DE";
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onstart = () => {
    isRecording = true;
    speechToggleBtn.textContent = "⏹️ Aufnahme stoppen";
    speechStatusIndicator.textContent = "Mikro aktiv – Aufnahme läuft";
    speechStatusIndicator.classList.add("active");
  };

  recognition.onend = () => {
    isRecording = false;
    speechToggleBtn.textContent = "🎙️ Aufnahme starten";
    speechStatusIndicator.textContent = "Mikro bereit";
    speechStatusIndicator.classList.remove("active");
  };

  recognition.onerror = (event) => {
    console.error("Speech recognition error:", event.error);
    isRecording = false;
    speechToggleBtn.textContent = "🎙️ Aufnahme starten";
    speechStatusIndicator.textContent = "Fehler bei Spracheingabe";
    speechStatusIndicator.classList.remove("active");
  };

  recognition.onresult = (event) => {
    let finalTranscript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript + " ";
      }
    }
    if (finalTranscript) {
      const current = speechNotesEl.value.trim();
      speechNotesEl.value = (current + " " + finalTranscript).trim();
      const patient = state.patients.find(
        (p) => p.id === state.selectedPatientId
      );
      if (patient) {
        const session = patient.sessions?.find(
          (s) => s.id === state.selectedSessionId
        );
        if (session) {
          session.speechNotes = speechNotesEl.value;
          saveState();
        }
      }
    }
  };

  speechStatusIndicator.textContent = "Mikro bereit";
}

function toggleSpeech() {
  if (!recognition) return;
  if (isRecording) {
    recognition.stop();
  } else {
    try {
      recognition.start();
    } catch (err) {
      console.error("Error starting recognition:", err);
    }
  }
}

// ---------- Event Handlers ----------

function setupEventListeners() {
  newPatientForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = patientNameInput.value.trim();
    const year = patientYearInput.value
      ? parseInt(patientYearInput.value, 10)
      : null;
    const region = patientRegionInput.value || "";

    if (!name) {
      alert("Bitte gib einen Namen ein.");
      return;
    }

    const patient = {
      id: uuid(),
      name,
      birthYear: year,
      mainRegion: region,
      sessions: []
    };
    state.patients.push(patient);
    state.selectedPatientId = patient.id;
    state.selectedSessionId = null;

    patientNameInput.value = "";
    patientYearInput.value = "";
    patientRegionInput.value = "";

    saveState();
    render();
  });

  addSessionBtn.addEventListener("click", () => {
    const patient = state.patients.find(
      (p) => p.id === state.selectedPatientId
    );
    if (!patient) return;

    const todayIso = new Date().toISOString().slice(0, 10);
    const newSession = {
      id: uuid(),
      type: patient.sessions.length ? "followup" : "initial",
      date: todayIso,
      region: patient.mainRegion || "",
      complaints: [],
      measures: [],
      pain: 5,
      function: 5,
      speechNotes: "",
      note: "",
      score: null
    };
    patient.sessions.push(newSession);
    state.selectedSessionId = newSession.id;
    saveState();
    renderPatientDetail();
  });

  painSlider.addEventListener("input", () => {
    const val = parseInt(painSlider.value, 10);
    painValueEl.textContent = val;
    updateCurrentSession((session) => {
      session.pain = val;
    });
  });

  functionSlider.addEventListener("input", () => {
    const val = parseInt(functionSlider.value, 10);
    functionValueEl.textContent = val;
    updateCurrentSession((session) => {
      session.function = val;
    });
  });

  sessionTypeSelect.addEventListener("change", () => {
    updateCurrentSession((session) => {
      session.type = sessionTypeSelect.value;
    });
  });

  sessionDateInput.addEventListener("change", () => {
    updateCurrentSession((session) => {
      session.date = sessionDateInput.value;
    });
    renderPatientDetail();
  });

  sessionRegionSelect.addEventListener("change", () => {
    updateCurrentSession((session) => {
      session.region = sessionRegionSelect.value;
    });
  });

  speechNotesEl.addEventListener("input", () => {
    updateCurrentSession((session) => {
      session.speechNotes = speechNotesEl.value;
    });
  });

  sessionNoteEl.addEventListener("input", () => {
    updateCurrentSession((session) => {
      session.note = sessionNoteEl.value;
    });
  });

  generateNoteBtn.addEventListener("click", () => {
    const patient = state.patients.find(
      (p) => p.id === state.selectedPatientId
    );
    if (!patient) return;
    const session = patient.sessions?.find(
      (s) => s.id === state.selectedSessionId
    );
    if (!session) return;

    const complaintsCount = session.complaints?.length || 0;
    const pain =
      typeof session.pain === "number" ? session.pain : 5;
    const func =
      typeof session.function === "number" ? session.function : 5;

    const score = calculateScore({ pain, func, complaintsCount });
    session.score = score;

    const note = generateNoteForSession(patient, session);
    session.note = note;

    saveState();
    renderPatientDetail();
  });

  copyNoteBtn.addEventListener("click", async () => {
    const text = sessionNoteEl.value;
    if (!text.trim()) {
      alert("Keine Doku zum Kopieren vorhanden.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      copyNoteBtn.textContent = "✔️ Kopiert";
      setTimeout(() => {
        copyNoteBtn.textContent = "In Zwischenablage kopieren";
      }, 1500);
    } catch (err) {
      console.error("Clipboard error:", err);
      alert("Konnte nicht in die Zwischenablage kopieren.");
    }
  });

  saveSessionBtn.addEventListener("click", () => {
    saveState();
    alert("Sitzung gespeichert (lokal im Browser).");
  });

  deleteSessionBtn.addEventListener("click", () => {
    const patient = state.patients.find(
      (p) => p.id === state.selectedPatientId
    );
    if (!patient) return;

    const session = patient.sessions?.find(
      (s) => s.id === state.selectedSessionId
    );
    if (!session) return;

    const ok = confirm("Diese Sitzung wirklich löschen?");
    if (!ok) return;

    patient.sessions = patient.sessions.filter(
      (s) => s.id !== session.id
    );
    state.selectedSessionId = null;
    saveState();
    renderPatientDetail();
  });

  speechToggleBtn.addEventListener("click", () => {
    toggleSpeech();
  });
}

function updateCurrentSession(updater) {
  const patient = state.patients.find(
    (p) => p.id === state.selectedPatientId
  );
  if (!patient) return;
  const session = patient.sessions?.find(
    (s) => s.id === state.selectedSessionId
  );
  if (!session) return;
  updater(session);
  saveState();
}

// ---------- Init ----------

document.addEventListener("DOMContentLoaded", () => {
  loadState();
  render();
  setupEventListeners();
  initSpeech();
});
