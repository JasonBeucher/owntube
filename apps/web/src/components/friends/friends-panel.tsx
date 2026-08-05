"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VideoThumbnailImg } from "@/components/videos/video-thumbnail-img";
import { cn } from "@/lib/utils";
import { formatPublishedLabel } from "@/lib/video-display";
import { trpc } from "@/trpc/react";

function relativeTime(unixSeconds: number): string {
  return formatPublishedLabel(undefined, unixSeconds) ?? "";
}

function AddFriendForm() {
  const utils = trpc.useUtils();
  const sendRequestMutation = trpc.friends.sendRequest.useMutation();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = email.trim();
    if (!value) return;
    setMessage(null);
    setError(null);
    try {
      const result = await sendRequestMutation.mutateAsync({ email: value });
      setEmail("");
      if (result.outcome === "accepted") {
        setMessage("You're now friends — they had already added you.");
      } else if (result.outcome === "already-friends") {
        setMessage("You're already friends.");
      } else {
        setMessage(
          "Request sent. If that address has an account here, they'll see it.",
        );
      }
      await utils.friends.overview.invalidate();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not send the request.",
      );
    }
  };

  return (
    <section className="ot-surface-card space-y-3 p-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Add a friend</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Enter the email they use on this instance. Nothing leaves your server.
        </p>
      </div>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => void onSubmit(e)}
      >
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          placeholder="friend@example.com"
          aria-label="Friend's email"
          required
          className="sm:max-w-sm"
        />
        <Button
          type="submit"
          disabled={sendRequestMutation.isPending || !email.trim()}
        >
          {sendRequestMutation.isPending ? "Sending…" : "Send request"}
        </Button>
      </form>
      {message ? (
        <output className="block text-sm text-[hsl(var(--primary))]">
          {message}
        </output>
      ) : null}
      {error ? (
        <p className="text-sm text-[hsl(var(--destructive))]" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function RequestsSection() {
  const utils = trpc.useUtils();
  const overviewQuery = trpc.friends.overview.useQuery();
  const respondMutation = trpc.friends.respond.useMutation({
    onSuccess: () => utils.friends.overview.invalidate(),
  });
  const cancelMutation = trpc.friends.cancelRequest.useMutation({
    onSuccess: () => utils.friends.overview.invalidate(),
  });

  const incoming = overviewQuery.data?.incoming ?? [];
  const outgoing = overviewQuery.data?.outgoing ?? [];
  if (incoming.length === 0 && outgoing.length === 0) return null;

  const pending = respondMutation.isPending || cancelMutation.isPending;

  return (
    <section className="ot-surface-card space-y-4 p-5">
      <h2 className="text-lg font-semibold tracking-tight">Requests</h2>
      {incoming.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            Incoming
          </p>
          <ul className="space-y-2">
            {incoming.map((request) => (
              <li
                key={request.requestId}
                className="flex flex-wrap items-center gap-2 rounded-[var(--radius-shell)] border border-[hsl(var(--border))] px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {request.label}
                  </p>
                  <p className="ot-mono-data truncate text-xs text-[hsl(var(--muted-foreground))]">
                    {request.email} · {relativeTime(request.requestedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      respondMutation.mutate({
                        requestId: request.requestId,
                        accept: true,
                      })
                    }
                  >
                    Accept
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      respondMutation.mutate({
                        requestId: request.requestId,
                        accept: false,
                      })
                    }
                  >
                    Decline
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {outgoing.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            Sent by you
          </p>
          <ul className="space-y-2">
            {outgoing.map((request) => (
              <li
                key={request.requestId}
                className="flex flex-wrap items-center gap-2 rounded-[var(--radius-shell)] border border-[hsl(var(--border))] px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {request.label}
                  </p>
                  <p className="ot-mono-data truncate text-xs text-[hsl(var(--muted-foreground))]">
                    {request.email} · {relativeTime(request.requestedAt)}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    cancelMutation.mutate({ requestId: request.requestId })
                  }
                >
                  Cancel
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function InboxSection() {
  const utils = trpc.useUtils();
  const inboxQuery = trpc.friends.inbox.useQuery({ limit: 100 });
  const markSeenMutation = trpc.friends.markSeen.useMutation({
    onSuccess: () =>
      Promise.all([
        utils.friends.inbox.invalidate(),
        utils.friends.unseenCount.invalidate(),
      ]),
  });
  const markAllSeenMutation = trpc.friends.markAllSeen.useMutation({
    onSuccess: () =>
      Promise.all([
        utils.friends.inbox.invalidate(),
        utils.friends.unseenCount.invalidate(),
      ]),
  });
  const dismissMutation = trpc.friends.dismiss.useMutation({
    onSuccess: () =>
      Promise.all([
        utils.friends.inbox.invalidate(),
        utils.friends.unseenCount.invalidate(),
      ]),
  });

  const shares = inboxQuery.data?.shares ?? [];
  const unseen = shares.filter((s) => !s.seen).length;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">
          Shared with you
          {unseen > 0 ? (
            <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[hsl(var(--primary))] px-1.5 align-middle text-[11px] font-bold text-[hsl(var(--primary-foreground))]">
              {unseen}
            </span>
          ) : null}
        </h2>
        {unseen > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={markAllSeenMutation.isPending}
            onClick={() => markAllSeenMutation.mutate()}
          >
            Mark all seen
          </Button>
        ) : null}
      </div>

      {inboxQuery.isLoading ? (
        <div className="space-y-3" aria-hidden>
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-[var(--radius-card)] bg-[hsl(var(--muted)_/_0.5)]"
            />
          ))}
        </div>
      ) : inboxQuery.isError ? (
        <p className="text-sm text-[hsl(var(--destructive))]" role="alert">
          Could not load your inbox.
        </p>
      ) : shares.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
          Nothing here yet. Videos friends send you will show up in this inbox.
        </p>
      ) : (
        <ul className="space-y-3">
          {shares.map((share) => (
            <li
              key={share.id}
              className={cn(
                "ot-surface-card p-3 transition-colors",
                !share.seen && "border-[hsl(var(--primary)_/_0.45)]",
              )}
            >
              <div className="flex items-start gap-3">
                <Link
                  href={`/watch/${encodeURIComponent(share.videoId)}`}
                  className="relative block shrink-0"
                  onClick={() => {
                    if (!share.seen) {
                      markSeenMutation.mutate({ shareId: share.id });
                    }
                  }}
                >
                  <div className="relative aspect-video w-36 overflow-hidden rounded-[var(--radius-shell)] bg-[hsl(var(--muted))] sm:w-44">
                    <VideoThumbnailImg
                      videoId={share.videoId}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </div>
                  {!share.seen ? (
                    <>
                      <span
                        className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-[hsl(var(--primary))]"
                        aria-hidden
                      />
                      <span className="sr-only">Not opened yet</span>
                    </>
                  ) : null}
                </Link>
                <div className="min-w-0 flex-1 space-y-1">
                  <Link
                    href={`/watch/${encodeURIComponent(share.videoId)}`}
                    className="line-clamp-2 text-sm font-semibold hover:underline"
                    onClick={() => {
                      if (!share.seen) {
                        markSeenMutation.mutate({ shareId: share.id });
                      }
                    }}
                  >
                    {share.videoTitle ?? share.videoId}
                  </Link>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    From{" "}
                    <span className="font-medium text-[hsl(var(--foreground))]">
                      {share.senderLabel}
                    </span>
                    {share.channelName ? <> · {share.channelName}</> : null} ·{" "}
                    {relativeTime(share.createdAt)}
                  </p>
                  {share.note ? (
                    <p className="rounded-[var(--radius-shell)] bg-[hsl(var(--muted)_/_0.5)] px-2.5 py-1.5 text-sm text-[hsl(var(--foreground))]">
                      “{share.note}”
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-[hsl(var(--muted-foreground))]"
                  disabled={dismissMutation.isPending}
                  onClick={() => dismissMutation.mutate({ shareId: share.id })}
                  aria-label={`Dismiss ${share.videoTitle ?? "share"}`}
                >
                  Dismiss
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FriendsListSection() {
  const utils = trpc.useUtils();
  const overviewQuery = trpc.friends.overview.useQuery();
  const removeMutation = trpc.friends.removeFriend.useMutation({
    onSuccess: () => utils.friends.overview.invalidate(),
  });
  const [confirmingUserId, setConfirmingUserId] = useState<number | null>(null);

  const friends = overviewQuery.data?.friends ?? [];

  return (
    <section className="ot-surface-card space-y-3 p-5">
      <h2 className="text-lg font-semibold tracking-tight">
        Your friends{friends.length > 0 ? ` (${friends.length})` : ""}
      </h2>
      {overviewQuery.isLoading ? (
        <div className="h-10 animate-pulse rounded-[var(--radius-shell)] bg-[hsl(var(--muted)_/_0.5)]" />
      ) : friends.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          No friends yet. Send a request with their email above.
        </p>
      ) : (
        <ul className="space-y-2">
          {friends.map((friend) => {
            const confirming = confirmingUserId === friend.userId;
            return (
              <li
                key={friend.userId}
                className="flex flex-wrap items-center gap-2 rounded-[var(--radius-shell)] border border-[hsl(var(--border))] px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{friend.label}</p>
                  <p className="ot-mono-data truncate text-xs text-[hsl(var(--muted-foreground))]">
                    {friend.email} · friends {relativeTime(friend.since)}
                  </p>
                </div>
                {confirming ? (
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-[hsl(var(--destructive))]"
                      disabled={removeMutation.isPending}
                      onClick={() => {
                        removeMutation.mutate({ userId: friend.userId });
                        setConfirmingUserId(null);
                      }}
                    >
                      Confirm removal
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmingUserId(null)}
                    >
                      Keep
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="shrink-0 text-[hsl(var(--muted-foreground))]"
                    onClick={() => setConfirmingUserId(friend.userId)}
                  >
                    Remove
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function SentSection() {
  const outboxQuery = trpc.friends.outbox.useQuery({ limit: 15 });
  const shares = outboxQuery.data?.shares ?? [];
  if (outboxQuery.isLoading || shares.length === 0) return null;

  return (
    <section className="ot-surface-card space-y-3 p-5">
      <h2 className="text-lg font-semibold tracking-tight">Recently sent</h2>
      <ul className="space-y-1.5">
        {shares.map((share) => (
          <li
            key={share.id}
            className="flex flex-wrap items-center gap-x-2 text-sm"
          >
            <Link
              href={`/watch/${encodeURIComponent(share.videoId)}`}
              className="min-w-0 max-w-full truncate font-medium hover:underline"
            >
              {share.videoTitle ?? share.videoId}
            </Link>
            <span className="text-xs text-[hsl(var(--muted-foreground))]">
              to {share.recipientLabel} · {relativeTime(share.createdAt)} ·{" "}
              {share.seen ? "opened" : "not opened yet"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FriendsPanel() {
  return (
    <div className="space-y-6">
      <InboxSection />
      <AddFriendForm />
      <RequestsSection />
      <FriendsListSection />
      <SentSection />
    </div>
  );
}
