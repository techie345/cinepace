import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getTraktToken,
  isDbConfigured,
  listEntries,
  upsertEntry,
} from "@/lib/db";
import { pullViewerLists } from "@/features/sync/trakt-sync";
import { userKey } from "@/lib/current-user";

// POST /api/trakt/import — pull the connected Trakt account's watchlist +
// watched history into the DB (DB mode) or return the normalized entries
// for the client to store in localStorage (fallback mode).
export async function POST() {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const uid = userKey(session);
  const stored = await getTraktToken(uid);
  if (!stored)
    return NextResponse.json(
      { error: "Trakt not connected — visit /api/trakt/auth first." },
      { status: 409 },
    );
  const clientId = process.env.TRAKT_CLIENT_ID;
  if (!clientId)
    return NextResponse.json({ error: "Missing TRAKT_CLIENT_ID." }, { status: 500 });

  try {
    const { movies, shows } = await pullViewerLists(stored.accessToken, clientId);
    const uidKey = uid;
    const entries = [...movies, ...shows].map((r) => ({
      kind: r.kind,
      title: r.title,
      coverUrl: null as string | null,
      status: r.status,
      progress: r.progress,
      total: r.total,
      score: r.score,
      notes: null as string | null,
      tmdbId: r.tmdbId,
      traktId: r.traktId,
    }));

    if (!isDbConfigured()) return NextResponse.json({ entries, stored: false });

    const existing = (await listEntries(uidKey)) ?? [];
    const seen = new Set(
      existing.flatMap((e) => [
        e.traktId != null ? `trakt:${e.traktId}` : "",
        e.tmdbId != null ? `tmdb:${e.tmdbId}` : "",
      ]),
    );
    let storedCount = 0;
    for (const e of entries) {
      const key =
        e.traktId != null ? `trakt:${e.traktId}` : `tmdb:${e.tmdbId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await upsertEntry(uidKey, e);
      storedCount++;
    }
    return NextResponse.json({ entries, stored: storedCount });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Import failed" },
      { status: 502 },
    );
  }
}
