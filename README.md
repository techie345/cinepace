# CinePace — Movie & TV Tracker (fork of AniPace)

Full-stack tracking app built on **Next.js 16** (App Router), **Auth.js v5**
GitHub + Discord login, and **Trakt** upstream for watch history/sync with
**TMDB** metadata/posters. Deploys to Vercel.

> Forked from `anipace` (Anime & Manga Tracker, AniList upstream).
> Auth (`src/auth.ts` — GitHub + Discord) is unchanged.
> AniList code under `src/features/discovery/anilist.*`, `src/features/sync/anilist-*`,
> `src/app/api/anilist/*` is the migration source — being replaced by TMDB + Trakt.

## Upstream map (AniList → Trakt/TMDB)

- Search/metadata: AniList GraphQL → TMDB (`/api/tmdb/search`, `src/features/discovery/tmdb.ts` — TODO)
- 2-way sync: AniList OAuth → Trakt OAuth (`/api/trakt/*`, `src/features/sync/trakt-*` — TODO)
- Lists: anime/manga → movies/tv (`src/lib/db.ts` MediaKind — TODO)
- Storage: browser localStorage now (`cinepace:entries:v1`); Neon Postgres when `DATABASE_URL` set

## Local dev

```bash
npm install
cp .env.example .env.local   # fill in GitHub/Discord OAuth credentials + TMDB key + Trakt app
npm run dev
npm test
```

GitHub OAuth app: https://github.com/settings/developers → New OAuth App.
Callback URL: `http://localhost:3000/api/auth/callback/github`.
Discord app: https://discord.com/developers/applications → OAuth2 → Redirects.
Add `http://localhost:3000/api/auth/callback/discord` (scopes: identify, email).
TMDB: https://www.themoviedb.org/settings/api → API Key.
Trakt: https://trakt.tv/oauth/applications → New Application.
Redirect URL: `http://localhost:3000/api/trakt/callback`.
Generate `AUTH_SECRET` with `npx auth secret`.

## Deploy on Vercel

```bash
vercel link
vercel env pull .env.local
```

Set env vars in Dashboard → Project → Settings → Environment Variables:

- `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`
- `AUTH_DISCORD_ID`, `AUTH_DISCORD_SECRET`
- `TMDB_API_KEY`
- `TRAKT_CLIENT_ID`, `TRAKT_CLIENT_SECRET`
- `AUTH_SECRET`
- `AUTH_TRUST_HOST=true` is set in code via `trustHost`
