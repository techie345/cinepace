import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildAuthorizeUrl,
  createPkcePair,
  exchangeCodeForToken,
  getRequestCookie,
  pullViewerLists,
  pushEntryToTrakt,
  toCodeChallenge,
  toTraktIds,
  toTraktRating,
  traktHome,
} from "./trakt-sync";

afterEach(() => vi.unstubAllGlobals());

describe("traktHome", () => {
  it("maps local status to the Trakt list that owns it", () => {
    expect(traktHome("plan_to_watch", "movie")).toBe("watchlist");
    expect(traktHome("plan_to_watch", "tv")).toBe("watchlist");
    expect(traktHome("completed", "movie")).toBe("history");
    expect(traktHome("completed", "tv")).toBe("episodes");
    expect(traktHome("watching", "tv")).toBe("episodes");
    expect(traktHome("watching", "movie")).toBe("history");
    expect(traktHome("dropped", "movie")).toBe("nowhere");
    expect(traktHome("on_hold", "tv")).toBe("nowhere");
  });
});

describe("toTraktRating", () => {
  it("passes 1-10 through, null stays null", () => {
    expect(toTraktRating(8)).toBe(8);
    expect(toTraktRating(null)).toBeNull();
    expect(() => toTraktRating(0)).toThrow("out of range");
    expect(() => toTraktRating(11)).toThrow("out of range");
  });
});

describe("toTraktIds", () => {
  it("prefers Trakt ids and falls back to TMDB", () => {
    expect(toTraktIds({ traktId: 1, tmdbId: 2 })).toEqual({
      trakt: 1,
      tmdb: 2,
    });
    expect(toTraktIds({ traktId: null, tmdbId: 2 })).toEqual({ tmdb: 2 });
  });

  it("throws when no remote id is known", () => {
    expect(() => toTraktIds({ traktId: null, tmdbId: null })).toThrow(
      "no Trakt or TMDB id",
    );
  });
});

describe("buildAuthorizeUrl", () => {
  it("points at Trakt OAuth with code flow + PKCE S256", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "abc",
        redirectUri: "http://x/cb",
        codeChallenge: "CHALLENGE",
      }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://auth.trakt.tv/oauth/authorize",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("abc");
    expect(url.searchParams.get("code_challenge")).toBe("CHALLENGE");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("PKCE", () => {
  it("derives the RFC 7636 Appendix B challenge", async () => {
    await expect(
      toCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    ).resolves.toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("generates a 43-char verifier whose challenge round-trips", async () => {
    const { verifier, challenge } = await createPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(toCodeChallenge(verifier)).resolves.toBe(challenge);
  });
});

describe("getRequestCookie", () => {
  it("reads the named cookie out of the Cookie header", () => {
    const req = new Request("http://x/api/trakt/callback?code=abc", {
      headers: { cookie: "other=1; trakt_pkce_verifier=VER123; x=2" },
    });
    expect(getRequestCookie(req, "trakt_pkce_verifier")).toBe("VER123");
    expect(getRequestCookie(req, "missing")).toBeNull();
  });
});

describe("exchangeCodeForToken", () => {
  it("sends code_verifier and no client_secret (PKCE)", async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        body = JSON.parse(String(init.body));
        return okJson({ access_token: "tok" });
      }),
    );
    await exchangeCodeForToken({
      clientId: "cid",
      redirectUri: "http://x/api/trakt/callback",
      code: "code123",
      codeVerifier: "VERIFIER",
    });
    expect(body).toMatchObject({
      code: "code123",
      client_id: "cid",
      grant_type: "authorization_code",
      code_verifier: "VERIFIER",
    });
    expect(body).not.toHaveProperty("client_secret");
  });
});

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => "" };
}

describe("pushEntryToTrakt", () => {
  it("adds planned movies to the watchlist + rating", async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        return okJson({});
      }),
    );
    const res = await pushEntryToTrakt("tok", "cid", {
      kind: "movie",
      status: "plan_to_watch",
      score: 9,
      traktId: null,
      tmdbId: 27205,
    });
    expect(res.touched).toContain("watchlist");
    expect(res.touched).toContain("ratings");
    expect(calls[0].url).toBe("https://api.trakt.tv/sync/watchlist");
    expect(calls[0].body).toEqual({ movies: [{ ids: { tmdb: 27205 } }] });
    const headers = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers as Record<string, string>;
    expect(headers["trakt-api-key"]).toBe("cid");
    expect(headers["Authorization"]).toBe("Bearer tok");
  });

  it("logs completed movies to history, not the watchlist", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        urls.push(url);
        return okJson({});
      }),
    );
    await pushEntryToTrakt("tok", "cid", {
      kind: "movie",
      status: "completed",
      score: null,
      traktId: 10,
      tmdbId: null,
    });
    expect(urls).toContain("https://api.trakt.tv/sync/watchlist/remove");
    expect(urls).toContain("https://api.trakt.tv/sync/history");
    expect(urls).not.toContain("https://api.trakt.tv/sync/watchlist");
  });
});

describe("pullViewerLists", () => {
  it("merges watchlist, watched and ratings", async () => {
    const routes: Record<string, unknown> = {
      "/sync/watchlist": [
        { type: "movie", movie: { title: "Dune", ids: { tmdb: 155 } } },
        { type: "show", show: { title: "Severance", ids: { trakt: 145 } } },
      ],
      "/sync/watched/movies": [
        { movie: { title: "Dune 2", ids: { tmdb: 693 } }, plays: 1 },
      ],
      "/sync/watched/shows": [
        {
          show: { title: "Severance", ids: { trakt: 145 }, aired_episodes: 19 },
          episodes: [{}, {}, {}],
        },
      ],
      "/sync/ratings/movies": [
        { movie: { title: "Dune 2", ids: { tmdb: 693 } }, rating: 9 },
      ],
      "/sync/ratings/shows": [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        const path = url.replace("https://api.trakt.tv", "");
        return okJson(routes[path] ?? []);
      }),
    );
    const { movies, shows } = await pullViewerLists("tok", "cid");
    expect(movies).toHaveLength(2);
    expect(
      movies.find((m) => m.title === "Dune"),
    ).toMatchObject({ status: "plan_to_watch", tmdbId: 155, score: null });
    expect(
      movies.find((m) => m.title === "Dune 2"),
    ).toMatchObject({ status: "completed", score: 9 });
    expect(shows).toHaveLength(2);
    expect(
      shows.find((s) => s.progress === 3),
    ).toMatchObject({ status: "watching", total: 19 });
  });
});
