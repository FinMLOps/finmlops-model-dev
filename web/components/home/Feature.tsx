import Link from "next/link";

type FeatureProps = {
  id?: string; label: string; title: string; text?: string; href: string; cta: string;
  flip?: boolean; side?: React.ReactNode; children: React.ReactNode;
};

// a feature row: headline, one line, a link, and a live demo; flip puts the demo on the left
export function Feature({ id, label, title, text, href, cta, flip, side, children }: FeatureProps) {
  return (
    <section className={`panel feature${flip ? " flip" : ""}`} id={id}>
      <div className="feature-text">
        <span className="label">{label}</span>
        <h2>{title}</h2>
        {text && <p>{text}</p>}
        {side}
        <Link className="feature-link" href={href}>{cta} <span aria-hidden="true">→</span></Link>
      </div>
      <div className="feature-stage">{children}</div>
    </section>
  );
}

// a small app window around a demo
export function Win({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="win">
      <div className="win-bar"><span className="demo-lights" aria-hidden="true"><i /><i /><i /></span><span className="win-title">{title}</span></div>
      {children}
    </div>
  );
}
