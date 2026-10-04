// Shared Trakt two-way sync helpers (pure + thin REST wrappers).
// Authenticated calls need a user access token from Trakt OAuth plus the
// app's client id on every request (trakt-api-key header).
//
// Sync model:
// - plan_to_watch <-> Trakt watchlist
// - completed movie <-> Trakt history
// - watching/completed show <-> Trakt watched episodes (progress = episodes
//   watched, total = aired episodes). Episode progress is pull-only: pushing
//   episodes needs per-episode Trakt ids we don't store.
// - score <-> Trakt ratings (1-10)

import type { EntryStatus, MediaKind } from "@/lib/db";

export const TRAKT_API = "https://api.trakt.tv";
export const TRAKT_AUTH_URL = "https://auth.trakt.tv/oauth/authorize";
export const TRAKT_TOKEN_URL = "https://api.trakt.tv/oauth/token";

/** Stay polite to the Trakt rate limit. Pause this long between mutations. */
export const PUSH_THROTTLE_MS = 700;

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Parse a Retry-After header (seconds) → ms, capped. Null if absent/garbage. */
export function retryAfterMs(
  header: string | null,
  capMs = 15000,
): number | null {
  if (header == null) return null;
  const s = Number(header.trim());
  if (!Number.isFinite(s) || s < 0) return null;
  return Math.min(s * 1000, capMs);
}

/** Local status → where it lives on Trakt. */
export function traktHome(
  status: EntryStatus,
  kind: MediaKind,
): "watchlist" | "history" | "episodes" | "nowhere" {
  switch (status) {
    case "plan_to_watch":
      return "watchlist";
    case "completed":
      return kind === "movie" ? "history" : "episodes";
    case "watching":
      return kind === "tv" ? "episodes" : "history";
    default:
      return "nowhere";
  }
}

/** Trakt 1-10 rating passthrough. Null stays null; out-of-range throws. */
export function toTraktRating(score: number | null): number | null {
  if (score == null) return null;
  const r = Math.round(score);
  if (r < 1 || r > 10) throw new Error(`Rating out of range: ${score}`);
  return r;
}

export interface TraktIds {
  trakt?: number;
  tmdb?: number;
}

/** Build the {ids} object Trakt expects. Needs at least one known id. */
export function toTraktIds(entry: {
  traktId: number | null;
  tmdbId: number | null;
}): TraktIds {
  const ids: TraktIds = {};
  if (entry.traktId != null) ids.trakt = entry.traktId;
  if (entry.tmdbId != null) ids.tmdb = entry.tmdbId;
  if (ids.trakt == null && ids.tmdb == null)
    throw new Error("Entry has no Trakt or TMDB id — add it via Search first.");
  return ids;
}

export function buildAuthorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
}): string {
  const u = new URL(TRAKT_AUTH_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", args.clientId);
  u.searchParams.set("redirect_uri", args.redirectUri);
  u.searchParams.set("code_challenge", args.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  if (args.state) u.searchParams.set("state", args.state);
  return u.toString();
}

/** Cookie holding the PKCE verifier between /api/trakt/auth and the callback. */
export const TRAKT_PKCE_COOKIE = "trakt_pkce_verifier";
export const TRAKT_PKCE_COOKIE_PATH = "/api/trakt/callback";

function base64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** S256 PKCE challenge for a verifier (RFC 7636). */
export async function toCodeChallenge(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64Url(new Uint8Array(digest));
}

/** Fresh PKCE pair: random 43-char verifier + its S256 challenge. */
export async function createPkcePair(): Promise<{
  verifier: string;
  challenge: string;
}> {
  const raw = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64Url(raw);
  return { verifier, challenge: await toCodeChallenge(verifier) };
}

/** Read a cookie value off a Request's Cookie header. */
export function getRequestCookie(
  req: Request,
  name: string,
): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name)
      return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Canonical redirect URI for Trakt OAuth.
 * Override with TRAKT_REDIRECT_URI when the URL registered in
 * trakt.tv/oauth/applications differs. */
export function getTraktRedirectUri(req: Request): string {
  const override = process.env.TRAKT_REDIRECT_URI?.trim();
  if (override) return override;
  return `${new URL(req.url).origin}/api/trakt/callback`;
}

export async function exchangeCodeForToken(args: {
  clientId: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}> {
  const res = await fetch(TRAKT_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "cinepace/0.1.0 (+https://cinepace.site51.vip)",
    },
    body: JSON.stringify({
      code: args.code,
      client_id: args.clientId,
      redirect_uri: args.redirectUri,
      grant_type: "authorization_code",
      code_verifier: args.codeVerifier,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`Trakt token exchange failed: ${res.status} ${detail}`);
  }
  return (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
}

async function authed<T>(
  token: string,
  clientId: string,
  path: string,
  init?: { method?: string; body?: unknown },
  attempt = 0,
): Promise<T> {
  const res = await fetch(`${TRAKT_API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "cinepace/0.1.0 (+https://cinepace.site51.vip)",
      "trakt-api-version": "2",
      "trakt-api-key": clientId,
      Authorization: `Bearer ${token}`,
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  // Rate-limited: wait out Retry-After (or a short backoff) and retry twice
  // before surfacing the 429.
  if (res.status === 429 && attempt < 2) {
    await res.text().catch(() => "");
    await sleep(retryAfterMs(res.headers.get("retry-after")) ?? 1000 * (attempt + 1));
    return authed(token, clientId, path, init, attempt + 1);
  }
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    if (res.status === 401)
      throw new Error(`Trakt token expired — reconnect. ${detail}`);
    throw new Error(`Trakt error: ${res.status} ${detail}`);
  }
  return (await res.json()) as T;
}

interface TraktMedia {
  title?: string;
  ids?: { trakt?: number; tmdb?: number };
}

export interface RemoteEntry {
  kind: MediaKind;
  traktId: number | null;
  tmdbId: number | null;
  title: string;
  status: EntryStatus;
  progress: number;
  total: number | null;
  score: number | null;
}

function mediaIds(m?: TraktMedia): { traktId: number | null; tmdbId: number | null } {
  return {
    traktId: m?.ids?.trakt ?? null,
    tmdbId: m?.ids?.tmdb ?? null,
  };
}

/** Pull the viewer's watchlist, watched history and ratings. */
export async function pullViewerLists(
  token: string,
  clientId: string,
): Promise<{ movies: RemoteEntry[]; shows: RemoteEntry[] }> {
  const [watchlist, watchedMovies, watchedShows, ratedMovies, ratedShows] =
    await Promise.all([
      authed<
        { type: string; movie?: TraktMedia; show?: TraktMedia }[]
      >(token, clientId, "/sync/watchlist"),
      authed<{ movie?: TraktMedia; plays?: number }[]>(
        token,
        clientId,
        "/sync/watched/movies",
      ),
      authed<
        {
          show?: TraktMedia & { aired_episodes?: number };
          episodes?: unknown[];
          plays?: number;
        }[]
      >(token, clientId, "/sync/watched/shows"),
      authed<{ movie?: TraktMedia; rating?: number }[]>(
        token,
        clientId,
        "/sync/ratings/movies",
      ),
      authed<{ show?: TraktMedia; rating?: number }[]>(
        token,
        clientId,
        "/sync/ratings/shows",
      ),
    ]);

  const ratings = new Map<string, number>();
  for (const r of ratedMovies) {
    const ids = mediaIds(r.movie);
    if (r.rating != null && (ids.traktId != null || ids.tmdbId != null))
      ratings.set(`movie:${ids.traktId ?? ""}:${ids.tmdbId ?? ""}`, r.rating);
  }
  for (const r of ratedShows) {
    const ids = mediaIds(r.show);
    if (r.rating != null && (ids.traktId != null || ids.tmdbId != null))
      ratings.set(`tv:${ids.traktId ?? ""}:${ids.tmdbId ?? ""}`, r.rating);
  }
  const scoreFor = (
    kind: MediaKind,
    ids: { traktId: number | null; tmdbId: number | null },
  ): number | null =>
    ratings.get(`movie:${ids.traktId ?? ""}:${ids.tmdbId ?? ""}`) ??
    (kind === "tv"
      ? (ratings.get(`tv:${ids.traktId ?? ""}:${ids.tmdbId ?? ""}`) ?? null)
      : null);

  const movies: RemoteEntry[] = [];
  const shows: RemoteEntry[] = [];

  for (const item of watchlist) {
    if (item.type === "movie" && item.movie) {
      const ids = mediaIds(item.movie);
      movies.push({
        kind: "movie",
        ...ids,
        title: item.movie.title ?? "Unknown title",
        status: "plan_to_watch",
        progress: 0,
        total: null,
        score: scoreFor("movie", ids),
      });
    } else if (item.type === "show" && item.show) {
      const ids = mediaIds(item.show);
      shows.push({
        kind: "tv",
        ...ids,
        title: item.show.title ?? "Unknown title",
        status: "plan_to_watch",
        progress: 0,
        total: null,
        score: scoreFor("tv", ids),
      });
    }
  }

  for (const w of watchedMovies) {
    if (!w.movie) continue;
    const ids = mediaIds(w.movie);
    if (ids.traktId == null && ids.tmdbId == null) continue;
    movies.push({
      kind: "movie",
      ...ids,
      title: w.movie.title ?? "Unknown title",
      status: "completed",
      progress: 1,
      total: 1,
      score: scoreFor("movie", ids),
    });
  }

  for (const w of watchedShows) {
    if (!w.show) continue;
    const ids = mediaIds(w.show);
    if (ids.traktId == null && ids.tmdbId == null) continue;
    const watched = w.episodes?.length ?? 0;
    const total = w.show.aired_episodes ?? null;
    shows.push({
      kind: "tv",
      ...ids,
      title: w.show.title ?? "Unknown title",
      status: total != null && watched >= total ? "completed" : "watching",
      progress: watched,
      total,
      score: scoreFor("tv", ids),
    });
  }

  return { movies, shows };
}

export interface PushableEntry {
  kind: MediaKind;
  status: EntryStatus;
  score: number | null;
  traktId: number | null;
  tmdbId: number | null;
}

/** Push one entry to Trakt (watchlist + history + ratings).
 * Returns which remote lists were touched. Show episode progress is
 * pull-only (see module docstring) — shows push watchlist + ratings. */
export async function pushEntryToTrakt(
  token: string,
  clientId: string,
  entry: PushableEntry,
): Promise<{ touched: string[] }> {
  const ids = toTraktIds(entry);
  const key = entry.kind === "movie" ? "movies" : "shows";
  const touched: string[] = [];

  if (entry.status === "plan_to_watch") {
    await authed(token, clientId, "/sync/watchlist", {
      method: "POST",
      body: { [key]: [{ ids }] },
    });
    touched.push("watchlist");
  } else {
    // No longer planned → make sure it isn't lingering on the watchlist.
    await authed(token, clientId, "/sync/watchlist/remove", {
      method: "POST",
      body: { [key]: [{ ids }] },
    });
    if (entry.status === "completed" && entry.kind === "movie") {
      await authed(token, clientId, "/sync/history", {
        method: "POST",
        body: { movies: [{ ids, watched_at: new Date().toISOString() }] },
      });
      touched.push("history");
    }
    if (entry.status === "dropped" && entry.kind === "movie") {
      await authed(token, clientId, "/sync/history/remove", {
        method: "POST",
        body: { movies: [{ ids }] },
      });
      touched.push("history");
    }
  }

  const rating = toTraktRating(entry.score);
  if (rating != null) {
    await authed(token, clientId, "/sync/ratings", {
      method: "POST",
      body: { [key]: [{ ids, rating }] },
    });
    touched.push("ratings");
  } else {
    await authed(token, clientId, "/sync/ratings/remove", {
      method: "POST",
      body: { [key]: [{ ids }] },
    });
  }
  return { touched };
}
