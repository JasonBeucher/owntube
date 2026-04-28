/**
 * YouTube / googlevideo often reject minimal bot User-Agents (403 / empty).
 * Match a normal browser enough for segment and manifest fetches from our
 * server-side proxy.
 */
export function headersForYoutubeUpstream(opts: {
  range?: string | null;
  accept?: string | null;
}): Record<string, string> {
  const h: Record<string, string> = {
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "accept-language": "en-US,en;q=0.9",
    accept: opts.accept ?? "*/*",
    referer: "https://www.youtube.com/",
    origin: "https://www.youtube.com",
  };
  if (opts.range) h.range = opts.range;
  return h;
}
