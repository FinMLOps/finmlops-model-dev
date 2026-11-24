"use client";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";

type Step = { sel: string; title: string; text: React.ReactNode; align?: "start" | "center" | "end" };
const STEPS: Step[] = [
  { sel: ".watchlist", title: "Your watchlist", text: <>Seven big tech stocks, each with its <b>net sentiment</b> over the last 7 days: the % of positive headlines minus the % of negative ones, as labeled by our model. Click a ticker to open it.</> },
  { sel: ".quote", title: "The ticker at a glance", text: <>This week&apos;s net sentiment, how much it moved compared with the week before, and the split between positive, neutral and negative news.</> },
  { sel: ".chart-panel", align: "end", title: "Sentiment vs. price", text: <><b>Blue</b> is daily net sentiment, <b>amber</b> is the closing price. <b>High</b> and <b>Low</b> mark the extremes. Hover any day to see its top headlines, and click to read them.</> },
  { sel: ".pulse-panel", align: "center", title: "Market pulse", text: <>Two weeks of sentiment for all seven tickers at once. <b>Green</b> days were mostly positive news, <b>red</b> mostly negative. Hover a day for its numbers, click it to read the top headlines.</> },
  { sel: ".headlines-panel", align: "start", title: "Why the model decided", text: <>Every headline with the model&apos;s label and confidence. Click one to see <b>which words</b> pushed it toward positive or negative.</> },
  { sel: ".tabs", title: "More tools", text: <><b>Analyzer</b> scores any headline you paste. <b>Models</b> shows the champion, the candidates, and the rule a new model must pass to be promoted.</> },
  { sel: ".nav-search", title: "Search anything", text: <>Press <kbd>Ctrl K</kbd> (<kbd>⌘K</kbd> on a Mac) anytime to jump to a ticker, find a headline or analyze one, and <b>?</b> to replay this tour. The current champion model and its scores are on the <b>Models</b> page.</> },
];
const TOPBAR = 54, GAP = 14, M = 12, PAD = 6;
type Side = "right" | "below" | "above" | "inside";

export function Tour() {
  const { touring, setTouring } = useApp();
  const path = usePathname();
  const on = touring && path === "/dashboard";
  const [steps, setSteps] = useState<Step[]>([]);
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(0); // the step whose text is on the card (it crossfades after a move)
  const [open, setOpen] = useState(false);
  const spot = useRef<HTMLDivElement>(null), pop = useRef<HTMLDivElement>(null), caret = useRef<HTMLSpanElement>(null);
  const live = useRef({ spot: { x: 0, y: 0, w: 0, h: 0 }, pop: { x: 0, y: 0 }, side: "below" as Side, finalY: 0, last: 0, step: 0 });

  const end = useCallback(() => {
    setOpen(false);
    try { localStorage.setItem("finmlops.toured", "1"); } catch {}
    setTimeout(() => setTouring(false), 300);
  }, [setTouring]);
  const go = useCallback((delta: number) => {
    if (i + delta >= steps.length) return end();
    if (i + delta >= 0) setI(i + delta);
  }, [i, steps.length, end]);

  const target = () => document.querySelector(steps[live.current.step]?.sel ?? "") as HTMLElement | null;

  // the card's side for a target at rect r: right of tall targets, else below, else above; inside only if nothing fits
  const sideFor = (r: { top: number; bottom: number; right: number; height: number }): Side => {
    const w = pop.current!.offsetWidth, h = pop.current!.offsetHeight;
    if (r.right + GAP + w < innerWidth - M && r.height > innerHeight * 0.45) return "right";
    if (r.bottom + GAP + h <= innerHeight - M) return "below";
    if (r.top - GAP - h >= TOPBAR + M) return "above";
    return "inside";
  };
  const setSide = () => {
    const el = target();
    if (!el) return;
    const now = el.getBoundingClientRect(), shift = scrollY - live.current.finalY;
    live.current.side = sideFor({ top: now.top + shift, bottom: now.bottom + shift, right: now.right, height: now.height });
  };

  useEffect(() => {
    if (!on) return;
    const found = STEPS.filter(s => (document.querySelector(s.sel) as HTMLElement | null)?.offsetParent);
    if (!found.length) { setTouring(false); return; }
    setSteps(found); setI(0); setShown(0); // eslint-disable-line react-hooks/set-state-in-effect -- the steps depend on what's on screen
    requestAnimationFrame(() => setOpen(true));
  }, [on, setTouring]);

  // move to step i: scroll just far enough to leave room for the card above the target, then crossfade the text
  useEffect(() => {
    if (!on || !steps.length || !pop.current) return;
    live.current.step = i;
    const el = target();
    if (!el) return;
    const r = el.getBoundingClientRect();
    live.current.finalY = scrollY;
    const visible = r.top >= TOPBAR + M && r.bottom <= innerHeight - 16;
    if (!el.closest(".topbar") && !(visible && sideFor(r) !== "inside")) {
      const room = TOPBAR + M + pop.current.offsetHeight + GAP + 24;
      live.current.finalY = Math.min(document.documentElement.scrollHeight - innerHeight, Math.max(0, scrollY + r.top - room));
      scrollTo({ top: live.current.finalY, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    }
    setSide();
    const t = setTimeout(() => { setShown(i); requestAnimationFrame(setSide); }, 150);
    return () => clearTimeout(t);
  }, [i, on, steps]); // eslint-disable-line react-hooks/exhaustive-deps -- helpers read refs

  // every frame, ease the spotlight and card toward their goal, so they follow scrolling smoothly
  useEffect(() => {
    if (!on || !steps.length) return;
    const L = live.current;
    const first = target()?.getBoundingClientRect();
    if (first) L.spot = { x: first.left - 30, y: first.top - 30, w: first.width + 60, h: first.height + 60 };
    L.last = 0;
    let raf = 0;
    const frame = (now: number) => {
      const el = target(), p = pop.current, s = spot.current, c = caret.current;
      if (el && p && s && c) {
        const r = el.getBoundingClientRect(), w = p.offsetWidth, h = p.offsetHeight;
        const align = steps[L.step]?.align ?? "start";
        const anchor = align === "center" ? r.left + r.width / 2 : align === "end" ? r.right - 40 : r.left + 40;
        const ideal = align === "center" ? anchor - w / 2 : align === "end" ? r.right - w : r.left;
        let top = r.bottom + GAP, left = Math.min(Math.max(M, ideal), innerWidth - w - M);
        if (L.side === "above") top = r.top - GAP - h;
        if (L.side === "inside") { top = Math.min(r.bottom - h - 16, innerHeight - h - M); left = Math.min(r.right - w - 16, innerWidth - w - M); }
        if (L.side === "right") { left = r.right + GAP; top = Math.min(Math.max(M, r.top), innerHeight - h - M); }
        const goal = { spot: { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 }, pop: { x: Math.max(M, left), y: Math.min(Math.max(M, top), innerHeight - h - M) } };
        const dt = Math.min(64, L.last ? now - L.last : 16);
        L.last = now;
        const k = matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 1 - Math.exp(-dt / 80);
        (Object.keys(goal.spot) as (keyof typeof L.spot)[]).forEach(key => { L.spot[key] += (goal.spot[key] - L.spot[key]) * k; });
        L.pop.x += (goal.pop.x - L.pop.x) * k;
        L.pop.y += (goal.pop.y - L.pop.y) * k;
        s.style.transform = `translate3d(${L.spot.x}px, ${L.spot.y}px, 0)`;
        s.style.width = `${L.spot.w}px`;
        s.style.height = `${L.spot.h}px`;
        p.style.transform = `translate3d(${L.pop.x}px, ${L.pop.y}px, 0)`;
        p.dataset.side = L.side;
        if (L.side === "right") { c.style.left = "0px"; c.style.top = `${Math.min(Math.max(18, r.top + Math.min(r.height, innerHeight) / 2 - L.pop.y), h - 18)}px`; }
        else { c.style.top = L.side === "above" ? "100%" : "0px"; c.style.left = `${Math.min(Math.max(22, anchor - L.pop.x), w - 22)}px`; }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [on, steps]); // eslint-disable-line react-hooks/exhaustive-deps -- reads refs every frame

  useEffect(() => {
    if (!on) return;
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") end();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    addEventListener("keydown", keys);
    return () => removeEventListener("keydown", keys);
  }, [on, go, end]);

  if (!on || !steps.length) return null;
  const step = steps[shown];
  return (
    <div className={`tour ${open ? "open" : ""}`}>
      <div className="tour-layer" />
      <div className="tour-spot" ref={spot} />
      <div className="tour-pop" ref={pop} role="dialog" aria-labelledby="tour-title" aria-live="polite">
        <span className="tour-caret" ref={caret} aria-hidden="true" />
        <div className={`tour-body ${shown !== i ? "swap" : ""}`}>
          <div className="tour-step">Step {shown + 1} of {steps.length}</div>
          <h3 id="tour-title">{step.title}</h3>
          <p>{step.text}</p>
        </div>
        <div className="tour-actions">
          <button className="tour-skip" onClick={end}>Skip tour</button>
          <div className="tour-btns">
            <button className="btn ghost" disabled={i === 0} onClick={() => go(-1)}>Back</button>
            <button className="btn" autoFocus onClick={() => go(1)}>{i === steps.length - 1 ? "Finish" : "Next"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
