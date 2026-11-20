/* eslint-disable @next/next/no-img-element -- tiny SVG logos; next/image adds nothing here */
// company logo on a light tile (public/logos/<ticker>.svg)
export function Logo({ ticker, size = "" }: { ticker: string; size?: "" | "lg" }) {
  return (
    <span className={`logo ${size}`}>
      <img src={`/logos/${ticker.toLowerCase()}.svg`} alt="" />
    </span>
  );
}
