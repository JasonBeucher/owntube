"use client";

import Link from "next/link";

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
  return (
    <Link
      href="/"
      onClick={onNavigate}
      className={`inline-flex items-center gap-2 rounded-lg outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))] ${className ?? ""}`}
      aria-label="OwnTube home"
    >
      <span className="relative flex shrink-0 overflow-hidden rounded-md">
        {/* biome-ignore lint/performance/noImgElement: static app logo from public */}
        <img
          src="/logo.png?v=6"
          alt=""
          width={36}
          height={36}
          className="h-9 w-9 object-contain"
          aria-hidden
        />
      </span>
      {showText ? (
        <span className="text-lg font-extrabold tracking-tight text-[hsl(var(--foreground))]">
          OwnTube
        </span>
      ) : null}
    </Link>
  );
}
