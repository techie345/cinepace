import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export type MediaKind = "movie" | "tv";
export type EntryStatus =
  | "watching"
  | "completed"
  | "on_hold"
  | "dropped"
  | "plan_to_watch";

export interface Entry {
  id: string;
  userId: string;
  kind: MediaKind;
  title: string;
  coverUrl: string | null;
  status: EntryStatus;
  progress: number;
  total: number | null;
  score: number | null; // 0-10
  notes: string | null;
  tmdbId: number | null;
  traktId: number | null;
  updatedAt: string;
}

let sql: NeonQueryFunction<false, false> | null = null;
let ensured = false;

function client() {
  if (sql) return sql;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return null;
  sql = neon(url);
  return sql;
}

export function isDbConfigured() {
  return Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);
}

async function ensureSchema(): Promise<boolean> {
  const db = client();
  if (!db) return false;
  if (ensured) return true;
  // Original table (anime/manga era). Kept as-is for fresh DBs; the
  // migration steps below widen it for movies/tv. This DB is shared with
  // the anipace app, so every change here must stay backward compatible:
  // existing kinds/columns keep working, new ones are additive.
  await db`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('anime', 'manga')),
      title TEXT NOT NULL,
      cover_url TEXT,
      status TEXT NOT NULL DEFAULT 'plan_to_watch',
      progress INTEGER NOT NULL DEFAULT 0,
      total INTEGER,
      score INTEGER CHECK (score IS NULL OR (score >= 0 AND score <= 10)),
      notes TEXT,
      anilist_id INTEGER,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await db`
    CREATE INDEX IF NOT EXISTS entries_user_kind_idx ON entries (user_id, kind);
  `;
  // Widen the kind check so movie/tv rows coexist with anime/manga rows.
  // (Postgres auto-named the inline CHECK `entries_kind_check`.)
  await db`
    ALTER TABLE entries DROP CONSTRAINT IF EXISTS entries_kind_check;
  `;
  await db`
    ALTER TABLE entries
      ADD CONSTRAINT entries_kind_check
      CHECK (kind IN ('anime', 'manga', 'movie', 'tv'));
  `;
  await db`
    ALTER TABLE entries ADD COLUMN IF NOT EXISTS tmdb_id INTEGER;
  `;
  await db`
    ALTER TABLE entries ADD COLUMN IF NOT EXISTS trakt_id INTEGER;
  `;
  await db`
    CREATE TABLE IF NOT EXISTS trakt_tokens (
      user_id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  // One-time normalization: user keys are now lowercase emails
  // (see src/lib/current-user.ts), so fold any legacy mixed-case keys.
  await db`
    UPDATE entries SET user_id = LOWER(user_id)
    WHERE user_id LIKE '%@%' AND user_id <> LOWER(user_id);
  `;
  await db`
    UPDATE trakt_tokens SET user_id = LOWER(user_id), updated_at = NOW()
    WHERE user_id LIKE '%@%' AND user_id <> LOWER(user_id)
    AND NOT EXISTS (
      SELECT 1 FROM trakt_tokens t2 WHERE t2.user_id = LOWER(trakt_tokens.user_id)
    );
  `;
  ensured = true;
  return true;
}

function toEntry(row: Record<string, unknown>): Entry {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    kind: row.kind as MediaKind,
    title: String(row.title),
    coverUrl: (row.cover_url as string | null) ?? null,
    status: row.status as EntryStatus,
    progress: Number(row.progress),
    total: row.total == null ? null : Number(row.total),
    score: row.score == null ? null : Number(row.score),
    notes: (row.notes as string | null) ?? null,
    tmdbId: row.tmdb_id == null ? null : Number(row.tmdb_id),
    traktId: row.trakt_id == null ? null : Number(row.trakt_id),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

export async function listEntries(
  userId: string,
  kind?: MediaKind,
): Promise<Entry[] | null> {
  const db = client();
  if (!db) return null;
  await ensureSchema();
  const rows = kind
    ? await db`SELECT * FROM entries WHERE user_id = ${userId} AND kind = ${kind} ORDER BY updated_at DESC`
    : await db`SELECT * FROM entries WHERE user_id = ${userId} ORDER BY updated_at DESC`;
  return rows.map(toEntry);
}

export async function upsertEntry(
  userId: string,
  data: Omit<Entry, "userId" | "updatedAt" | "id"> & { id?: string },
): Promise<Entry | null> {
  const db = client();
  if (!db) return null;
  await ensureSchema();
  const id =
    data.id ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const rows = await db`
    INSERT INTO entries (id, user_id, kind, title, cover_url, status, progress, total, score, notes, tmdb_id, trakt_id, updated_at)
    VALUES (${id}, ${userId}, ${data.kind}, ${data.title}, ${data.coverUrl}, ${data.status}, ${data.progress}, ${data.total}, ${data.score}, ${data.notes}, ${data.tmdbId}, ${data.traktId}, NOW())
    ON CONFLICT (id) DO UPDATE SET
      kind = EXCLUDED.kind, title = EXCLUDED.title, cover_url = EXCLUDED.cover_url,
      status = EXCLUDED.status, progress = EXCLUDED.progress, total = EXCLUDED.total,
      score = EXCLUDED.score, notes = EXCLUDED.notes, tmdb_id = EXCLUDED.tmdb_id,
      trakt_id = EXCLUDED.trakt_id,
      updated_at = NOW()
    RETURNING *;
  `;
  return toEntry(rows[0] as Record<string, unknown>);
}

export async function deleteEntry(
  userId: string,
  id: string,
): Promise<boolean | null> {
  const db = client();
  if (!db) return null;
  await ensureSchema();
  const rows =
    await db`DELETE FROM entries WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
  return rows.length > 0;
}

export async function statsFor(
  userId: string,
): Promise<{ movies: number; tv: number; completed: number } | null> {
  const db = client();
  if (!db) return null;
  await ensureSchema();
  const rows = await db`
    SELECT
      COUNT(*) FILTER (WHERE kind = 'movie') AS movies,
      COUNT(*) FILTER (WHERE kind = 'tv') AS tv,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed
    FROM entries WHERE user_id = ${userId};
  `;
  const r = rows[0] as Record<string, unknown>;
  return {
    movies: Number(r.movies),
    tv: Number(r.tv),
    completed: Number(r.completed),
  };
}

export async function saveTraktToken(
  userId: string,
  accessToken: string,
  refreshToken?: string | null,
): Promise<boolean> {
  const db = client();
  if (!db) return false;
  await ensureSchema();
  await db`
    INSERT INTO trakt_tokens (user_id, access_token, refresh_token, updated_at)
    VALUES (${userId}, ${accessToken}, ${refreshToken ?? null}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token, updated_at = NOW();
  `;
  return true;
}

export async function getTraktToken(
  userId: string,
): Promise<{ accessToken: string; refreshToken: string | null } | null> {
  const db = client();
  if (!db) return null;
  await ensureSchema();
  const rows =
    await db`SELECT access_token, refresh_token FROM trakt_tokens WHERE user_id = ${userId} LIMIT 1`;
  if (rows.length === 0) return null;
  const r = rows[0] as Record<string, unknown>;
  return {
    accessToken: String(r.access_token),
    refreshToken: (r.refresh_token as string | null) ?? null,
  };
}

export async function deleteTraktToken(userId: string): Promise<boolean> {
  const db = client();
  if (!db) return false;
  await ensureSchema();
  await db`DELETE FROM trakt_tokens WHERE user_id = ${userId}`;
  return true;
}
