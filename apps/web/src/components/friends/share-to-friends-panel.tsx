"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/react";

type ShareToFriendsPanelProps = {
  videoId: string;
  videoTitle?: string;
  channelId?: string;
  channelName?: string;
  /** Called after a successful send (e.g. close the popover). */
  onSent?: () => void;
  className?: string;
};

/** Friend picker + optional note; the whole "send a video" interaction. */
export function ShareToFriendsPanel({
  videoId,
  videoTitle,
  channelId,
  channelName,
  onSent,
  className,
}: ShareToFriendsPanelProps) {
  const utils = trpc.useUtils();
  const overviewQuery = trpc.friends.overview.useQuery();
  const sendMutation = trpc.friends.send.useMutation();

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [note, setNote] = useState("");
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const friends = overviewQuery.data?.friends ?? [];

  const toggle = (userId: number) => {
    setSentMessage(null);
    setErrorMessage(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const onSend = async () => {
    if (selected.size === 0) return;
    setErrorMessage(null);
    try {
      const result = await sendMutation.mutateAsync({
        recipientIds: [...selected],
        videoId,
        videoTitle,
        channelId,
        channelName,
        note: note.trim() || undefined,
      });
      setSelected(new Set());
      setNote("");
      setSentMessage(
        result.sent === 1
          ? "Sent to 1 friend."
          : `Sent to ${result.sent} friends.`,
      );
      await utils.friends.outbox.invalidate();
      window.setTimeout(() => {
        setSentMessage(null);
        onSent?.();
      }, 900);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not send the video.",
      );
    }
  };

  return (
    <div className={cn("space-y-3", className)}>
      {overviewQuery.isLoading ? (
        <div className="space-y-2" aria-hidden>
          <div className="h-8 animate-pulse rounded-[var(--radius-shell)] bg-[hsl(var(--muted)_/_0.6)]" />
          <div className="h-8 animate-pulse rounded-[var(--radius-shell)] bg-[hsl(var(--muted)_/_0.6)]" />
        </div>
      ) : overviewQuery.isError ? (
        overviewQuery.error.data?.code === "UNAUTHORIZED" ? (
          <div className="space-y-2 text-sm text-[hsl(var(--muted-foreground))]">
            <p>Sign in to send videos to friends.</p>
            <Button type="button" variant="outline" size="sm" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        ) : (
          <p className="text-sm text-[hsl(var(--destructive))]" role="alert">
            Could not load your friends.
          </p>
        )
      ) : friends.length === 0 ? (
        <div className="space-y-2 text-sm text-[hsl(var(--muted-foreground))]">
          <p>No friends yet. Add people from your instance to share videos.</p>
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href="/friends">Add friends</Link>
          </Button>
        </div>
      ) : (
        <>
          <ul
            className="max-h-48 space-y-1 overflow-y-auto pr-1"
            aria-label="Send to"
          >
            {friends.map((friend) => {
              const checked = selected.has(friend.userId);
              return (
                <li key={friend.userId}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-shell)] border px-2.5 py-2 text-sm transition-colors",
                      checked
                        ? "border-[hsl(var(--primary)_/_0.5)] bg-[hsl(var(--primary)_/_0.1)] text-[hsl(var(--foreground))]"
                        : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted)_/_0.5)]",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="accent-[hsl(var(--primary))]"
                      checked={checked}
                      onChange={() => toggle(friend.userId)}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {friend.label}
                    </span>
                    <span className="ot-mono-data max-w-[10rem] truncate text-xs text-[hsl(var(--muted-foreground))]">
                      {friend.email}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <Input
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
            maxLength={500}
            placeholder="Add a note (optional)"
            aria-label="Note for your friends"
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => void onSend()}
              disabled={selected.size === 0 || sendMutation.isPending}
            >
              {sendMutation.isPending
                ? "Sending…"
                : selected.size > 1
                  ? `Send to ${selected.size} friends`
                  : "Send"}
            </Button>
            {sentMessage ? (
              <output className="block text-sm font-medium text-[hsl(var(--primary))]">
                {sentMessage}
              </output>
            ) : null}
          </div>
        </>
      )}
      {errorMessage ? (
        <p className="text-sm text-[hsl(var(--destructive))]" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
