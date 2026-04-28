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

/** Title similarity vs a corpus of other titles (content-based proxy for tags). */
export function titleTfidfSimilarity(title: string, corpus: string[]): number {
  if (corpus.length === 0) return 0;
  const docs = corpus.map(tokenize).filter((d) => d.length > 0);
  if (docs.length === 0) return 0;
  const df = documentFrequency(docs);
  const docCount = docs.length;
  const pooled = docs.flat();
  const centroid = vectorizeTfIdf(pooled, df, docCount);
  const v = vectorizeTfIdf(tokenize(title), df, docCount);
  return cosineSparse(v, centroid);
}
