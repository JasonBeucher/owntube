import { Suspense } from "react";
import { SearchResults } from "@/components/search/search-results";

type SearchPageProps = {
  searchParams: Promise<{ q?: string | string[] }>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const sp = await searchParams;
  const raw = sp.q;
  const q = typeof raw === "string" ? raw.trim() : "";

  return (
    <main className="ot-page flex min-h-0 flex-1 flex-col gap-6 pt-1">
      {q ? (
        <Suspense
          fallback={
            <p className="text-[hsl(var(--muted-foreground))]">Loading…</p>
          }
        >
          <SearchResults query={q} />
        </Suspense>
      ) : (
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 text-[hsl(var(--muted-foreground))]">
          Enter a query in the top bar to search.
        </div>
      )}
    </main>
  );
}
