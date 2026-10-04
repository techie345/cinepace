"use client";

import { useState } from "react";
import { useEntries } from "@/features/tracking/useEntries";
import type { Entry, MediaKind } from "@/lib/db";

interface SearchResult {
  tmdbId: number;
  title: string;
  coverUrl: string | null;
  total: number | null;
  score: number | null;
  description: string | null;
  genres: string[];
  format: string | null;
  status: string | null;
  year: number | null;
  siteUrl: string | null;
}

export default function SearchClient() {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<MediaKind>("movie");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const { save, replaceAll, entries } = useEntries();

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/tmdb/search?q=${encodeURIComponent(q)}&type=${tab}`,
      );
      const json = (await res.json()) as { results?: SearchResult[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Search failed");
      setResults(json.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setBusy(false);
    }
  }

  function addResult(r: SearchResult) {
    void save({
      kind: tab,
      title: r.title,
      coverUrl: r.coverUrl,
      status: "plan_to_watch",
      progress: 0,
      total: r.total,
      score: null,
      notes: null,
      tmdbId: r.tmdbId,
      traktId: null,
    });
  }

  async function runImport(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setImportMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/trakt/import", { method: "POST" });
      const json = (await res.json()) as {
        entries?: (Omit<Entry, "id" | "userId" | "updatedAt"> & { id?: string })[];
        stored?: number | boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Import failed");
      const imported = json.entries ?? [];
      if (json.stored) {
        const n = typeof json.stored === "number" ? json.stored : imported.length;
        setImportMsg(`Imported ${n} titles from Trakt into the database.`);
      } else {
        // localStorage mode: merge imported entries in
        const now = new Date().toISOString();
        const existingIds = new Set(
          entries.flatMap((x) => [
            x.traktId != null ? `trakt:${x.traktId}` : "",
            x.tmdbId != null ? `tmdb:${x.tmdbId}` : "",
          ]),
        );
        const fresh: Entry[] = imported
          .filter((x) => {
            const key =
              x.traktId != null ? `trakt:${x.traktId}` : `tmdb:${x.tmdbId}`;
            return !existingIds.has(key);
          })
          .map((x, i) => ({
            ...x,
            id: `import-${Date.now()}-${i}`,
            userId: "local-user",
            updatedAt: now,
          }));
        replaceAll([...fresh, ...entries]);
        setImportMsg(`Imported ${fresh.length} titles from Trakt into this browser.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Search movies &amp; TV</h1>
        <div className="mt-3 flex gap-2">
          {(["movie", "tv"] as MediaKind[]).map((k) => (
            <button
              key={k}
              onClick={() => {
                setTab(k);
                setResults([]);
              }}
              className={`rounded-md px-3 py-1.5 text-sm capitalize ${tab === k ? "bg-indigo-600" : "bg-zinc-800 hover:bg-zinc-700"}`}
            >
              {k === "tv" ? "TV" : k}
            </button>
          ))}
        </div>
        <form onSubmit={runSearch} className="mt-3 flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${tab === "tv" ? "TV shows" : "movies"}…`}
            className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
          >
            Search
          </button>
        </form>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {busy && <p className="text-sm text-zinc-500">Working…</p>}

      {results.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2">
          {results.map((r) => (
            <li
              key={r.tmdbId}
              className="flex gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-3"
            >
              {r.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.coverUrl} alt="" className="h-24 w-16 shrink-0 rounded object-cover" />
              ) : (
                <div className="flex h-24 w-16 shrink-0 items-center justify-center rounded bg-zinc-800 text-xs text-zinc-500">
                  No art
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-medium">{r.title}</h3>
                <p className="text-sm text-zinc-400">
                  {[r.year, r.format].filter(Boolean).join(" · ") ||
                    "Details unavailable"}
                </p>
                <p className="text-sm text-zinc-400">
                  {r.score != null ? `★ ${r.score}/10` : "Unrated"}
                </p>
                {r.genres.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.genres.slice(0, 3).map((g) => (
                      <span
                        key={g}
                        className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300"
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                )}
                {r.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-zinc-500">
                    {r.description}
                  </p>
                )}
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => addResult(r)}
                    className="rounded bg-indigo-600 px-2 py-1 text-xs font-medium hover:bg-indigo-500"
                  >
                    + Add to my {tab === "tv" ? "TV" : "movie"} list
                  </button>
                  {r.siteUrl && (
                    <a
                      href={r.siteUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded px-2 py-1 text-xs text-zinc-400 hover:text-white"
                    >
                      TMDB ↗
                    </a>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="font-medium">Import from Trakt</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Pull your Trakt watchlist and watched history into your lists.
          Requires a connected Trakt account (see Profile).
        </p>
        <div className="mt-3">
          <button
            onClick={(e) => void runImport(e)}
            disabled={busy}
            className="rounded-md bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700 disabled:opacity-50"
          >
            Import from Trakt
          </button>
        </div>
        {importMsg && <p className="mt-2 text-sm text-green-400">{importMsg}</p>}
      </div>
    </div>
  );
}
