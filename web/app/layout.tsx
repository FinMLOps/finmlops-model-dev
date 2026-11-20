import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AppProvider, Toast } from "@/components/AppProvider";
import { Drawer } from "@/components/Drawer";
import { Footer } from "@/components/Footer";
import { Palette } from "@/components/Palette";
import { Shortcuts } from "@/components/Shortcuts";
import { Splash } from "@/components/Splash";
import { Topbar } from "@/components/Topbar";
import { Tour } from "@/components/Tour";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: { default: "FinMLOps · Market Sentiment", template: "%s · FinMLOps" },
  description: "A student-built proof of concept that reads financial news and measures sentiment for seven big tech stocks.",
  icons: { icon: "/img/favicon-32x32.png", apple: "/img/apple-touch-icon.png" },
  manifest: "/img/site.webmanifest",
};

// set the saved theme before the first paint, so a light-theme visitor never sees a dark flash
const THEME = `try{document.documentElement.dataset.theme=localStorage.getItem("finmlops.theme")||"dark"}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="dark" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME }} />
      </head>
      <body>
        <AppProvider>
          <Topbar />
          {children}
          <Footer />
          <Drawer />
          <Palette />
          <Tour />
          <Toast />
          <Splash />
          <Shortcuts />
        </AppProvider>
      </body>
    </html>
  );
}
