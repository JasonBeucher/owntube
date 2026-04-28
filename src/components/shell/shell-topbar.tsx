"use client";

import type { ReactNode } from "react";
import { BrandLogo } from "@/components/shell/brand-logo";
import { TopbarSearch } from "@/components/shell/topbar-search";

type ShellTopbarProps = {
  onOpenMenu: () => void;
  onLogoClick?: () => void;
  topbarRight: ReactNode;
};

export function ShellTopbar({
  onOpenMenu,
  onLogoClick,
  topbarRight,
}: ShellTopbarProps) {
  return (
    <header className="sticky top-0 z-30 flex shrink-0 items-center gap-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--background)_/_0.88)] px-3 py-3 backdrop-blur-xl backdrop-saturate-150 md:gap-4 md:px-5 dark:bg-[hsl(var(--background)_/_0.78)]">
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))] max-[900px]:inline-flex"
          aria-label="Open menu"
          onClick={onOpenMenu}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <title>Menu</title>
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div className="hidden max-[900px]:block">
          <BrandLogo showText={false} onNavigate={onLogoClick} />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 justify-center px-1 md:px-3">
        <TopbarSearch />
      </div>

      <div className="flex shrink-0 items-center justify-end gap-1">
        {topbarRight}
      </div>
    </header>
  );
}
