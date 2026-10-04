import { describe, it, expect, vi, afterEach } from "vitest";
import {
  genreNames,
  posterUrl,
  releaseYear,
  searchMovies,
  searchShows,
} from "./tmdb";

afterEach(() => vi.unstubAllGlobals());

describe("posterUrl", () => {
  it("builds the w500 image URL or null", () => {
    expect(posterUrl("/abc.jpg")).toBe(
      "https://image.tmdb.org/t/p/w500/abc.jpg",
    );
    expect(posterUrl(null)).toBeNull();
  });
});

describe("releaseYear", () => {
  it("parses the year from an ISO date", () => {
    expect(releaseYear("2024-03-01")).toBe(2024);
    expect(releaseYear(null)).toBeNull();
    expect(releaseYear("")).toBeNull();
  });
});

describe("genreNames", () => {
  it("maps known TMDB ids and drops unknown ones", () => {
    expect(genreNames([28, 999999, 18])).toEqual(["Action", "Drama"]);
  });
});

describe("searchMovies / searchShows", () => {
  it("normalizes movie results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              id: 27205,
              title: "Inception",
              poster_path: "/inception.jpg",
              overview: "dreams",
              release_date: "2010-07-15",
              vote_average: 8.4,
              genre_ids: [28, 878],
            },
          ],
        }),
      }),
    );
    const results = await searchMovies("key", "inception");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: 27205,
      title: "Inception",
      coverUrl: "https://image.tmdb.org/t/p/w500/inception.jpg",
      year: 2010,
      score: 8.4,
      genres: ["Action", "Sci-Fi"],
      siteUrl: "https://www.themoviedb.org/movie/27205",
    });
    const url = String((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain("/search/movie");
  });

  it("normalizes tv results via name/first_air_date", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              id: 1396,
              name: "Breaking Bad",
              poster_path: null,
              overview: "chemistry",
              first_air_date: "2008-01-20",
              vote_average: 9.5,
              genre_ids: [18],
            },
          ],
        }),
      }),
    );
    const results = await searchShows("key", "breaking bad");
    expect(results[0]).toMatchObject({
      id: 1396,
      title: "Breaking Bad",
      coverUrl: null,
      year: 2008,
      siteUrl: "https://www.themoviedb.org/tv/1396",
    });
  });

  it("throws on TMDB errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401 }),
    );
    await expect(searchMovies("bad", "x")).rejects.toThrow("TMDB error: 401");
  });
});
