import { HomeFeedClient } from "@/components/home/home-feed-client";
import { normalizeTrendingRegionParam } from "@/lib/trending-regions";
import { auth } from "@/server/auth";

type HomePageProps = {
  searchParams: Promise<{ region?: string | string[] }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const session = await auth();
  const sp = await searchParams;
  const regionQuery = normalizeTrendingRegionParam(sp.region) ?? "US";
  const isAuthed = Boolean(session?.user?.id);

  return (
    <main className="ot-page">
      <HomeFeedClient region={regionQuery} isAuthed={isAuthed} />
    </main>
  );
}
