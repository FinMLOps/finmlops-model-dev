"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";

const DELAY = 400; // a faster first load never shows it
const MIN = 700;   // once shown, keep it long enough not to flash
const MESSAGES = ["Loading market sentiment…", "Reading the headlines…", "Asking FinBERT how it feels…", "Lining up the charts…"];

// a branded loader, only while the first data load is slow
export function Splash() {
  const { ov, ovError } = useApp();
  const [phase, setPhase] = useState<"wait" | "show" | "hide" | "gone">("wait");
  const [msg, setMsg] = useState(0);
  const shownAt = useRef(0);
  const ready = Boolean(ov || ovError);

  useEffect(() => {
    const t = setTimeout(() => setPhase(p => {
      if (p !== "wait") return p;
      shownAt.current = performance.now();
      return "show";
    }), DELAY);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (phase === "wait") { setPhase("gone"); return; } // eslint-disable-line react-hooks/set-state-in-effect -- data arrived before the delay
    if (phase !== "show") return;
    const t = setTimeout(() => { setPhase("hide"); setTimeout(() => setPhase("gone"), 450); }, Math.max(0, MIN - (performance.now() - shownAt.current)));
    return () => clearTimeout(t);
  }, [ready, phase]);

  useEffect(() => {
    if (phase !== "show") return;
    const t = setInterval(() => setMsg(m => (m + 1) % MESSAGES.length), 1400);
    return () => clearInterval(t);
  }, [phase]);

  if (phase === "wait" || phase === "gone") return null;
  return (
    <div className={`splash show ${phase === "hide" ? "hide" : ""}`} role="status" aria-live="polite">
      <div className="splash-card">
        <div className="splash-logo"><img src="/img/android-chrome-192x192.png" alt="" width={88} height={88} /></div>
        <div className="splash-brand">FinMLOps</div>
        <div className="splash-bar"><i /></div>
        <p className="splash-msg">{MESSAGES[msg]}</p>
      </div>
    </div>
  );
}
