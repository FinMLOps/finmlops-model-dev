import { Stale } from "@/components/Stale";
import { Watchlist } from "@/components/Watchlist";

// Dashboard, News, Analyzer and Models share the watchlist sidebar
export default function ToolsLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Stale />
      <div className="layout">
        <Watchlist />
        <main>{children}</main>
      </div>
    </>
  );
}
