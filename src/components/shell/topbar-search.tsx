"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export function TopbarSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = useCallback(() => {
    const trimmed = q.trim();
    const url = trimmed
      ? `/search?q=${encodeURIComponent(trimmed)}`
      : "/search";
    router.push(url);
  }, [q, router]);

  return (
    <form
      className={`flex w-full min-w-0 max-w-2xl items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-[border-color,box-shadow,background] sm:px-4 md:gap-2.5 ${
        focus
          ? "border-[hsl(var(--primary)_/_0.5)] bg-[hsl(var(--muted)_/_0.85)] shadow-[0_0_0_4px_hsl(var(--primary)_/_0.08)]"
          : "border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.55)]"
      }`}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="shrink-0 text-[hsl(var(--muted-foreground))]"
        aria-hidden
      >
        <title>Search</title>
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <label htmlFor="ot-topbar-search" className="sr-only">
        Global search
      </label>
      <input
        ref={inputRef}
        id="ot-topbar-search"
        name="q"
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        placeholder="Search videos, channels, topics…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        className="min-w-0 flex-1 bg-transparent text-sm text-[hsl(var(--foreground))] outline-none placeholder:text-[hsl(var(--muted-foreground))]"
      />
      <kbd className="hidden rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-2 py-0.5 font-mono text-[11px] text-[hsl(var(--muted-foreground))] sm:inline-block">
        /
      </kbd>
    </form>
  );
}
