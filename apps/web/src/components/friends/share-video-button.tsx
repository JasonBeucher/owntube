"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ShareToFriendsPanel } from "@/components/friends/share-to-friends-panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ShareVideoButtonProps = {
  videoId: string;
  videoTitle?: string;
  channelId?: string;
  channelName?: string;
  isAuthenticated: boolean;
  /** Match the pill styling of the watch-page interaction row. */
  buttonClassName?: string;
};

function SendIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="m22 2-7 20-4-9-9-4z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

/** "Send" pill on the watch page: opens the friend picker in a popover. */
export function ShareVideoButton({
  videoId,
  videoTitle,
  channelId,
  channelName,
  isAuthenticated,
  buttonClassName,
}: ShareVideoButtonProps) {
  const popoverId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        className={cn(
          buttonClassName,
          open
            ? "border-[hsl(var(--primary)_/_0.5)] bg-[hsl(var(--primary)_/_0.12)] text-[hsl(var(--primary))]"
            : "border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] hover:border-[hsl(var(--primary)_/_0.5)] hover:bg-[hsl(var(--primary)_/_0.08)]",
        )}
        disabled={!isAuthenticated}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        title={isAuthenticated ? "Send to a friend" : "Sign in to send videos"}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">
          <SendIcon />
        </span>
        <span>Send</span>
      </Button>
      {open ? (
        <div
          id={popoverId}
          role="dialog"
          aria-label="Send this video to friends"
          className="absolute left-0 top-full z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-[var(--radius-card)] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 shadow-lg"
        >
          <ShareToFriendsPanel
            videoId={videoId}
            videoTitle={videoTitle}
            channelId={channelId}
            channelName={channelName}
            onSent={() => setOpen(false)}
          />
        </div>
      ) : null}
    </div>
  );
}
