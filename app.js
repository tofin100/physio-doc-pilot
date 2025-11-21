// app.js – Physio Doc Co-Pilot Pilot
// Fokus: Patient extrem schnell anlegen, sofort Erstbefund starten

const STORAGE_KEY = "physioDocPilot_v2";

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
  { id: "mt", label: "Manuelle Therapie" },
  { id: "pt", label: "Krankengymnastik" },
  { id: "ml", label: "Lymphdrainage" },
  { id: "exercise", label: "aktive Übungen" },
  { id: "edu", label: "Edukation" },
  { id: "taping", label: "Taping" },
  { id: "device", label: "Gerätetraining" }
];

let recognition = null;
let isRecording = false;

// --------------- Helpers ----------------

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0,
      v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.patients)) {
      state.patients = parsed.patients;
    }
  } catch (e) {
    console.error("Load state error:", e);
  }
}

function saveState() {
  try {
    const data = { patients: state.patients };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error("Save state error:", e);
  }
}

function formatDateShort(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("de-DE");
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function getSelectedPatient() {
  return state.patients.find((p) => p.id === state.selectedPatientId) || null;
}

function getSelectedSession(patient) {
  if (!patient) return null;
  return patient.sessions?.find((s) => s.id === state.selectedSessionId) || null;
}

// --------------- DOM refs ----------------

const patientListEl = document.getElementById("patient-list");
const newPatientForm = document.getElementById("new-patient-form");
const patientNameInput = document.getElementById("patient-name-input");
const patientYearInput = document.getElementById("patient-year-input");
const patientRegionInput = document.getElementById("patient-region-input");

const noPatientSelectedEl = document.getElementById("no-patient-selected");
const patientDetailEl = document.getElementById("patient-detail");
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

// --------------- Score & Note ----------------

function calculateScore({ pain, func, complaintsCount }) {
  const painNorm = (pain / 10) * 100;
  const funcNorm = (func / 10) * 100;
  const compNorm = Math.min(complaintsCount, 5) / 5 * 100;

  const score =
    painNorm * 0.4 +
    funcNorm * 0.4 +
    compNorm * 0.2;

  return Math.round(score);
}

function scoreCategoryFromValue(score) {
  if (score < 34) return { text: "milde Beschwerden", color: "#9ae6b4" };
  if (score < 67) return { text: "moderate Beschwerden", color: "#faf089" };
  return { text: "ausgeprägte Beschwerden", color: "#feb2b2" };
}

function generateNoteForSession(patient, session) {
  const typeLabel = session.type === "initial" ? "Erstbefund" : "Folgetermin";
  const dateLabel = session.date ? formatDateShort(session.date) : "ohne Datum";
  const regionLabel = session.region || patient.mainRegion || "nicht spezifiziert";

  const pain = typeof session.pain === "number" ? session.pain : 5;
  const func = typeof session.function === "number" ? session.function : 5;
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
          pain,
          func,
          complaintsCount: complaintLabels.length
        });

  const scoreCat = scoreCategoryFromValue(score);

  let subjective = "Subjektiv: ";
  if (complaintLabels.length) {
    subjective += `Patient:in berichtet über ${complaintLabels.join(", ")} im Bereich ${regionLabel}. `;
  } else {
    subjective += `Patient:in berichtet über Beschwerden im Bereich ${regionLabel}. `;
  }
  subjective += `Schmerzintensität aktuell ${pain}/10, Alltags­einschränkung ${func}/10. `;

  let objective = "Objektiv: ";
  if (session.complaints?.includes("limited_rom")) {
    objective += "Beweglichkeit reduziert. ";
  }
  if (session.complaints?.includes("weakness")) {
    objective += "Kraftdefizite in relevanten Muskelgruppen. ";
  }
  if (session.complaints?.includes("instability")) {
    objective += "subjektives Instabilitätsgefühl, Stabilitätskontrolle geprüft. ";
  }
  if (objective === "Objektiv: ") {
    objective += "Muskel- und Gelenkfunktion orientierend untersucht, weitere Tests je nach Verlauf. ";
  }

  let assessment = `Assessment: Beschwerde-Score ${score}/100 (${scoreCat.text}). `;
  assessment += `Befund vereinbar mit funktionellen Einschränkungen der Region ${regionLabel}. `;
  if (session.speechNotes && session.speechNotes.trim()) {
    assessment += `Relevante Zusatzinformationen: ${session.speechNotes.trim()} `;
  }

  let plan = "Plan: ";
  if (measureLabels.length) {
    plan += `heute durchgeführt: ${measureLabels.join(", ")}. `;
  } else {
    plan += "symptomorientierte Behandlung durchgeführt. ";
  }
  plan += "Fortführung der Therapie, Anpassung der Belastung, Heimübungsprogramm nach Bedarf. ";

  const header = `${typeLabel} am ${dateLabel} – Region: ${regionLabel}`;
  return `${header}\n\n${subjective}\n\n${objective}\n\n${assessment}\n\n${plan}`;
}

// --------------- Data actions ----------------

function createNewSession(patient, type = "initial") {
  const session = {
    id: uuid(),
    type,
    date: todayIso(),
    region: patient.mainRegion || "",
    complaints: [],
    measures: [],
    pain: 5,
    function: 5,
    speechNotes: "",
    note: "",
    score: null
  };
  if (!patient.sessions) patient.sessions = [];
  patient.sessions.push(session);
  return session;
}

function updateCurrentSession(updater) {
  const patient = getSelectedPatient();
  if (!patient) return;
  const session = getSelectedSession(patient);
  if (!session) return;
  updater(session);
  saveState();
}

// --------------- Rendering ----------------

function render() {
  renderPatients();
  renderPatientDetail();
}

function renderPatients() {
  patientListEl.innerHTML = "";

  if (!state.patients.length) {
    const li = document.createElement("li");
    li.textContent = "Noch keine Patienten – lege unten einen neuen an.";
    li.className = "meta";
    li.style.cursor = "default";
    patientListEl.appendChild(li);
    return;
  }

  state.patients.forEach((p) => {
    const li = document.createElement("li");
    li.dataset.id = p.id;

    const nameSpan = document.createElement("span");
    nameSpan.textContent = p.name || "Unbenannter Patient";

    const metaSpan = document.createElement("span");
    metaSpan.className = "meta";
    const parts = [];
    if (p.birthYear) parts.push(`*${p.birthYear}`);
    if (p.mainRegion) parts.push(p.mainRegion);
    metaSpan.textContent = parts.join(" · ");

    li.appendChild(nameSpan);
    li.appendChild(metaSpan);

    if (p.id === state.selectedPatientId) li.classList.add("active");

    li.addEventListener("click", () => {
      state.selectedPatientId = p.id;
      // falls noch keine Sitzung existiert → automatisch Erstbefund erstellen
      if (!p.sessions || !p.sessions.length) {
        const s = createNewSession(p, "initial");
        state.selectedSessionId = s.id;
      } else {
        state.selectedSessionId = p.sessions[0].id;
      }
      saveState();
      renderPatientDetail();
    });

    patientListEl.appendChild(li);
  });
}

function renderPatientDetail() {
  const patient = getSelectedPatient();
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
    li.textContent = "Noch keine Sitzungen";
    li.className = "meta";
    li.style.cursor = "default";
    sessionListEl.appendChild(li);
    return;
  }

  const sorted = [...patient.sessions].sort(
    (a, b) => new Date(b.date || 0) - new Date(a.date || 0)
  );

  sorted.forEach((s) => {
    const li = document.createElement("li");
    li.dataset.id = s.id;

    const main = document.createElement("span");
    const typeLabel = s.type === "initial" ? "Erstbefund" : "Folgetermin";
    const dateLabel = s.date ? formatDateShort(s.date) : "ohne Datum";
    main.textContent = `${typeLabel} – ${dateLabel}`;

    const meta = document.createElement("span");
    meta.className = "meta";
    const parts = [];
    if (s.region) parts.push(s.region);
    if (typeof s.score === "number") parts.push(`Score ${s.score}`);
    meta.textContent = parts.join(" · ");

    li.appendChild(main);
    li.appendChild(meta);

    if (s.id === state.selectedSessionId) li.classList.add("active");

    li.addEventListener("click", () => {
      state.selectedSessionId = s.id;
      renderPatientDetail();
    });

    sessionListEl.appendChild(li);
  });
}

function renderSessionEditor(patient) {
  const session = getSelectedSession(patient);
  if (!session) {
    sessionEditorEl.classList.add("hidden");
    noSessionSelectedEl.classList.remove("hidden");
    return;
  }

  sessionEditorEl.classList.remove("hidden");
  noSessionSelectedEl.classList.add("hidden");

  sessionTypeSelect.value = session.type || "initial";
  sessionDateInput.value = session.date || todayIso();
  sessionRegionSelect.value =
    session.region || patient.mainRegion || "";

  // Chips: Beschwerden
  complaintChipsEl.innerHTML = "";
  const selectedComplaints = session.complaints || [];
  COMPLAINT_OPTIONS.forEach((opt) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = opt.label;
    if (selectedComplaints.includes(opt.id)) chip.classList.add("active");
    chip.addEventListener("click", () => {
      toggleInArray(selectedComplaints, opt.id);
      session.complaints = [...selectedComplaints];
      saveState();
      renderSessionEditor(patient);
    });
    complaintChipsEl.appendChild(chip);
  });

  // Chips: Maßnahmen
  measureChipsEl.innerHTML = "";
  const selectedMeasures = session.measures || [];
  MEASURE_OPTIONS.forEach((opt) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = opt.label;
    if (selectedMeasures.includes(opt.id)) chip.classList.add("active");
    chip.addEventListener("click", () => {
      toggleInArray(selectedMeasures, opt.id);
      session.measures = [...selectedMeasures];
      saveState();
      renderSessionEditor(patient);
    });
    measureChipsEl.appendChild(chip);
  });

  const pain = typeof session.pain === "number" ? session.pain : 5;
  const func = typeof session.function === "number" ? session.function : 5;
  painSlider.value = pain;
  painValueEl.textContent = pain;
  functionSlider.value = func;
  functionValueEl.textContent = func;

  speechNotesEl.value = session.speechNotes || "";
  sessionNoteEl.value = session.note || "";

  if (typeof session.score === "number") {
    scoreValueEl.textContent = session.score;
    const cat = scoreCategoryFromValue(session.score);
    scoreCategoryEl.textContent = cat.text;
    scoreCategoryEl.style.color = cat.color;
  } else {
    scoreValueEl.textContent = "–";
    scoreCategoryEl.textContent = "Noch nicht berechnet";
    scoreCategoryEl.style.color = "var(--muted)";
  }
}

function toggleInArray(arr, id) {
  const idx = arr.indexOf(id);
  if (idx === -1) arr.push(id);
  else arr.splice(idx, 1);
}

// --------------- Chart ----------------

function renderScoreChart(patient) {
  const ctx = scoreChartEl.getContext("2d");
  ctx.clearRect(0, 0, scoreChartEl.width, scoreChartEl.height);

  if (!patient.sessions || !patient.sessions.length) {
    ctx.fillStyle = "#4a5568";
    ctx.font = "12px system-ui";
    ctx.fillText("Noch keine Scores vorhanden", 10, 20);
    return;
  }

  const items = patient.sessions
    .filter((s) => typeof s.score === "number" && s.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (!items.length) {
    ctx.fillStyle = "#4a5568";
    ctx.font = "12px system-ui";
    ctx.fillText("Scores erscheinen, sobald du Dokus generierst.", 10, 20);
    return;
  }

  const padding = 20;
  const w = scoreChartEl.width - padding * 2;
  const h = scoreChartEl.height - padding * 2;

  ctx.strokeStyle = "#4a5568";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, padding);
  ctx.lineTo(padding, padding + h);
  ctx.lineTo(padding + w, padding + h);
  ctx.stroke();

  const stepX = items.length > 1 ? w / (items.length - 1) : 0;

  ctx.strokeStyle = "#4fd1c5";
  ctx.lineWidth = 2;
  ctx.beginPath();

  items.forEach((s, idx) => {
    const x = padding + idx * stepX;
    const norm = s.score / 100;
    const y = padding + h - norm * h;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    ctx.fillStyle = "#63b3ed";
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.stroke();
}

// --------------- Speech ----------------

function initSpeech() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    speechToggleBtn.disabled = true;
    speechHintEl.textContent =
      "Sprachfunktion in diesem Browser nicht verfügbar (Chrome empfohlen).";
    speechStatusIndicator.textContent = "Mikrofon nicht verfügbar";
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "de-DE";
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onstart = () => {
    isRecording = true;
    speechToggleBtn.textContent = "⏹️ Aufnahme stoppen";
    speechStatusIndicator.textContent = "Mikrofon aktiv";
    speechStatusIndicator.classList.add("active");
  };

  recognition.onend = () => {
    isRecording = false;
    speechToggleBtn.textContent = "🎙️ Aufnahme starten";
    speechStatusIndicator.textContent = "Mikrofon bereit";
    speechStatusIndicator.classList.remove("active");
  };

  recognition.onerror = (e) => {
    console.error("Speech error:", e.error);
    isRecording = false;
    speechToggleBtn.textContent = "🎙️ Aufnahme starten";
    speechStatusIndicator.textContent = "Fehler bei Spracheingabe";
    speechStatusIndicator.classList.remove("active");
  };

  recognition.onresult = (event) => {
    let finalText = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        finalText += event.results[i][0].transcript + " ";
      }
    }
    if (finalText) {
      const current = speechNotesEl.value.trim();
      speechNotesEl.value = (current + " " + finalText).trim();
      updateCurrentSession((session) => {
        session.speechNotes = speechNotesEl.value;
      });
    }
  };

  speechStatusIndicator.textContent = "Mikrofon bereit";
}

function toggleSpeech() {
  if (!recognition) return;
  if (isRecording) recognition.stop();
  else {
    try {
      recognition.start();
    } catch (e) {
      console.error("start recognition error", e);
    }
  }
}

// --------------- Event listeners ----------------

function setupEventListeners() {
  newPatientForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = patientNameInput.value.trim();
    if (!name) {
      alert("Bitte einen Namen eingeben.");
      return;
    }

    const year = patientYearInput.value
      ? parseInt(patientYearInput.value, 10)
      : null;
    const region = patientRegionInput.value || "";

    const patient = {
      id: uuid(),
      name,
      birthYear: year,
      mainRegion: region,
      sessions: []
    };
    state.patients.push(patient);
    state.selectedPatientId = patient.id;

    // direkt Erstbefund erstellen & auswählen
    const s = createNewSession(patient, "initial");
    state.selectedSessionId = s.id;

    patientNameInput.value = "";
    patientYearInput.value = "";
    patientRegionInput.value = "";

    saveState();
    render();
  });

  addSessionBtn.addEventListener("click", () => {
    const patient = getSelectedPatient();
    if (!patient) return;
    const s = createNewSession(patient, "followup");
    state.selectedSessionId = s.id;
    saveState();
    renderPatientDetail();
  });

  sessionTypeSelect.addEventListener("change", () => {
    updateCurrentSession((session) => {
      session.type = sessionTypeSelect.value;
    });
    renderPatientDetail();
  });

  sessionDateInput.addEventListener("change", () => {
    updateCurrentSession((session) => {
      session.date = sessionDateInput.value || todayIso();
    });
    renderPatientDetail();
  });

  sessionRegionSelect.addEventListener("change", () => {
    updateCurrentSession((session) => {
      session.region = sessionRegionSelect.value;
    });
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
    const patient = getSelectedPatient();
    const session = getSelectedSession(patient);
    if (!patient || !session) return;

    const complaintsCount = session.complaints?.length || 0;
    const pain = typeof session.pain === "number" ? session.pain : 5;
    const func = typeof session.function === "number" ? session.function : 5;

    const score = calculateScore({ pain, func, complaintsCount });
    session.score = score;
    session.note = generateNoteForSession(patient, session);

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
    } catch (e) {
      console.error("Clipboard error:", e);
      alert("Konnte nicht in die Zwischenablage kopieren.");
    }
  });

  saveSessionBtn.addEventListener("click", () => {
    saveState();
    alert("Sitzung gespeichert (lokal im Browser).");
  });

  deleteSessionBtn.addEventListener("click", () => {
    const patient = getSelectedPatient();
    const session = getSelectedSession(patient);
    if (!patient || !session) return;
    if (!confirm("Sitzung wirklich löschen?")) return;
    patient.sessions = patient.sessions.filter((s) => s.id !== session.id);
    state.selectedSessionId = patient.sessions[0]?.id || null;
    saveState();
    renderPatientDetail();
  });

  speechToggleBtn.addEventListener("click", () => {
    toggleSpeech();
  });
}

// --------------- Init ----------------

document.addEventListener("DOMContentLoaded", () => {
  loadState();
  render();
  setupEventListeners();
  initSpeech();
});
