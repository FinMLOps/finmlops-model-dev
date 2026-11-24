"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/Logo";
import { cap, signed, tone } from "@/lib/format";
import { Count, usePlayback } from "@/lib/motion";

/* ============ the script: swap people, channels and steps here ============ */

type Tone = "positive" | "neutral" | "negative" | "accent";
type Step = { who: string; time?: string; text?: string; url?: string; pill?: { text: string; tone: Tone }; net?: number; reactions?: string[]; wait?: number };
type Channel = { id: string; ticker?: string; icon?: string; about: string; time: string; unread: number; net?: number; steps: Step[] };

const CAPTION = "Real headlines. FinBERT's labels and the numbers shown are illustrative for now.";

// avatar is an emoji or a letter; bots get a "bot" tag and a "reading" typing indicator
const PEOPLE: Record<string, { name: string; avatar: string; color: string; bot?: boolean }> = {
  wsj: { name: "Wall Street Journal", avatar: "W", color: "#4c8dff" },
  cnbc: { name: "CNBC", avatar: "C", color: "#f2a93b" },
  bloomberg: { name: "Bloomberg", avatar: "B", color: "#8a5cff" },
  finbert: { name: "FinBERT", avatar: "🤖", color: "#22b07d", bot: true },
  airflow: { name: "Airflow", avatar: "A", color: "#38bdf8" },
  trainer: { name: "Trainer", avatar: "🧪", color: "#8a5cff" },
  rule: { name: "Champion rule", avatar: "⚖️", color: "#f2a93b" },
};

// FinBERT's reply to the headline above it; net is the channel's net sentiment after this label
const scored = (label: "positive" | "neutral" | "negative", conf: number, net: number, reactions?: string[]): Step =>
  ({ who: "finbert", pill: { text: cap(label), tone: label }, text: `${conf}% confident`, net, reactions });

const CHANNELS: Channel[] = [
  {
    id: "nvda", ticker: "NVDA", about: "NVIDIA headlines, labeled as they land", time: "today", unread: 3, net: 14, steps: [
      { who: "wsj", time: "Nov 12", text: "Jensen Huang Has Been Ousted as Nvidia CEO", url: "https://www.wsj.com/business/nvidia-is-preparing-to-oust-nvidia-ceo-jensen-huang-30f421ad" },
      scored("negative", 100, -9, ["😱 5", "📉 17"]),
      { who: "cnbc", time: "Nov 16", text: "Nvidia board is not considering bringing Jensen Huang back as CEO, source tells CNBC", url: "https://www.cnbc.com/2026/11/16/nvidia-ceo-jensen-huang.html" },
      scored("negative", 91, -17),
      { who: "bloomberg", time: "Nov 23", text: "Nvidia Rehires Huang in Stunning Reversal After Trump Push", url: "https://www.bloomberg.com/news/articles/2026-11-23/nvidia-reinstates-jensen-huang-as-ceo-with-government-input" },
      scored("positive", 84, 6, ["🚀 2", "🤑 99"]),
    ],
  },
  {
    id: "champion", icon: "🏆", about: "A new model only ships if it beats the champion", time: "1h", unread: 1, steps: [
      { who: "airflow", time: "6:00", pill: { text: "Schema ✓", tone: "positive" }, text: "Daily run done: 1,284 new headlines, every batch valid" },
      { who: "trainer", time: "6:32", pill: { text: "macro-F1 0.712", tone: "accent" }, text: "Challenger v8 trained with LoRA + Optuna" },
      { who: "rule", time: "6:41", pill: { text: "+0.031 F1", tone: "positive" }, text: "Significantly better than champion v7 on held-out news" },
      { who: "rule", pill: { text: "7 / 7 ✓", tone: "positive" }, text: "No stock got worse" },
      { who: "rule", time: "6:42", pill: { text: "Promoted 🏆", tone: "accent" }, text: "v8 is the new champion", reactions: ["🎉 4", "🚀 2"] },
    ],
  },
];

const GAP = 500, TYPE = 900, READ = 1300, HOLD = 4000; // ms: pause, typing, FinBERT reading, rest before the next channel

/* ============ playback ============ */

// open channel i from its first message (run changes on every open, so a replay re-animates the same messages)
type State = { active: number; shown: number; typing: boolean; run: number; seen: number[] };
const open = (i: number) => (s: State) => ({ active: i, shown: 0, typing: false, run: s.run + 1, seen: s.seen.includes(i) ? s.seen : [...s.seen, i] });
const preview = (c: Channel) => [...c.steps].reverse().find(s => !PEOPLE[s.who].bot)?.text;

export function LiveDemo() {
  const [p, set] = useState<State>({ active: 0, shown: 0, typing: false, run: 0, seen: [0] });
  const [auto, setAuto] = useState(true); // cycle through channels until the visitor picks one
  const box = useRef<HTMLElement>(null), feed = useRef<HTMLDivElement>(null);
  const { playing, reduced } = usePlayback(box);
  const ch = CHANNELS[p.active];
  const count = reduced ? ch.steps.length : p.shown; // reduced motion: the finished conversation, no playback
  const net = ch.net == null ? null : ch.steps.slice(0, count).reduce((v, s) => s.net ?? v, ch.net);

  // typing indicator, then the next message; after the last one, rest and move on to the next channel
  useEffect(() => {
    if (!playing) return;
    const steps = CHANNELS[p.active].steps;
    if (p.shown < steps.length) {
      const s = steps[p.shown], wait = s.wait ?? (PEOPLE[s.who].bot ? READ : TYPE);
      const a = setTimeout(() => set(q => ({ ...q, typing: true })), GAP);
      const b = setTimeout(() => set(q => ({ ...q, typing: false, shown: q.shown + 1 })), GAP + wait);
      return () => { clearTimeout(a); clearTimeout(b); };
    }
    if (!auto) return;
    const t = setTimeout(() => set(open((p.active + 1) % CHANNELS.length)), HOLD);
    return () => clearTimeout(t);
  }, [playing, auto, p.active, p.shown, p.run]);

  // keep the newest message in view (scrolls the feed only, never the page)
  useEffect(() => {
    const f = feed.current!;
    f.scrollTo({ top: f.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [count, p.typing, p.active, reduced]);

  const next = playing && p.typing ? PEOPLE[ch.steps[p.shown]?.who] : null;
  return (
    <section className="demo" ref={box} aria-label="Animated example: FinBERT labeling headlines">
      <div className="demo-glow" aria-hidden="true" />
      <div className="demo-win">
        <div className="demo-bar">
          <span className="demo-lights" aria-hidden="true"><i /><i /><i /></span>
          <span className="demo-title">FinMLOps · newsroom</span>
          <button className="demo-replay" onClick={() => set(open(p.active))} aria-label="Replay this channel" title="Replay">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v3h3" /></svg>
          </button>
        </div>
        <div className="demo-body">
          <nav className="demo-side" aria-label="Demo channels">
            <span className="demo-side-h label">Channels</span>
            {CHANNELS.map((c, i) => (
              <button key={c.id} className={`demo-chan${i === p.active ? " active" : ""}`} aria-current={i === p.active}
                onClick={() => { setAuto(false); set(open(i)); }}>
                <Icon c={c} />
                <span className="dc-name"># {c.id}</span>
                <span className="dc-time">{c.time}</span>
                <span className="dc-prev">{preview(c)}</span>
                {c.unread > 0 && !p.seen.includes(i) && <span className="dc-unread">{c.unread}</span>}
              </button>
            ))}
          </nav>
          <div className="demo-main">
            <header className="demo-head">
              <Icon c={ch} />
              <div className="dh-title"><b># {ch.id}</b><span>{ch.about}</span></div>
              {net != null && (
                <div className="demo-net">
                  <span className="label">Net sentiment</span>
                  <b className={`num ${tone(net)}`}><Count value={net} fmt={v => signed(Math.round(v), 0)} /></b>
                </div>
              )}
            </header>
            <div className="demo-feed" ref={feed}>
              <p className="demo-intro">This is the start of <b>#{ch.id}</b>. {ch.about}.</p>
              {ch.steps.slice(0, count).map((s, i) => <Message key={`${p.run}-${i}`} s={s} ticker={ch.ticker} />)}
              {next && (
                <div className="msg typing">
                  <Avatar who={next} />
                  <div>
                    <div className="msg-meta"><b>{next.name}</b><span>{next.bot ? "is reading the headline…" : "is typing…"}</span></div>
                    <div className="msg-bubble dots"><i /><i /><i /></div>
                  </div>
                </div>
              )}
            </div>
            <Link className="demo-input" href="/analyzer">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2l1.4 3.6L13 7l-3.6 1.4L8 12l-1.4-3.6L3 7l3.6-1.4z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
              <span>Paste your own headline into the analyzer…</span>
              <kbd>↵</kbd>
            </Link>
          </div>
        </div>
      </div>
      <p className="demo-caption">{CAPTION}</p>
    </section>
  );
}

function Icon({ c }: { c: Channel }) {
  return c.ticker ? <Logo ticker={c.ticker} /> : <span className="logo demo-emoji">{c.icon}</span>;
}

function Avatar({ who }: { who: (typeof PEOPLE)[string] }) {
  return <span className="msg-av" style={{ "--c": who.color } as React.CSSProperties} aria-hidden="true">{who.avatar}</span>;
}

function Message({ s, ticker }: { s: Step; ticker?: string }) {
  const who = PEOPLE[s.who];
  return (
    <div className="msg">
      <Avatar who={who} />
      <div>
        <div className="msg-meta"><b>{who.name}</b>{who.bot && <span className="msg-app">bot</span>}{s.time && <time>{s.time}</time>}</div>
        <div className={`msg-bubble${who.bot ? " bot" : ""}`}>
          {ticker && !who.bot && <span className="mention">${ticker}</span>}
          {s.pill && <span className={`pill ${s.pill.tone} msg-pill`}>{s.pill.text}</span>}
          {s.url ? <a className="msg-link" href={s.url} target="_blank" rel="noopener noreferrer" title={`Read on ${who.name}`}>{s.text}<span aria-hidden="true">↗</span></a> : s.text}
        </div>
        {s.reactions && (
          <div className="msg-reacts">
            {s.reactions.map((r, i) => <span key={r} style={{ animationDelay: `${0.45 + i * 0.12}s` }}>{r}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}
