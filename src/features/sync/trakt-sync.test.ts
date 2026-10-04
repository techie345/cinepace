import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildAuthorizeUrl,
  pullViewerLists,
  pushEntryToTrakt,
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
  it("points at Trakt OAuth with code flow", () => {
    const url = new URL(
      buildAuthorizeUrl({ clientId: "abc", redirectUri: "http://x/cb" }),
    );
    expect(url.origin + url.pathname).toBe("https://trakt.tv/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("abc");
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
