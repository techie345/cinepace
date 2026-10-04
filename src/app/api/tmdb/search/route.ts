import { NextResponse } from "next/server";
import { searchMovies, searchShows } from "@/features/discovery/tmdb";

// GET /api/tmdb/search?q=...&type=movie|tv — TMDB metadata for the search UI.
// The API key stays server-side here; the client never sees it.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const q = params.get("q")?.trim();
  const type = params.get("type") === "tv" ? "tv" : "movie";
  if (!q) return NextResponse.json({ results: [] });
  const apiKey =
    process.env.TMDB_API_KEY ?? process.env.TMDB_ACCESS_TOKEN ?? "";
  if (!apiKey)
    return NextResponse.json(
      { error: "Missing TMDB_API_KEY — add one from themoviedb.org/settings/api." },
      { status: 500 },
    );
  try {
    const results =
      type === "tv" ? await searchShows(apiKey, q) : await searchMovies(apiKey, q);
    return NextResponse.json({
      results: results.map((m) => ({
        tmdbId: m.id,
        title: m.title,
        coverUrl: m.coverUrl,
        total: null,
        score: m.score,
        description: m.overview,
        genres: m.genres,
        format: type === "tv" ? "TV Show" : "Movie",
        status: null,
        year: m.year,
        siteUrl: m.siteUrl,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Search failed" },
      { status: 502 },
    );
  }
}
