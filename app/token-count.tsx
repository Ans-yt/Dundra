"use client";

import { useEffect, useState } from "react";

type TokenCounter = typeof import("../lib/tokens").countTextTokens;

export function useTokenCounter() {
  const [counter, setCounter] = useState<TokenCounter | null>(null);
  useEffect(() => {
    let active = true;
    void import("../lib/tokens").then(({ countTextTokens }) => {
      if (active) setCounter(() => countTextTokens);
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  return counter;
}

export function TokenCount({ value, label, title }: { value: number | null; label: string; title?: string }) {
  return <span className="token-count" aria-label={label + ": " + (value === null ? "calculating" : `${value} estimated tokens`)}
    title={title ?? label + " token estimate"}>{value === null ? "…" : `~${value.toLocaleString()}`} tokens</span>;
}
