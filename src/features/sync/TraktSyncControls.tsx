"use client";

import { useEffect, useState } from "react";

export default function TraktSyncControls() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/trakt/status")
      .then((r) => r.json())
      .then((j) => {
        setConnected(Boolean(j.connected));
        setReason(typeof j.reason === "string" ? j.reason : null);
      })
      .catch(() => setConnected(false));
  }, []);

  async function runSync(direction: "pull" | "push" | "both") {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/trakt/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction }),
      });
      const json = (await res.json()) as {
        pulled?: number;
        pushed?: number;
        skipped?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      const bits = [
        `pulled ${json.pulled ?? 0}`,
        `pushed ${json.pushed ?? 0}`,
      ];
      if (json.skipped) bits.push(`skipped ${json.skipped} already in sync`);
      setMsg(`Synced — ${bits.join(", ")}.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  }

  if (connected === null)
    return <p className="text-sm text-zinc-500">Checking Trakt…</p>;

  if (!connected)
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="font-medium">Trakt 2-way sync</h2>
        <p className="mt-1 text-sm text-zinc-400">
          {reason === "no-db"
            ? "Connect Neon Postgres first — tokens need a database."
            : reason === "misconfigured"
              ? "Set TRAKT_CLIENT_ID / TRAKT_CLIENT_SECRET (trakt.tv/oauth/applications)."
              : "Connect your Trakt account to push and pull list changes."}
        </p>
        <a
          href="/api/trakt/auth"
          className="mt-3 inline-block rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium hover:bg-indigo-500"
        >
          Connect Trakt
        </a>
        {msg && <p className="mt-2 text-sm text-red-400">{msg}</p>}
      </div>
    );

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <h2 className="font-medium">Trakt 2-way sync</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Pull your Trakt watchlist/history down, push local progress up, or do
        both. Show episode progress syncs down from Trakt; pushing covers
        movies, watchlist and ratings.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => void runSync("pull")}
          disabled={busy}
          className="rounded-md bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700 disabled:opacity-50"
        >
          Pull from Trakt
        </button>
        <button
          onClick={() => void runSync("push")}
          disabled={busy}
          className="rounded-md bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700 disabled:opacity-50"
        >
          Push to Trakt
        </button>
        <button
          onClick={() => void runSync("both")}
          disabled={busy}
          className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
        >
          Sync both ways
        </button>
      </div>
      {busy && <p className="mt-2 text-sm text-zinc-500">Syncing…</p>}
      {msg && <p className="mt-2 text-sm text-green-400">{msg}</p>}
    </div>
  );
}
