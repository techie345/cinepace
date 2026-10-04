import { describe, it, expect } from "vitest";
import {
  exportFilename,
  serializeExport,
  toExportCsv,
  toExportJson,
} from "./export-entries";
import type { Entry } from "@/lib/db";

function entry(overrides: Partial<Entry> & { id: string }): Entry {
  return {
    userId: "u",
    kind: "movie",
    title: "T",
    coverUrl: null,
    status: "plan_to_watch",
    progress: 0,
    total: null,
    score: null,
    notes: null,
    tmdbId: null,
    traktId: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const anime = entry({
  id: "a1",
  kind: "anime" as unknown as Entry["kind"],
  title: "Should not export",
  status: "completed",
});

const movie = entry({
  id: "m1",
  title: 'Dune: Part "Two", extended',
  status: "completed",
  progress: 1,
  total: 1,
  score: 9,
  notes: "line1\nline2",
  tmdbId: 693,
  traktId: 10,
});

describe("export serializers", () => {
  it("excludes sibling-app rows from JSON", () => {
    const rows = JSON.parse(toExportJson([anime, movie])) as Array<{
      title: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toContain("Dune");
    expect(rows[0]).not.toHaveProperty("userId");
    expect(rows[0]).not.toHaveProperty("id");
  });

  it("writes a header + escaped CSV rows, excluding sibling rows", () => {
    const csv = toExportCsv([anime, movie]);
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe(
      "title,kind,status,progress,total,score,notes,tmdb_id,trakt_id,updated_at",
    );
    // The multiline note spans two physical lines inside one quoted field.
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"Dune: Part ""Two"", extended"');
    expect(csv).toContain('"line1\nline2"');
    expect(csv).not.toContain("Should not export");
  });

  it("exports an empty list as valid empty JSON/CSV", () => {
    expect(toExportJson([])).toBe("[]");
    expect(toExportCsv([])).toBe(
      "title,kind,status,progress,total,score,notes,tmdb_id,trakt_id,updated_at\n",
    );
  });

  it("names files per app and day", () => {
    expect(exportFilename("json", new Date("2026-03-04T00:00Z"))).toBe(
      "cinepace-export-2026-03-04.json",
    );
    expect(serializeExport([], "csv").contentType).toContain("text/csv");
  });
});
