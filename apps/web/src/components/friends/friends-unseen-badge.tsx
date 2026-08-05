"use client";

import { trpc } from "@/trpc/react";

type FriendsUnseenBadgeProps = {
  enabled: boolean;
};

/** Count pill for videos friends sent that were not opened yet. */
export function FriendsUnseenBadge({ enabled }: FriendsUnseenBadgeProps) {
  const unseenQuery = trpc.friends.unseenCount.useQuery(undefined, {
    enabled,
    refetchInterval: 90_000,
    refetchOnWindowFocus: true,
  });
  const count = unseenQuery.data?.count ?? 0;
  if (!enabled || count === 0) return null;
  return (
    <span className="ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary))] px-1.5 text-[11px] font-bold leading-none text-[hsl(var(--primary-foreground))]">
      {count > 99 ? "99+" : count}
      <span className="sr-only">
        {` new shared video${count > 1 ? "s" : ""}`}
      </span>
    </span>
  );
}
