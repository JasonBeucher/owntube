import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import { ChannelSubscribeButton } from "@/components/channel/channel-subscribe-button";
import { Button } from "@/components/ui/button";
import { VideoGrid } from "@/components/videos/video-grid";
import { auth } from "@/server/auth";
import { channelPageInputSchema } from "@/server/services/proxy.types";
import { createCaller } from "@/server/trpc/caller";

type ChannelPageProps = {
  params: Promise<{ channelId: string }>;
};

export default async function ChannelPage({ params }: ChannelPageProps) {
  noStore();
  const { channelId: rawId } = await params;
  const input = channelPageInputSchema.parse({ channelId: rawId });
  const session = await auth();
  const isAuthed = Boolean(session?.user?.id);
  const caller = await createCaller();
  const page = await caller.channel.page({ channelId: input.channelId });

  return (
    <main className="ot-page space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex min-w-0 flex-1 gap-4">
          {page.avatarUrl ? (
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--muted))] shadow-md">
              {/* biome-ignore lint/performance/noImgElement: external instance URL */}
              <img
                src={page.avatarUrl}
                alt=""
                className="h-full w-full object-cover"
                width={80}
                height={80}
              />
            </div>
          ) : null}
          <div className="min-w-0 space-y-2">
            <h1 className="text-3xl font-extrabold tracking-tight">
              {page.name ?? page.channelId}
            </h1>
            {page.subscriberCount != null ? (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                {page.subscriberCount.toLocaleString()} subscribers
              </p>
            ) : null}
            {page.description ? (
              <p className="line-clamp-4 text-sm text-[hsl(var(--muted-foreground))]">
                {page.description}
              </p>
            ) : null}
            <p className="font-mono text-xs text-[hsl(var(--muted-foreground))]">
              {page.channelId}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
          <ChannelSubscribeButton
            channelId={page.channelId}
            isAuthed={isAuthed}
          />
          <Button variant="outline" size="sm" asChild>
            <Link href="/search">Search</Link>
          </Button>
        </div>
      </div>

      {page.bannerUrl ? (
        <div className="relative aspect-[21/9] w-full overflow-hidden rounded-[20px] border border-[hsl(var(--border))] bg-[hsl(var(--muted))] shadow-lg">
          {/* biome-ignore lint/performance/noImgElement: third-party channel banner */}
          <img
            src={page.bannerUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        </div>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-xl font-bold tracking-tight">Videos</h2>
        <p className="font-mono text-xs text-[hsl(var(--muted-foreground))]">
          Source: {page.sourceUsed}
          {page.stale ? " · stale cache" : ""}
        </p>
        <VideoGrid videos={page.videos} />
      </section>

      {page.continuation ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          More videos available — pagination UI can be added next.
        </p>
      ) : null}
    </main>
  );
}
