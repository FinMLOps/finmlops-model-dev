"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";

const LINKS = [["/dashboard", "Dashboard"], ["/news", "News"], ["/analyzer", "Analyzer"], ["/models", "Models"]];

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

// logo on the left, the pages in the exact center, search, theme and one button on the right (a menu on phones)
export function Topbar() {
  const path = usePathname();
  const { setPalette, setTouring } = useApp();
  const [modK, setModK] = useState("Ctrl K");
  const [scrolled, setScrolled] = useState(false); // a hairline border shows once the page scrolls under the bar
  const [menu, setMenu] = useState(false);
  useEffect(() => { if (/Mac|iPhone|iPad/.test(navigator.platform)) setModK("⌘K"); }, []); // eslint-disable-line react-hooks/set-state-in-effect -- browser-only
  useEffect(() => {
    const on = () => setScrolled(scrollY > 4);
    on();
    addEventListener("scroll", on, { passive: true });
    return () => removeEventListener("scroll", on);
  }, []);
  const onDashboard = path.startsWith("/dashboard");
  // the page links: centered in the bar, or in the drop-down sheet on phones
  const links = (cls: string) => (
    <nav className={cls}>
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} className={path.startsWith(href) ? "active" : ""} onClick={() => setMenu(false)}>{label}</Link>
      ))}
    </nav>
  );

  return (
    <header className={`topbar${scrolled || menu ? " scrolled" : ""}`}>
      <Link href="/" className="brand" title="Home">
        <img className="mark brand-logo" src="/img/android-chrome-192x192.png" alt="" width={30} height={30} />
        FinMLOps
      </Link>
      {links("tabs")}
      <div className="nav-right">
        <button className="nav-search" type="button" aria-label="Search tickers, headlines and actions" title="Search" onClick={() => setPalette(true)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          <kbd>{modK}</kbd>
        </button>
        <button className="icon-btn theme-btn" type="button" title="Switch theme" aria-label="Switch theme"
          onClick={e => toggleTheme(e.clientX, e.clientY)}>
          <svg className="ico-sun" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          <svg className="ico-moon" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 9.8A5.5 5.5 0 0 1 6.2 2.5a5.5 5.5 0 1 0 7.3 7.3z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
        </button>
        {/* the tour explains the dashboard, so its button lives there; everywhere else the button opens the dashboard */}
        {onDashboard
          ? <button className="icon-btn tour-btn" type="button" title="Take the tour" aria-label="Take the tour" onClick={() => setTouring(true)}>?</button>
          : <Link className="btn-pill inv sm nav-cta" href="/dashboard">Open dashboard</Link>}
        <button className="icon-btn nav-menu" type="button" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(m => !m)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d={menu ? "M4 4l8 8M12 4l-8 8" : "M2.5 5h11M2.5 11h11"} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      </div>
      {menu && links("nav-sheet")}
    </header>
  );
}
