"use client";
import { useEffect } from "react";
import { useApp } from "@/components/AppProvider";

// Ctrl/⌘ K and / open the palette; ← → and Esc work the detail drawer; text and images can't be dragged around
export function Shortcuts() {
  const { palette, setPalette, touring, drawer, closeDrawer, setDrawerIdx } = useApp();
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (!touring) setPalette(!palette);
        return;
      }
      if (palette || touring) return; // the palette and the tour handle their own keys
      if (drawer) {
        if (e.key === "Escape") closeDrawer();
        if (e.key === "ArrowLeft") setDrawerIdx(drawer.idx - 1);
        if (e.key === "ArrowRight") setDrawerIdx(drawer.idx + 1);
        return;
      }
      const typing = ["INPUT", "TEXTAREA"].includes((document.activeElement as HTMLElement)?.tagName);
      if (e.key === "/" && !typing) { e.preventDefault(); setPalette(true); }
    };
    const noDrag = (e: DragEvent) => e.preventDefault();
    addEventListener("keydown", keys);
    addEventListener("dragstart", noDrag);
    return () => { removeEventListener("keydown", keys); removeEventListener("dragstart", noDrag); };
  }, [palette, setPalette, touring, drawer, closeDrawer, setDrawerIdx]);
  return null;
}
