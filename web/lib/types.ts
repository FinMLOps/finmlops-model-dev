export type Label = "positive" | "neutral" | "negative";

export type Counts = { articles: number; positive: number; neutral: number; negative: number; net: number };

export type Article = {
  id: string; ticker: string; title: string; summary: string;
  publisher: string; url: string; published: string; pred: Label; confidence: number;
};

export type Day = Counts & { date: string; close: number | null; top_positive: Article | null; top_negative: Article | null };

export type Ticker = { ticker: string; name: string; week: Counts; prev: Counts; daily: Day[]; latest_at: string };

export type Overview = { as_of: string; scored_by: string; tickers: Ticker[] };

export type Model = {
  version: number; run: string; created: number; champion: boolean;
  f1_macro: number | null; accuracy: number | null; per_ticker: Record<string, number | null>;
};
