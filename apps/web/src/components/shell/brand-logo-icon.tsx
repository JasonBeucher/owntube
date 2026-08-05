import { cn } from "@/lib/utils";

type BrandLogoIconProps = {
  size?: number;
  /** Rounded-square backdrop matching the favicon/PWA mark in public/. */
  tile?: boolean;
  className?: string;
};

/**
 * Official owntube mark: pixel play-chevron + terminal cursor underscore.
 * Ink follows --foreground and the underscore follows --primary so the same
 * mark adapts to every visual theme; static exports live in public/logo-*.svg.
 */
export function BrandLogoIcon({
  size = 36,
  tile = false,
  className,
}: BrandLogoIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", tile && "ot-brand-mark-tile", className)}
      aria-hidden
    >
      <title>owntube</title>
      {tile ? (
        <>
          <rect
            x="1.5"
            y="1.5"
            width="33"
            height="33"
            rx="9.5"
            className="ot-brand-mark-tile-bg fill-[hsl(var(--card))]"
          />
          <rect
            x="1.5"
            y="1.5"
            width="33"
            height="33"
            rx="9.5"
            fill="none"
            className="ot-brand-mark-tile-border stroke-[hsl(var(--surface-border))]"
          />
        </>
      ) : null}
      <g shapeRendering="crispEdges">
        <rect className="ot-brand-pixel-ink" x="8" y="8" width="4" height="4" />
        <rect
          className="ot-brand-pixel-ink"
          x="12"
          y="12"
          width="4"
          height="4"
        />
        <rect
          className="ot-brand-pixel-ink"
          x="16"
          y="16"
          width="4"
          height="4"
        />
        <rect
          className="ot-brand-pixel-ink"
          x="12"
          y="20"
          width="4"
          height="4"
        />
        <rect
          className="ot-brand-pixel-ink"
          x="8"
          y="24"
          width="4"
          height="4"
        />
        <rect
          className="ot-brand-pixel-accent"
          x="22"
          y="26"
          width="8"
          height="2"
        />
      </g>
    </svg>
  );
}
