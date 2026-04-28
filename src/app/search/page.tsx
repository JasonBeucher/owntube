import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { SearchForm } from "@/components/search/search-form";
import { SearchResults } from "@/components/search/search-results";

type SearchPageProps = {
  searchParams: Promise<{ q?: string | string[] }>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const sp = await searchParams;
  const raw = sp.q;
  const q = typeof raw === "string" ? raw.trim() : "";

  return (
    <main className="ot-page flex min-h-0 flex-1 flex-col gap-8">
      <PageHeader
        title="Search"
        subtitle="Query Piped (and Invidious fallback when configured)."
      />
      <SearchForm defaultQuery={q} />
      {q ? (
        <Suspense
          fallback={
            <p className="text-[hsl(var(--muted-foreground))]">Loading…</p>
          }
        >
          <SearchResults query={q} />
        </Suspense>
      ) : (
        <p className="text-[hsl(var(--muted-foreground))]">
          Enter a query to search Piped (and Invidious fallback when
          configured).
        </p>
      )}
    </main>
  );
}
