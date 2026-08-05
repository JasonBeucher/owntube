# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Friends: add people from the same instance by email (enumeration-safe responses, mutual-request auto-accept) and send them videos with an optional note; inbox with unseen badges, read receipts and dismiss, plus entry points on the watch page and in every video card menu
- Aurora visual theme (deep violet glass with soft glows) next to Default and Terminal; appearance choices in Settings now persist immediately
- `friendships` and `video_shares` tables (migration `0007_friends.sql`)
- TV: Continue watching, New from your subscriptions and named recommendation shelves on Home, with a resume progress bar on every card
- TV: autoplay of the next video with a cancellable countdown when one ends
- TV: Library (playlists, liked, saved), Shorts and Settings sections; Settings carries the instance URL, playback quality, trending region, SponsorBlock and sign-out
- TV: like / dislike / save / subscribe and a comments panel in the player; Subscribe plus videos/shorts tabs on channel pages
- TV: search suggestions and recent searches; subtitle track picker and chapter markers in the player
- TV: left/right seek during playback (long-press jumps further) and hardware play-pause / fast-forward / rewind keys
- `history.resumePositions` and a `position_seconds` column (migration `0008_watch_history_position.sql`) so clients can resume and draw progress without one request per card
- Subtitle tracks and description-derived chapters on `video.detail`; `interactions.list` for the liked/saved lists
- Denormalized video title and channel name on `interactions` and `playlist_items` (migration `0009_interaction_playlist_titles.sql`), so those lists render without an upstream fetch per row

### Changed

- The Terminal pixel mark (chevron + cursor underscore) is now the single official owntube logo across the UI, favicons, PWA icons, wordmarks and the TV app assets
- Onboarding: brand header with named step indicator, back navigation between steps, a "finish without rating" escape hatch and a next-steps completion screen
- Settings: sections rendered as cards with a sticky save bar; native checkboxes/selects follow the brand accent and the theme's color-scheme

### Fixed

- Sign-in now reports failures instead of silently redirecting: next-auth v5 returns `ok: true` (the HTTP status) with `error` set and `url: null` when credentials are rejected, so the form took the success path and sent the user to the home page still logged out, making the "Invalid credentials." message unreachable
- Partial settings updates (e.g. changing the home region) no longer silently reset theme and visual theme to their defaults
- "Don't recommend this channel" now also filters the watch-page Related list
- History rows always render a thumbnail (derived from the video id when no cached URL exists)
- Logged-out pages no longer fire an unauthorized settings request on every load
- Playwright smoke suite: three of the four tests could never pass (they asserted a search link that no longer exists, raced the shorts shelf skeleton, and filtered nav text that the icon's SVG `<title>` duplicates)
- TV: every screen was unmounted on navigation, so returning from a video refetched the feed from page 1 and reset scroll and focus; screens now stay mounted and the player no longer replaces the shell
- TV: watch progress was written only on unmount, losing the whole session whenever the app was killed rather than backed out of; it is now also saved every 20s
- TV: an expired device token left the app silently anonymous — apparently signed in, but with no history, subscriptions or recommendations and no way back to the login screen; a 401 now clears the token and re-prompts
- TV: `durationWatched` was receiving a playback offset rather than time watched, distorting the recommender's engagement signal; the offset now goes to `position_seconds`
- TV: the subscriptions feed fanned out over every subscribed channel before rendering anything, and picking a nav item while a channel page was open appeared to do nothing
- `subscriptions.mergedFeedInfinite` typed its empty-subscriptions result without `watched`, making the procedure's inferred output a union that no caller could read the flag from

## [0.1.0] - 2026-04-27

First public release. The full backlog (P0 → P3) is implemented and reasonably stable on a single-user setup.

### Added

- **P0 — MVP**
  - Search, watch and history with Vidstack player and split-audio fallback
  - Like / dislike / save interactions
  - Piped primary + Invidious fallback proxy with 6h `video_cache` and stale-cache fallback when both upstreams are down
  - Auth.js v5 with credentials provider (bcrypt)
  - Process-wide upstream rate limiter (~60 req/min)
  - Vitest unit tests + Playwright smoke test
- **P1 — Core experience**
  - Personal recommendation feed (TF-IDF on titles + tags, cosine similarity, MMR with λ=0.7, time decay, 15% exploration)
  - Cold-start strategy for new accounts (categorized trending → related videos → full algorithm)
  - Trending page with regional selection
  - Subscriptions: subscribe to channels + chronological merged feed
  - Channel pages with profile and uploads
- **P2 — Polish**
  - Light/dark theme switcher (Zustand store + Tailwind v4)
  - `/settings` with per-user Piped/Invidious overrides, instance health checks, and JSON export/import
  - Picture-in-Picture button + keyboard shortcuts in the player (`i` for PiP, others wired to Vidstack defaults)
  - Docker Compose with healthcheck and `restart: unless-stopped`
  - Self-hosting guide ([docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)) covering Invidious setup script, Piped guide pointer, public instance picker, and a backup cron template
- **P3 — Advanced**
  - Multi-user accounts with per-user data isolation
  - YouTube Takeout watch-history import (`takeout.importHistory`)
  - `/dashboard` with personal stats
  - `/playlists` for local playlists (schema + tRPC router)
  - PWA basics: manifest + service worker + registration

### Tooling / infra

- Biome 2 as the only linter/formatter (no ESLint, no Prettier)
- Drizzle ORM with `better-sqlite3`, migrations in `src/server/db/migrations/`
- pnpm 9.15 pinned via `packageManager`
- Multi-stage Dockerfile + Compose
- Optional self-hosted Invidious via `scripts/setup-invidious.sh`

[Unreleased]: https://github.com/spookiss/owntube/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/spookiss/owntube/releases/tag/v0.1.0
