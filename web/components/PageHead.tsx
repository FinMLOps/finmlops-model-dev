// a page's title in the homepage's voice: label, one calm sentence, one line under it
export function PageHead({ label, title, text }: { label: string; title: string; text?: string }) {
  return (
    <header className="page-head">
      <span className="label">{label}</span>
      <h1>{title}</h1>
      {text && <p>{text}</p>}
    </header>
  );
}
