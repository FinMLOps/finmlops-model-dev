import { ToolsShell } from "@/components/ToolsShell";

// Dashboard and News get the watchlist sidebar; Analyzer and Models are centered
export default function ToolsLayout({ children }: LayoutProps<"/">) {
  return <ToolsShell>{children}</ToolsShell>;
}
