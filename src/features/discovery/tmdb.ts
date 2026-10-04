// TMDB search/metadata (https://developer.themoviedb.org). Needs an API key
// (v3 key or v4 read token) — kept server-side, see /api/tmdb/search.

export interface TmdbMedia {
  id: number;
  title: string;
  posterPath: string | null;
  overview: string | null;
  releaseDate: string | null; // "2024-03-01" or null
  voteAverage: number | null; // 0-10
  genreIds: number[];
}

export interface TmdbResult extends TmdbMedia {
  coverUrl: string | null;
  year: number | null;
  score: number | null; // 0-10 rounded
  genres: string[];
  siteUrl: string | null;
}

export function posterUrl(path: string | null): string | null {
  return path ? `https://image.tmdb.org/t/p/w500${path}` : null;
}

export function releaseYear(releaseDate: string | null): number | null {
  if (!releaseDate) return null;
  const y = Number(releaseDate.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

const GENRE_NAMES: Record<number, string> = {
  28: "Action",
  12: "Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  14: "Fantasy",
  36: "History",
  27: "Horror",
  10402: "Music",
  9648: "Mystery",
  10749: "Romance",
  878: "Sci-Fi",
  10770: "TV Movie",
  53: "Thriller",
  10752: "War",
  37: "Western",
  10759: "Action & Adventure",
  10762: "Kids",
  10763: "News",
  10764: "Reality",
  10765: "Sci-Fi & Fantasy",
  10766: "Soap",
  10767: "Talk",
  10768: "War & Politics",
};

export function genreNames(ids: number[]): string[] {
  return ids
    .map((id) => GENRE_NAMES[id])
    .filter((g): g is string => Boolean(g));
}

function toResult(
  kind: "movie" | "tv",
  m: TmdbMedia,
): TmdbResult {
  return {
    ...m,
    coverUrl: posterUrl(m.posterPath),
    year: releaseYear(m.releaseDate),
    score: m.voteAverage == null ? null : Math.round(m.voteAverage * 10) / 10,
    genres: genreNames(m.genreIds),
    siteUrl: `https://www.themoviedb.org/${kind}/${m.id}`,
  };
}

interface TmdbSearchResponse {
  results?: {
    id: number;
    title?: string;
    name?: string;
    poster_path?: string | null;
    overview?: string | null;
    release_date?: string | null;
    first_air_date?: string | null;
    vote_average?: number | null;
    genre_ids?: number[];
  }[];
}

async function search(
  apiKey: string,
  kind: "movie" | "tv",
  query: string,
): Promise<TmdbResult[]> {
  const url =
    `https://api.themoviedb.org/3/search/${kind}` +
    `?api_key=${encodeURIComponent(apiKey)}&language=en-US&include_adult=false&page=1` +
    `&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`TMDB error: ${res.status}`);
  const json = (await res.json()) as TmdbSearchResponse;
  return (json.results ?? []).map((r) =>
    toResult(kind, {
      id: r.id,
      title: r.title ?? r.name ?? "Unknown title",
      posterPath: r.poster_path ?? null,
      overview: r.overview ?? null,
      releaseDate: r.release_date ?? r.first_air_date ?? null,
      voteAverage: r.vote_average ?? null,
      genreIds: r.genre_ids ?? [],
    }),
  );
}

export function searchMovies(apiKey: string, query: string) {
  return search(apiKey, "movie", query);
}

export function searchShows(apiKey: string, query: string) {
  return search(apiKey, "tv", query);
}
