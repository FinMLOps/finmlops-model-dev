import Link from "next/link";
import { AnalyzerDemo } from "@/components/home/AnalyzerDemo";
import { DashboardDemo } from "@/components/home/DashboardDemo";
import { Feature } from "@/components/home/Feature";
import { HowItWorks } from "@/components/home/HowItWorks";
import { JustScored } from "@/components/home/JustScored";
import { LiveDemo } from "@/components/home/LiveDemo";
import { Mood } from "@/components/home/Mood";

const NYT = "https://www.nytimes.com/2026/07/16/business/energy-environment/trump-truth-social-api-access.html";

export default function Home() {
  return (
    <main className="layout home-layout">
      <section className="home">
        <div className="hero">
          <h1>FinMLOps reads the financial news and turns it into one clear signal per stock.</h1>
          <div className="hero-cta">
            <Link className="btn-pill inv" href="/dashboard">Open the dashboard <span aria-hidden="true">→</span></Link>
            <Link className="btn-pill" href="/analyzer">Try the analyzer <span aria-hidden="true">→</span></Link>
          </div>
        </div>

        <LiveDemo />
        <Mood />

        <div className="features">
          <Feature label="Analyzer" title="Paste a headline. See why." href="/analyzer" cta="Try the analyzer"
            text="The model labels any headline you give it and shows which words pushed it toward positive or negative.">
            <AnalyzerDemo />
          </Feature>
          <Feature flip label="Dashboard" title="Sentiment, next to the price." href="/dashboard" cta="Open the dashboard"
            text="Every stock's daily net sentiment against its closing price, plus a two-week pulse of the whole market.">
            <DashboardDemo />
          </Feature>
          <HowItWorks />
        </div>

        <JustScored />

        <div className="panel home-card why">
          <div>
            <span className="label">Why we built this</span>
            <h2>Whoever reads the news first gets the edge.</h2>
            <p>This project started with a New York Times story about access to Truth Social&apos;s API. Early access to market-moving news lets a few players place winning bets before everyone else has even seen the headline.</p>
            <p>We&apos;re students, and we don&apos;t have $100K lying around for that kind of access. So we built what we could: a pipeline that collects free market news, a model that reads every headline, and a dashboard that turns them into a clear signal for each stock.</p>
          </div>
          <div className="why-side">
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
        </div>

        <div className="cta-band">
          <div>
            <h2>Have a headline in mind?</h2>
            <p>Paste it into the analyzer and see how the model reads it, word by word.</p>
          </div>
          <div className="cta-actions">
            <Link className="btn-pill inv" href="/analyzer">Try the analyzer <span aria-hidden="true">→</span></Link>
            <Link className="btn-pill" href="/news">Browse the news</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
