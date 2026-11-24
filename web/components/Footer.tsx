import Link from "next/link";

const COLS = [
  { title: "Product", links: [["Dashboard", "/dashboard"], ["News", "/news"], ["Analyzer", "/analyzer"], ["Models", "/models"]] },
  { title: "Project", links: [["How it works", "/#how"], ["Model repo", "https://github.com/FinMLOps/finmlops-model-dev"], ["Data pipeline repo", "https://github.com/FinMLOps/finmlops-data-pipeline"]] },
  { title: "Built on", links: [["FinBERT", "https://huggingface.co/ProsusAI/finbert"], ["Finnhub", "https://finnhub.io"], ["Marketaux", "https://www.marketaux.com"]] },
];

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-cols">
        <div className="footer-brand"><b>FinMLOps</b><span>Financial news, read by a language model.</span></div>
        {COLS.map(c => (
          <div key={c.title}>
            <span className="label">{c.title}</span>
            {c.links.map(([text, href]) => href.startsWith("http")
              ? <a key={href} href={href} target="_blank" rel="noopener noreferrer">{text} <span aria-hidden="true">↗</span></a>
              : <Link key={href} href={href}>{text}</Link>)}
          </div>
        ))}
      </div>
      <div className="footer-base">
        <span>FinMLOps © 2026 · a student proof of concept</span>
        <span>Sentiment is model output, not investment advice</span>
      </div>
    </footer>
  );
}
