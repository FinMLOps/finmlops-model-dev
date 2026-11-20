"use client";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useOverview } from "@/lib/api";
import type { Article, Overview } from "@/lib/types";

type App = {
  ov?: Overview;
  ovError?: string;
  ticker: string;
  selectTicker: (t: string) => void;
  days: number;
  setDays: (d: number) => void;
  price: boolean;
  setPrice: (p: boolean) => void;
  drawer: { rows: Article[]; idx: number } | null;
  openDrawer: (rows: Article[], idx: number) => void;
  setDrawerIdx: (idx: number) => void;
  closeDrawer: () => void;
  palette: boolean;
  setPalette: (open: boolean) => void;
  touring: boolean;
  setTouring: (on: boolean) => void;
  toast: (msg: string) => void;
  toastMsg: string;
};

const Ctx = createContext<App | null>(null);
export const useApp = () => useContext(Ctx)!;

const read = (key: string) => { try { return localStorage.getItem("finmlops." + key); } catch { return null; } };
const write = (key: string, v: string) => { try { localStorage.setItem("finmlops." + key, v); } catch {} };

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { data: ov, error: ovError } = useOverview();
  const router = useRouter();
  const path = usePathname();
  const [ticker, setTicker] = useState("NVDA");
  const [days, setDays] = useState(30);
  const [price, setPriceState] = useState(true);
  const [drawer, setDrawer] = useState<App["drawer"]>(null);
  const [palette, setPalette] = useState(false);
  const [touring, setTouring] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const returnFocus = useRef<HTMLElement | null>(null);

  // saved preferences and ?ticker= are only known in the browser
  useEffect(() => {
    const fromUrl = new URLSearchParams(location.search).get("ticker");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only values, read once after hydration
    setTicker(fromUrl || read("ticker") || "NVDA");
    setPriceState(read("price") !== "0");
  }, []);

  const selectTicker = useCallback((t: string) => {
    setTicker(t);
    write("ticker", t);
    if (path !== "/dashboard") router.push(`/dashboard?ticker=${t}`);
    else history.replaceState(null, "", `/dashboard?ticker=${t}`);
  }, [path, router]);

  const setPrice = useCallback((p: boolean) => { setPriceState(p); write("price", p ? "1" : "0"); }, []);

  const openDrawer = useCallback((rows: Article[], idx: number) => {
    if (!rows.length) return;
    setDrawer(d => {
      if (!d) returnFocus.current = document.activeElement as HTMLElement;
      return { rows, idx };
    });
  }, []);
  const closeDrawer = useCallback(() => {
    setDrawer(null);
    returnFocus.current?.focus?.({ preventScroll: true });
  }, []);
  const setDrawerIdx = useCallback((idx: number) => setDrawer(d => (d && idx >= 0 && idx < d.rows.length ? { ...d, idx } : d)), []);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), 3500);
  }, []);

  // a ticker that isn't in the data falls back to the first one
  const valid = ov && !ov.tickers.some(t => t.ticker === ticker) ? ov.tickers[0].ticker : ticker;

  const value = useMemo<App>(() => ({
    ov, ovError, ticker: valid, selectTicker, days, setDays, price, setPrice,
    drawer, openDrawer, setDrawerIdx, closeDrawer, palette, setPalette, touring, setTouring, toast, toastMsg,
  }), [ov, ovError, valid, selectTicker, days, price, setPrice, drawer, openDrawer, setDrawerIdx, closeDrawer, palette, touring, toast, toastMsg]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function Toast() {
  const { toastMsg } = useApp();
  return <div className={`toast ${toastMsg ? "show" : ""}`} role="status">{toastMsg}</div>;
}
