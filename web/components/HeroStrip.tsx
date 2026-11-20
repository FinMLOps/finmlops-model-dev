"use client";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { useOverview } from "@/lib/api";
import { signed, TICKERS, tone, weekMove } from "@/lib/format";

// the chips (logo and ticker) render right away; only each one's price and 1-week change wait for the data
export function HeroStrip() {
  const { data } = useOverview();
  return (
    <div className="hero-strip" aria-label="Closing price and its change over the last week">
      {TICKERS.map(ticker => {
        const t = data?.tickers.find(x => x.ticker === ticker);
        const m = t && weekMove(t);
        return (
          <Link key={ticker} className="hs" href={`/dashboard?ticker=${ticker}`} title={`${ticker}: last close and 1-week change`}>
            <Logo ticker={ticker} />
            <b>{ticker}</b>
            <span className="hs-quote">
              {!data ? <span className="sk" style={{ width: 110 }} />
                : m ? <><span className="hs-price num">${m.close.toFixed(2)}</span><span className={`hs-chg num ${tone(m.change)}`}>{signed(m.change)}%</span></>
                : <span className="hs-price muted">no price</span>}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
