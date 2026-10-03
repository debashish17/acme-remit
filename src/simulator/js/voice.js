/* Browser speech: push-to-talk recognition (Web Speech API, Chrome/Edge) and spoken replies
   (speechSynthesis), plus a microphone level for the orb while listening. */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const voice = {
  canListen: Boolean(SR),
  canSpeak: "speechSynthesis" in window,
  muted: false,
};

/* ---------- listening ---------- */
let rec = null;
let micStream = null;
let analyser = null;
let buf = null;

async function startMeter() {
  if (micStream || !navigator.mediaDevices?.getUserMedia) return;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    analyser = ac.createAnalyser();
    analyser.fftSize = 512;
    ac.createMediaStreamSource(micStream).connect(analyser);
    buf = new Uint8Array(analyser.fftSize);
  } catch {
    micStream = null;
  }
}

/** 0..1 loudness while the mic is open, else null (the orb then uses its own envelope). */
export function micLevel() {
  if (!analyser || !rec) return null;
  analyser.getByteTimeDomainData(buf);
  let s = 0;
  for (const v of buf) {
    const d = (v - 128) / 128;
    s += d * d;
  }
  return Math.min(1, Math.sqrt(s / buf.length) * 5);
}

/**
 * Starts recognition. onInterim(firm, interim) streams the transcript; the promise resolves with
 * the final text when stop() is called (or "" if nothing was heard).
 */
export function listen({ onInterim, lang = "en-IN" } = {}) {
  if (!SR) return Promise.reject(new Error("unsupported"));
  stopSpeaking();
  void startMeter();
  return new Promise((resolve, reject) => {
    let finalText = "";
    let interimText = "";
    rec = new SR();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (e) => {
      interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      onInterim?.(finalText.trim(), interimText.trim());
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      rec = null;
      reject(new Error(e.error));
    };
    rec.onend = () => {
      rec = null;
      resolve(`${finalText} ${interimText}`.trim());
    };
    try {
      rec.start();
    } catch (err) {
      rec = null;
      reject(err);
    }
  });
}

export function stopListening() {
  if (rec) rec.stop();
}

/* ---------- speaking ---------- */
let pickedVoice = null;
let preferred = ""; // a voice name chosen in the picker; "" picks the best Indian English voice

/** English voices this browser offers, Indian English and natural-sounding ones first. */
export function browserVoices() {
  if (!voice.canSpeak) return [];
  const rank = (v) =>
    (/en-IN/i.test(v.lang) ? 0 : /en-GB/i.test(v.lang) ? 2 : 4) +
    (/natural|online|neural/i.test(v.name) ? 0 : 1);
  return speechSynthesis
    .getVoices()
    .filter((v) => /^en/i.test(v.lang))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
export function setPreferredVoice(name) {
  preferred = name || "";
  pickedVoice = null;
}

/* ---------- Amazon Polly, through the server (POST /sim/speak) ---------- */
export const POLLY = "polly";
let pollyFetch = null; // (text) => Promise<{ audio: base64 mp3, marks: [{ time, start }] }>
let playing = null; // the <audio> element currently speaking

/** Lets speak() use Polly when the picker chooses it; null switches it off. */
export function setPolly(fetcher) {
  pollyFetch = fetcher;
}

/** Plays Polly's audio and fires onWord at each word mark. Rejects if it cannot start. */
async function speakPolly(text, onWord) {
  const r = await pollyFetch(text);
  const bytes = Uint8Array.from(atob(r.audio), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
  const audio = new Audio(url);
  playing = audio;
  let raf = 0;
  let i = 0;
  const step = () => {
    const ms = audio.currentTime * 1000;
    while (i < r.marks.length && r.marks[i].time <= ms) onWord?.(r.marks[i++].start);
    if (!audio.paused && !audio.ended) raf = requestAnimationFrame(step);
  };
  const finished = new Promise((resolve) => {
    const done = () => {
      cancelAnimationFrame(raf);
      URL.revokeObjectURL(url);
      if (playing === audio) playing = null;
      resolve();
    };
    audio.addEventListener("ended", done);
    audio.addEventListener("pause", done);
    audio.addEventListener("error", done);
  });
  await audio.play(); // rejects if the browser blocks playback: the caller falls back
  raf = requestAnimationFrame(step);
  return finished;
}
/** Calls fn when the browser's voice list loads or changes (it arrives late in Chrome). */
export function onVoicesChanged(fn) {
  if (voice.canSpeak) speechSynthesis.addEventListener("voiceschanged", fn);
}
function pickVoice() {
  if (pickedVoice) return pickedVoice;
  const vs = speechSynthesis.getVoices();
  pickedVoice =
    (preferred && preferred !== POLLY && vs.find((v) => v.name === preferred)) ||
    browserVoices()[0] ||
    vs.find((v) => /^en/i.test(v.lang)) ||
    null;
  return pickedVoice;
}
onVoicesChanged(() => {
  pickedVoice = null;
});

/**
 * Speaks text. onWord(charIndex) fires at each word as it is spoken: from the engine's boundary
 * events when it sends them, otherwise from a timer that paces the words. Resolves when done.
 */
export async function speak(text, { onWord } = {}) {
  if (preferred === POLLY && pollyFetch && !voice.muted) {
    try {
      return await speakPolly(text, onWord);
    } catch {
      /* Polly unavailable or blocked: use the browser's voice below */
    }
  }
  return speakBrowser(text, { onWord });
}

function speakBrowser(text, { onWord } = {}) {
  return new Promise((resolve) => {
    const words = [...text.matchAll(/\S+/g)].map((m) => m.index);
    let timer = null;
    let gotBoundary = false;
    const pace = () => {
      let i = 0;
      const step = () => {
        if (i >= words.length) return;
        onWord?.(words[i++]);
        timer = setTimeout(step, 250);
      };
      step();
    };
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    if (!voice.canSpeak || voice.muted) {
      pace();
      setTimeout(done, words.length * 250 + 300);
      return;
    }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = v?.lang || "en-IN";
    u.rate = 1.02;
    u.onboundary = (e) => {
      if (e.name && e.name !== "word") return;
      gotBoundary = true;
      clearTimeout(timer);
      onWord?.(e.charIndex);
    };
    u.onstart = () => {
      timer = setTimeout(() => {
        if (!gotBoundary) pace();
      }, 700);
    };
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  playing?.pause();
  if (voice.canSpeak) speechSynthesis.cancel();
}
