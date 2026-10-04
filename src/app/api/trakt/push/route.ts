import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getTraktToken, isDbConfigured, listEntries } from "@/lib/db";
import { userKey } from "@/lib/current-user";
import { pushEntryToTrakt } from "@/features/sync/trakt-sync";

// POST /api/trakt/push { id: string } — push one local entry to Trakt.
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
      { error: "Trakt not connected." },
      { status: 409 },
    );
  const clientId = process.env.TRAKT_CLIENT_ID;
  if (!clientId)
    return NextResponse.json({ error: "Missing TRAKT_CLIENT_ID." }, { status: 500 });
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const entries = (await listEntries(uid)) ?? [];
  const entry = entries.find((e) => e.id === id);
  if (!entry || (entry.kind !== "movie" && entry.kind !== "tv"))
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (entry.traktId == null && entry.tmdbId == null)
    return NextResponse.json(
      { error: "Entry has no Trakt/TMDB id — add it via Search first." },
      { status: 400 },
    );

  try {
    const res = await pushEntryToTrakt(stored.accessToken, clientId, {
      kind: entry.kind,
      status: entry.status,
      score: entry.score,
      traktId: entry.traktId,
      tmdbId: entry.tmdbId,
    });
    return NextResponse.json({ ok: true, touched: res.touched });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Push failed" },
      { status: 502 },
    );
  }
}
