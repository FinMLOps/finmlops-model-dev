import Link from "next/link";
import { HeroStrip } from "@/components/HeroStrip";

const NYT = "https://www.nytimes.com/2026/07/16/business/energy-environment/trump-truth-social-api-access.html";

const TOOLS = [
  { href: "/dashboard", title: "Dashboard", text: "Sentiment vs. price for each stock, plus the market pulse.", icon: <path d="M2 13.5h12M3.5 11l3-3.5 2.5 2 4-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /> },
  { href: "/news", title: "News", text: "Every scored headline, filterable by stock and label.", icon: <path d="M3 4h10M3 8h10M3 12h6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /> },
  { href: "/analyzer", title: "Analyzer", text: "Paste any headline and see what the model thinks, and why.", icon: <path d="M8 2l1.4 3.6L13 7l-3.6 1.4L8 12l-1.4-3.6L3 7l3.6-1.4z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /> },
  { href: "/models", title: "Models", text: "The champion, the candidates, and the rule they must pass.", icon: <path d="M8 2l5 3v6l-5 3-5-3V5z M3 5l5 3 5-3 M8 8v6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /> },
];

export default function Home() {
  return (
    <main className="layout home-layout">
      <section className="home">
        <div className="hero">
          <div className="hero-orb" aria-hidden="true" />
          <span className="eyebrow"><span className="eyebrow-emoji" aria-hidden="true">📈</span>Reading the market&apos;s mood</span>
          <h1>Markets move on words.<br /><span className="grad">We read them for you.</span></h1>
          <p className="lede">A language model reads the financial news, labels every headline positive, neutral or negative, and turns thousands of them into one signal per stock. This prototype tracks seven tech stocks to keep things simple.</p>
          <div className="hero-cta">
            <Link className="btn btn-lg" href="/dashboard">Open the dashboard <span aria-hidden="true">→</span></Link>
            <a className="btn ghost btn-lg" href="#how">How it works</a>
          </div>
          <HeroStrip />
          <div className="hero-facts">
            <a className="powered" href="https://huggingface.co/ProsusAI/finbert" target="_blank" rel="noopener">Powered by <b>FinBERT</b> <span aria-hidden="true">↗</span></a>
          </div>
        </div>

        <div className="home-grid">
          <div className="panel home-card why">
            <span className="label">Why we built this</span>
            <h2>Whoever reads the news first gets the edge.</h2>
            <p>This project started with a New York Times story about access to Truth Social&apos;s API. Early access to market-moving news lets a few players place winning bets before everyone else has even seen the headline.</p>
            <p>We&apos;re students, and we don&apos;t have $100K lying around for that kind of access. So we built what we could: a pipeline that collects free market news, a model that reads every headline, and a dashboard that turns them into a clear signal for each stock.</p>
            <div className="poc">
              <b>A proof of concept, not a trading tool.</b>
              We use free news APIs, so headlines arrive hours late rather than in real time. With a paid, real-time feed, the same pipeline could score news the moment it breaks. FinBERT is just our starting model; stronger models can be dropped in through the same promotion rule.
            </div>
            <a className="source" href={NYT} target="_blank" rel="noopener">
              <span className="source-k">The story that started it</span>
              <span className="source-t">The New York Times · July 16, 2026</span>
              <span className="source-go" aria-hidden="true">↗</span>
            </a>
          </div>

          <div className="panel home-card how" id="how">
            <span className="label">How it works</span>
            <ol className="steps">
              <li><b>Collect.</b> Airflow pulls news from the free Finnhub and Marketaux APIs, checks every batch against a schema, and versions each snapshot with DVC.</li>
              <li><b>Read.</b> A language model, FinBERT for now, labels each headline for its company, with a confidence score and the words that drove it.</li>
              <li><b>Prove.</b> A new model replaces the champion only if it&apos;s significantly better on held-out news and no stock gets worse.</li>
              <li><b>Show.</b> This dashboard: daily sentiment against the price, a two-week market pulse, and the reasoning behind every label.</li>
            </ol>
          </div>
        </div>

        <div className="explore">
          {TOOLS.map(t => (
            <Link key={t.href} className="panel tool" href={t.href}>
              <span className="tool-ico" aria-hidden="true"><svg viewBox="0 0 16 16">{t.icon}</svg></span>
              <b>{t.title}</b><span>{t.text}</span><i>→</i>
            </Link>
          ))}
        </div>

        <div className="cta-band">
          <div>
            <h2>Have a headline in mind?</h2>
            <p>Paste it into the analyzer and see how the model reads it, word by word.</p>
          </div>
          <div className="cta-actions">
            <Link className="btn btn-lg" href="/analyzer">Try the analyzer <span aria-hidden="true">→</span></Link>
            <Link className="btn ghost btn-lg" href="/news">Browse the news</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
