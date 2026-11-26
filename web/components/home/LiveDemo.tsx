"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/Logo";
import { cap, signed, tone } from "@/lib/format";
import { Count, usePlayback } from "@/lib/motion";

/* ============ the script: swap people, channels and steps here ============ */

type Tone = "positive" | "neutral" | "negative" | "accent";
type Chip = { text: string; tone: Tone };
// an activity line under a reply: icon, words, then an optional chip, e.g. "☰ Labeled it (● Negative)"
type Act = { icon: string; text: string; chip?: Chip };
// a message: from your side (`me` senders: a headline, with its link) or a reply (plain text, a "worked" line, activity lines)
type Step = { who: string; time?: string; text?: string; url?: string; pill?: Chip; worked?: string; acts?: Act[]; net?: number; reactions?: string[]; wait?: number };
type Channel = { id: string; ticker?: string; icon?: string; about: string; watch: string; time: string; unread: number; net?: number; steps: Step[] };

const CAPTION = "Real headlines. FinBERT's labels and the numbers shown are illustrative for now.";

// avatar is an emoji or a letter. `me` senders post from your side (right); the others reply, and `doing` is what
// their "working" line says while they think
const PEOPLE: Record<string, { name: string; avatar: string; color: string; me?: boolean; doing?: string }> = {
  wsj: { name: "Wall Street Journal", avatar: "W", color: "#4c8dff", me: true },
  cnbc: { name: "CNBC", avatar: "C", color: "#f2a93b", me: true },
  bloomberg: { name: "Bloomberg", avatar: "B", color: "#8a5cff", me: true },
  finbert: { name: "FinBERT", avatar: "🤖", color: "#22b07d", doing: "Reading the headline…" },
  airflow: { name: "Airflow", avatar: "A", color: "#38bdf8", me: true },
  trainer: { name: "Trainer", avatar: "🧪", color: "#8a5cff", me: true },
  rule: { name: "Champion rule", avatar: "⚖️", color: "#f2a93b", doing: "Comparing the challenger with the champion…" },
};

// FinBERT's reply to the headline above it: the label, and how it moved the channel's net sentiment (from -> to).
// Only what the model actually outputs; it doesn't write explanations.
const scored = (label: "positive" | "neutral" | "negative", conf: number, from: number, to: number, secs: string, reactions?: string[]): Step => ({
  who: "finbert", worked: `Read it in ${secs}`, text: `${cap(label)}, ${conf}% confident.`, net: to, reactions,
  acts: [
    { icon: "☰", text: "Labeled it", chip: { text: cap(label), tone: label } },
    { icon: to < from ? "↘" : to > from ? "↗" : "→", text: "Moved net sentiment", chip: { text: `${signed(from, 0)} → ${signed(to, 0)}`, tone: to < from ? "negative" : to > from ? "positive" : "neutral" } },
  ],
});

const CHANNELS: Channel[] = [
  {
    id: "nvda", ticker: "NVDA", about: "NVIDIA headlines, labeled as they land", watch: "Watching · NVDA headlines · live",
    time: "today", unread: 3, net: 14, steps: [
      { who: "wsj", time: "Nov 12", text: "Jensen Huang Has Been Ousted as Nvidia CEO", url: "https://www.wsj.com/business/nvidia-is-preparing-to-oust-nvidia-ceo-jensen-huang-30f421ad" },
      scored("negative", 100, 14, -9, "0.4s", ["😱 5", "📉 17"]),
      { who: "cnbc", time: "Nov 16", text: "Nvidia board is not considering bringing Jensen Huang back as CEO, source tells CNBC", url: "https://www.cnbc.com/2026/11/16/nvidia-ceo-jensen-huang.html" },
      scored("negative", 91, -9, -17, "0.3s"),
      { who: "bloomberg", time: "Nov 23", text: "Nvidia Rehires Huang in Stunning Reversal After Trump Push", url: "https://www.bloomberg.com/news/articles/2026-11-23/nvidia-reinstates-jensen-huang-as-ceo-with-government-input" },
      scored("positive", 84, -17, 6, "0.4s", ["🚀 2", "🤑 99"]),
    ],
  },
  {
    id: "champion", icon: "🏆", about: "A new model only ships if it beats the champion", watch: "Scheduled · Daily training run · 6:00 AM",
    time: "1h", unread: 1, steps: [
      { who: "airflow", time: "6:00", pill: { text: "Schema ✓", tone: "positive" }, text: "Daily run done: 1,284 new headlines, every batch valid" },
      { who: "trainer", time: "6:32", pill: { text: "macro-F1 0.712", tone: "accent" }, text: "Challenger v8 trained with LoRA + Optuna" },
      {
        who: "rule", worked: "Checked in 41s", text: "v8 beats champion v7 on held-out news, and no stock got worse. It ships.", reactions: ["🎉 4", "🚀 2"],
        acts: [
          { icon: "☰", text: "Compared on held-out news", chip: { text: "+0.031 F1", tone: "positive" } },
          { icon: "✓", text: "Checked every stock", chip: { text: "7 / 7", tone: "positive" } },
          { icon: "🏆", text: "Promoted", chip: { text: "v8 · champion", tone: "accent" } },
        ],
      },
    ],
  },
];

const GAP = 500, TYPE = 900, READ = 1300, HOLD = 4000; // ms: pause, typing, FinBERT reading, rest before the next channel

/* ============ playback ============ */

// open channel i from its first message (run changes on every open, so a replay re-animates the same messages)
type State = { active: number; shown: number; typing: boolean; run: number; seen: number[] };
const open = (i: number) => (s: State) => ({ active: i, shown: 0, typing: false, run: s.run + 1, seen: s.seen.includes(i) ? s.seen : [...s.seen, i] });
const preview = (c: Channel) => [...c.steps].reverse().find(s => PEOPLE[s.who].me)?.text;

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
      const s = steps[p.shown], wait = s.wait ?? (PEOPLE[s.who].me ? TYPE : READ);
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
              <p className="demo-watch"><span aria-hidden="true">◷</span>{ch.watch}</p>
              {ch.steps.slice(0, count).map((s, i) => <Message key={`${p.run}-${i}`} s={s} ticker={ch.ticker} />)}
              {next && (next.me
                ? <div className="msg me typing"><div className="me-bubble dots"><i /><i /><i /></div></div>
                : <div className="msg reply typing"><div className="reply-meta"><Avatar who={next} /><span className="working">{next.doing}</span></div></div>)}
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
  if (who.me) return (
    <div className="msg me">
      <div className="me-bubble">
        {ticker && <span className="mention">${ticker}</span>}
        {s.pill && <span className={`pill ${s.pill.tone} msg-pill`}>{s.pill.text}</span>}
        {s.url ? <a className="msg-link" href={s.url} target="_blank" rel="noopener noreferrer" title={`Read on ${who.name}`}>{s.text}<span aria-hidden="true">↗</span></a> : s.text}
      </div>
      <div className="me-meta"><Avatar who={who} />{who.name}{s.time && <> · <time>{s.time}</time></>}</div>
    </div>
  );
  // a reply: no bubble, like an agent writing in the chat, then what it did as activity lines
  return (
    <div className="msg reply">
      <div className="reply-meta"><Avatar who={who} /><b>{who.name}</b>{s.worked && <span className="worked">{s.worked} ›</span>}</div>
      {s.text && <p className="reply-text">{s.text}</p>}
      {s.acts && (
        <ul className="acts">
          {s.acts.map((a, i) => (
            <li key={i} style={{ "--i": i } as React.CSSProperties}>
              <span className="act-ico" aria-hidden="true">{a.icon}</span>{a.text}
              {a.chip && <span className={`chip ${a.chip.tone}`}>{a.chip.text}</span>}
            </li>
          ))}
        </ul>
      )}
      {s.reactions && (
        <div className="msg-reacts">
          {s.reactions.map((r, i) => <span key={r} style={{ animationDelay: `${0.6 + (s.acts?.length ?? 0) * 0.15 + i * 0.12}s` }}>{r}</span>)}
        </div>
      )}
    </div>
  );
}
