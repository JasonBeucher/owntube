import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { SubscriptionUnfollowButton } from "@/components/subscriptions/subscription-unfollow-button";
import { gradientForChannelId, initialsFromLabel } from "@/lib/channel-avatar";
import { auth } from "@/server/auth";
import { createCaller } from "@/server/trpc/caller";

export default async function SubscriptionChannelsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/subscriptions/channels");
  }
  const caller = await createCaller();
  const channels = await caller.subscriptions.listDetailed();

  return (
    <main className="ot-page space-y-8">
      <PageHeader
        title="Following channels"
        subtitle="All channels from your subscriptions list."
      >
        <Link
          href="/subscriptions"
          className="text-sm font-medium text-[hsl(var(--primary))] underline-offset-4 hover:underline"
        >
          Back to Subscriptions
        </Link>
      </PageHeader>

      {channels.length === 0 ? (
        <p className="rounded-[14px] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
          You are not following any channels yet.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {channels.map((c) => {
            const label = c.channelName || c.channelId;
            return (
              <li key={c.channelId}>
                <div className="group flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 transition hover:border-[hsl(var(--primary)_/_0.35)]">
                  <Link
                    href={`/channel/${encodeURIComponent(c.channelId)}`}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    {c.avatarUrl ? (
                      <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                        {/* biome-ignore lint/performance/noImgElement: remote avatar URL */}
                        <img
                          src={c.avatarUrl}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      </span>
                    ) : (
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                        style={{
                          background: gradientForChannelId(c.channelId),
                        }}
                      >
                        {initialsFromLabel(label)}
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-[hsl(var(--foreground))] group-hover:text-[hsl(var(--primary))]">
                        {label}
                      </span>
                      <span className="block truncate text-xs text-[hsl(var(--muted-foreground))]">
                        {c.channelId}
                      </span>
                    </span>
                  </Link>
                  <SubscriptionUnfollowButton channelId={c.channelId} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
