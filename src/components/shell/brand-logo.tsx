"use client";

import Link from "next/link";
import { useId } from "react";

type BrandLogoProps = {
  showText?: boolean;
  className?: string;
  onNavigate?: () => void;
};

export function BrandLogo({
  showText = true,
  className,
  onNavigate,
}: BrandLogoProps) {
  const gid = useId().replace(/:/g, "");
  return (
    <Link
      href="/"
      onClick={onNavigate}
      className={`inline-flex items-center gap-2 rounded-lg outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))] ${className ?? ""}`}
      aria-label="OwnTube home"
    >
      <span className="relative flex shrink-0 drop-shadow-[0_4px_12px_rgba(255,51,85,0.3)]">
        <svg viewBox="0 0 32 32" width={28} height={28} aria-hidden>
          <title>OwnTube mark</title>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ff3355" />
              <stop offset="100%" stopColor="#ff6633" />
            </linearGradient>
          </defs>
          <rect
            x="2"
            y="6"
            width="28"
            height="20"
            rx="6"
            fill={`url(#${gid})`}
          />
          <path d="M13 12 L22 16 L13 20 Z" fill="hsl(var(--background))" />
        </svg>
      </span>
      {showText ? (
        <span className="text-lg font-extrabold tracking-tight text-[hsl(var(--foreground))]">
          OwnTube
        </span>
      ) : null}
    </Link>
  );
}
