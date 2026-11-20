"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { useApi } from "@/lib/api";
import { f3 } from "@/lib/format";
import type { Model } from "@/lib/types";

const TABS = [["/", "Home"], ["/dashboard", "Dashboard"], ["/news", "News"], ["/analyzer", "Analyzer"], ["/models", "Models"]];

export function toggleTheme(x?: number, y?: number) {
  const root = document.documentElement;
  const apply = () => {
    const next = root.dataset.theme === "light" ? "dark" : "light";
    root.dataset.theme = next;
    try { localStorage.setItem("finmlops.theme", next); } catch {}
    window.dispatchEvent(new Event("themechange")); // charts redraw in the new palette
  };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!document.startViewTransition || reduced || x == null || y == null) return apply();
  root.style.setProperty("--vt-x", `${x}px`);
  root.style.setProperty("--vt-y", `${y}px`);
  root.style.setProperty("--vt-r", `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))}px`);
  document.startViewTransition(apply);
}

export function Topbar() {
  const path = usePathname();
  const router = useRouter();
  const { setPalette, setTouring } = useApp();
  const [modK, setModK] = useState("Ctrl K");
  useEffect(() => { if (/Mac|iPhone|iPad/.test(navigator.platform)) setModK("⌘K"); }, []); // eslint-disable-line react-hooks/set-state-in-effect -- browser-only
  const nav = useRef<HTMLElement>(null);
  const [ink, setInk] = useState({ left: 0, width: 0 });
  const { data: models, error } = useApi<Model[]>("/api/models");
  const champ = models?.find(m => m.champion);

  // slide the underline under the active tab
  useEffect(() => {
    const move = () => {
      const a = nav.current?.querySelector<HTMLElement>("a.active");
      if (a) setInk({ left: a.offsetLeft, width: a.offsetWidth });
    };
    move();
    document.fonts?.ready.then(move);
    addEventListener("resize", move);
    return () => removeEventListener("resize", move);
  }, [path]);

  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <header className="topbar">
      <Link href="/" className="brand" title="Home">
        <img className="mark brand-logo" src="/img/android-chrome-192x192.png" alt="" width={30} height={30} />
        FinMLOps
      </Link>
      <nav className="tabs" ref={nav}>
        {TABS.map(([href, label]) => (
          <Link key={href} href={href} className={active(href) ? "active" : ""}>{label}</Link>
        ))}
        <span className="tab-ink" style={{ width: ink.width, transform: `translateX(${ink.left}px)` }} />
      </nav>
      <button className="omnibox" type="button" aria-label="Open the command palette" onClick={() => setPalette(true)}>
        <svg className="omni-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        <span className="omni-text">Search tickers, headlines, actions…</span>
        <kbd>{modK}</kbd>
      </button>
      <button className="icon-btn theme-btn" type="button" title="Switch theme" aria-label="Switch theme"
        onClick={e => toggleTheme(e.clientX, e.clientY)}>
        <svg className="ico-sun" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        <svg className="ico-moon" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 9.8A5.5 5.5 0 0 1 6.2 2.5a5.5 5.5 0 1 0 7.3 7.3z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
      </button>
      <button className="icon-btn tour-btn" type="button" title="Take the tour" aria-label="Take the tour"
        onClick={() => { if (path !== "/dashboard") router.push("/dashboard"); setTimeout(() => setTouring(true), path === "/dashboard" ? 0 : 400); }}>?</button>
      <div className={`status ${champ ? "live" : ""}`}>
        <span className="dot" />
        {champ ? <>Champion <b>v{champ.version}</b> · Macro F1 <b className="num">{f3(champ.f1_macro)}</b></>
          : error ? "Registry unavailable" : models ? "No champion yet" : "Connecting…"}
      </div>
    </header>
  );
}
