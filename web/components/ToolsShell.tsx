"use client";
import { usePathname } from "next/navigation";
import { Watchlist } from "@/components/Watchlist";

// the watchlist is for browsing stocks, so only Dashboard and News get it; Analyzer and Models are centered like the homepage
export function ToolsShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const side = path.startsWith("/dashboard") || path.startsWith("/news");
  return (
    <div className={`layout${side ? "" : " narrow"}`}>
      {side && <Watchlist />}
      <main>{children}</main>
    </div>
  );
}
