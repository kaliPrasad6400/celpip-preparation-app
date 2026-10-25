import { useCallback, useEffect, useRef, useState } from "react";

/** Countdown timer. `onExpire` fires once when it reaches 0. */
export function useCountdown(seconds: number, onExpire?: () => void) {
  const [left, setLeft] = useState(seconds);
  const [running, setRunning] = useState(false);
  const cb = useRef(onExpire);
  cb.current = onExpire;
  const endAt = useRef<number | null>(null);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      const rem = Math.max(0, Math.round(((endAt.current ?? 0) - Date.now()) / 1000));
      setLeft(rem);
      if (rem <= 0) {
        setRunning(false);
        window.clearInterval(id);
        cb.current?.();
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [running]);

  const start = useCallback((s?: number) => {
    const total = s ?? seconds;
    endAt.current = Date.now() + total * 1000;
    setLeft(total);
    setRunning(true);
  }, [seconds]);
  const stop = useCallback(() => setRunning(false), []);
  const reset = useCallback((s?: number) => {
    setRunning(false);
    setLeft(s ?? seconds);
  }, [seconds]);
  return { left, running, start, stop, reset, elapsed: seconds - left };
}

/** Count-up stopwatch for untimed work. */
export function useStopwatch() {
  const [secs, setSecs] = useState(0);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setSecs((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  return { secs, running, start: () => setRunning(true), stop: () => setRunning(false), reset: () => { setRunning(false); setSecs(0); } };
}

// ---------------------------------------------------------------- speech synthesis (listening audio)
export const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;

function pickVoices(): { male: SpeechSynthesisVoice[]; female: SpeechSynthesisVoice[]; any: SpeechSynthesisVoice[] } {
  const all = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  const preferred = all.filter((v) => /en-CA|en-US|en-GB/.test(v.lang));
  const pool = preferred.length ? preferred : all;
  const femaleNames = /samantha|victoria|karen|moira|tessa|fiona|allison|ava|susan|zira|female|serena|kate|nicky|joelle|jenny|aria/i;
  const maleNames = /daniel|alex|fred|tom|oliver|aaron|david|mark|male|guy|evan|nathan|reed|rishi|gordon|arthur/i;
  return {
    female: pool.filter((v) => femaleNames.test(v.name)),
    male: pool.filter((v) => maleNames.test(v.name)),
    any: pool,
  };
}

export type Segment = { speaker: string; text: string };

/** Plays segments sequentially with distinct voices per speaker. Returns a stop function. */
export function playScript(
  segments: Segment[],
  opts: { voices?: Record<string, string>; rate?: number; onSegment?: (i: number) => void; onEnd?: () => void },
) {
  const synth = window.speechSynthesis;
  synth.cancel();
  const v = pickVoices();
  const speakers = Array.from(new Set(segments.map((s) => s.speaker)));
  const assign: Record<string, SpeechSynthesisVoice | undefined> = {};
  let mi = 0, fi = 0, ai = 0;
  speakers.forEach((sp) => {
    const g = opts.voices?.[sp] ?? (/(narrator)/i.test(sp) ? "narrator" : undefined);
    if (g === "female" && v.female.length) assign[sp] = v.female[fi++ % v.female.length];
    else if (g === "male" && v.male.length) assign[sp] = v.male[mi++ % v.male.length];
    else assign[sp] = v.any[ai++ % Math.max(1, v.any.length)];
  });
  let cancelled = false;
  let i = 0;
  const next = () => {
    if (cancelled) return;
    if (i >= segments.length) {
      opts.onEnd?.();
      return;
    }
    const seg = segments[i];
    opts.onSegment?.(i);
    const u = new SpeechSynthesisUtterance(seg.text);
    u.voice = assign[seg.speaker] ?? null;
    u.lang = u.voice?.lang ?? "en-CA";
    u.rate = opts.rate ?? 1;
    u.onend = () => {
      i += 1;
      window.setTimeout(next, 350);
    };
    u.onerror = () => {
      i += 1;
      next();
    };
    synth.speak(u);
  };
  // voices load asynchronously in some browsers
  let started = false;
  const begin = () => {
    if (started || cancelled) return;
    started = true;
    next();
  };
  if (window.speechSynthesis.getVoices().length === 0) {
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.onvoiceschanged = null;
      begin();
    };
    window.setTimeout(begin, 800);
  } else begin();
  return () => {
    cancelled = true;
    synth.cancel();
  };
}

// ---------------------------------------------------------------- audio recording
export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const supported = typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

  const start = useCallback(async () => {
    setError(null);
    if (!supported) {
      setError("Audio recording is not supported in this browser.");
      return false;
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported?.(m));
      const r = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = () => {
        const b = new Blob(chunks.current, { type: r.mimeType || "audio/webm" });
        setBlob(b);
        setUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(b);
        });
        stream.current?.getTracks().forEach((t) => t.stop());
      };
      r.start(250);
      rec.current = r;
      setRecording(true);
      return true;
    } catch (e: any) {
      setError(e?.name === "NotAllowedError" ? "Microphone permission was denied." : "Could not start the microphone.");
      return false;
    }
  }, [supported]);

  const stop = useCallback(() => {
    if (rec.current && rec.current.state !== "inactive") rec.current.stop();
    setRecording(false);
  }, []);

  const clear = useCallback(() => {
    setBlob(null);
    setUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
  }, []);

  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);
  return { supported, recording, blob, url, error, start, stop, clear };
}

/** Browser speech recognition (Chrome/Edge/Safari). Audio may be processed by the browser vendor's service. */
export function useBrowserSTT() {
  const SR: any = typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const r = useRef<any>(null);
  const finalText = useRef("");
  const start = useCallback(() => {
    if (!SR) return;
    finalText.current = "";
    setText("");
    const rec = new SR();
    rec.lang = "en-CA";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText.current += t + " ";
        else interim += t;
      }
      setText((finalText.current + interim).trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.start();
    r.current = rec;
    setListening(true);
  }, [SR]);
  const stop = useCallback(() => {
    r.current?.stop();
    setListening(false);
  }, []);
  return { supported: !!SR, text, setText, listening, start, stop };
}
