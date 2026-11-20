"use client";
import { useEffect, useState } from "react";
import type { Overview } from "./types";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // FastAPI validation errors come as a list
    const detail = Array.isArray(body.detail) ? body.detail.map((d: { msg: string }) => d.msg).join("; ") : body.detail;
    throw new Error(detail || `${res.status} ${res.statusText}`);
  }
  return body as T;
}

// one request per path for the whole app, shared by every component that asks for it
const cache = new Map<string, Promise<unknown>>();

export function useApi<T>(path: string | null) {
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  useEffect(() => {
    if (!path) return;
    let live = true;
    if (!cache.has(path)) cache.set(path, api<T>(path).catch(e => { cache.delete(path); throw e; }));
    (cache.get(path) as Promise<T>).then(
      data => live && setState({ data }),
      e => live && setState({ error: e.message }),
    );
    return () => { live = false; };
  }, [path]);
  return state;
}

export const useOverview = () => useApi<Overview>("/api/overview");
