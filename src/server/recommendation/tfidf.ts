import { cosineSparse } from "@/server/recommendation/similarity";

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

export function documentFrequency(documents: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const doc of documents) {
    const unique = new Set(doc);
    for (const t of unique) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }
  return df;
}

export function vectorizeTfIdf(
  doc: string[],
  df: Map<string, number>,
  docCount: number,
): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of doc) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  const len = doc.length || 1;
  const vec = new Map<string, number>();
  for (const [t, c] of tf) {
    const idf = Math.log((docCount + 1) / (1 + (df.get(t) ?? 0)));
    vec.set(t, (c / len) * idf);
  }
  return vec;
}

/**
 * Pre-computed TF-IDF model built once per recommendation pool. Holds the
 * document frequencies and one or more centroids so `similarity` can be called
 * per candidate without rebuilding the corpus vectors every time.
 */
export type TfidfModel = {
  /** Max cosine similarity of `title` against the model's centroid(s). 0 when empty. */
  similarity(title: string): number;
  /** True when the corpus produced no usable tokens (similarity always 0). */
  readonly isEmpty: boolean;
};

const EMPTY_TFIDF_MODEL: TfidfModel = {
  similarity: () => 0,
  isEmpty: true,
};

/**
 * Builds a reusable {@link TfidfModel} from a corpus of titles.
 *
 * With no `groups`, behaves exactly like the legacy single-centroid
 * `titleTfidfSimilarity` (one centroid pooled from the whole corpus). When
 * `groups` are supplied, an extra centroid is built per non-empty group and
 * `similarity` returns the **max** cosine across all centroids — so a candidate
 * matching a single interest is not diluted by the user's other interests.
 * The global pooled centroid is always included, so multi-centroid similarity is
 * never lower than the single-centroid value.
 */
export function buildTfidfModel(
  corpus: string[],
  opts?: { groups?: string[][] },
): TfidfModel {
  const docs = corpus.map(tokenize).filter((d) => d.length > 0);
  if (docs.length === 0) return EMPTY_TFIDF_MODEL;
  const df = documentFrequency(docs);
  const docCount = docs.length;

  const centroids: Map<string, number>[] = [
    vectorizeTfIdf(docs.flat(), df, docCount),
  ];
  for (const group of opts?.groups ?? []) {
    const pooled = group.flatMap(tokenize);
    if (pooled.length === 0) continue;
    centroids.push(vectorizeTfIdf(pooled, df, docCount));
  }

  return {
    isEmpty: false,
    similarity(title: string): number {
      const v = vectorizeTfIdf(tokenize(title), df, docCount);
      let best = 0;
      for (const centroid of centroids) {
        const sim = cosineSparse(v, centroid);
        if (sim > best) best = sim;
      }
      return best;
    },
  };
}

/** Title similarity vs a corpus of other titles (content-based proxy for tags). */
export function titleTfidfSimilarity(title: string, corpus: string[]): number {
  return buildTfidfModel(corpus).similarity(title);
}

/**
 * Term-frequency vector for a single title — used for pairwise content
 * similarity in MMR diversification (no corpus / IDF needed, just token overlap).
 */
export function termFrequencyVector(title: string): Map<string, number> {
  const vec = new Map<string, number>();
  for (const t of tokenize(title)) {
    vec.set(t, (vec.get(t) ?? 0) + 1);
  }
  return vec;
}
