import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getTraktToken,
  isDbConfigured,
  listEntries,
  upsertEntry,
} from "@/lib/db";
import {
  pullViewerLists,
  pushEntryToTrakt,
  sleep,
  PUSH_THROTTLE_MS,
} from "@/features/sync/trakt-sync";
import { userKey } from "@/lib/current-user";

// POST /api/trakt/sync { direction?: "pull"|"push"|"both" }
// pull: Trakt → local DB (upsert matched by traktId, then tmdbId)
// push: local → Trakt (watchlist/history/ratings per entry with a remote id)
// both (default): pull first, then push locals (last-write-wins toward Trakt
// for entries existing on both sides).
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDbConfigured())
    return NextResponse.json(
      { error: "Database required for sync." },
      { status: 503 },
    );
  const uid = userKey(session);
  const stored = await getTraktToken(uid);
  if (!stored)
    return NextResponse.json(
      { error: "Trakt not connected — visit /api/trakt/auth first." },
      { status: 409 },
    );
  const clientId = process.env.TRAKT_CLIENT_ID;
  if (!clientId)
    return NextResponse.json(
      { error: "Missing TRAKT_CLIENT_ID." },
      { status: 500 },
    );
  const token = stored.accessToken;

  const { direction } = (await req.json().catch(() => ({}))) as {
    direction?: string;
  };
  const doPull = direction !== "push";
  const doPush = direction !== "pull";

  try {
    let pulled = 0;
    const pulledKeys = new Set<string>();
    if (doPull) {
      const { movies, shows } = await pullViewerLists(token, clientId);
      const existing = (await listEntries(uid)) ?? [];
      const byKey = new Map(
        existing.flatMap((e) => {
          const keys: [string, typeof e][] = [];
          if (e.traktId != null) keys.push([`trakt:${e.traktId}`, e]);
          if (e.tmdbId != null)
            keys.push([`${e.kind === "tv" ? "tv" : "movie"}:tmdb:${e.tmdbId}`, e]);
          return keys;
        }),
      );
      for (const remote of [...movies, ...shows]) {
        const key =
          remote.traktId != null
            ? `trakt:${remote.traktId}`
            : `${remote.kind === "tv" ? "tv" : "movie"}:tmdb:${remote.tmdbId}`;
        const prev =
          byKey.get(key) ??
          (remote.tmdbId != null
            ? byKey.get(
                `${remote.kind === "tv" ? "tv" : "movie"}:tmdb:${remote.tmdbId}`,
              )
            : undefined);
        await upsertEntry(uid, {
          id: prev?.id,
          kind: remote.kind,
          title: remote.title ?? prev?.title ?? "Unknown title",
          coverUrl: prev?.coverUrl ?? null,
          status: remote.status,
          progress: remote.progress,
          total: remote.total ?? prev?.total ?? null,
          score: remote.score ?? prev?.score ?? null,
          notes: prev?.notes ?? null,
          tmdbId: remote.tmdbId ?? prev?.tmdbId ?? null,
          traktId: remote.traktId ?? prev?.traktId ?? null,
        });
        if (key) pulledKeys.add(key);
        pulled++;
      }
    }

    let pushed = 0;
    let skipped = 0;
    if (doPush) {
      const entries = (await listEntries(uid)) ?? [];
      let first = true;
      for (const entry of entries) {
        if (entry.traktId == null && entry.tmdbId == null) continue;
        const keys = [
          entry.traktId != null ? `trakt:${entry.traktId}` : null,
          entry.tmdbId != null
            ? `${entry.kind === "tv" ? "tv" : "movie"}:tmdb:${entry.tmdbId}`
            : null,
        ].filter((k): k is string => k != null);
        // Just pulled this one from Trakt this run, so local already
        // equals remote — pushing it back would only burn rate limit.
        if (doPull && keys.some((k) => pulledKeys.has(k))) {
          skipped++;
          continue;
        }
        if (!first) await sleep(PUSH_THROTTLE_MS);
        first = false;
        await pushEntryToTrakt(token, clientId, {
          kind: entry.kind,
          status: entry.status,
          score: entry.score,
          traktId: entry.traktId,
          tmdbId: entry.tmdbId,
        });
        pushed++;
      }
    }

    return NextResponse.json({ pulled, pushed, skipped });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync failed";
    const status = msg.includes("expired") ? 401 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
