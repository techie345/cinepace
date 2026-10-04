import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EntryCard, statusLabel } from "./EntryCard";
import type { Entry } from "@/lib/db";

const base: Entry = {
  id: "1",
  userId: "u",
  kind: "movie",
  title: "Dune",
  coverUrl: null,
  status: "watching",
  progress: 1,
  total: 1,
  score: 8,
  notes: "great",
  tmdbId: 155,
  traktId: null,
  updatedAt: new Date().toISOString(),
};

describe("statusLabel", () => {
  it("maps known statuses and passes through unknown", () => {
    expect(statusLabel("watching")).toBe("Watching");
    expect(statusLabel("plan_to_watch")).toBe("Plan to watch");
    expect(statusLabel("weird" as never)).toBe("weird");
  });
});

describe("EntryCard", () => {
  it("renders title, progress, score and TMDB link", () => {
    render(<EntryCard entry={base} onEdit={() => {}} onDelete={() => {}} />);
    expect(screen.getByText("Dune")).toBeInTheDocument();
    expect(screen.getByText(/1.*1/)).toBeInTheDocument();
    expect(screen.getByText(/8\/10/)).toBeInTheDocument();
    expect(screen.getByText("TMDB ↗")).toHaveAttribute(
      "href",
      "https://www.themoviedb.org/movie/155",
    );
  });

  it("links tv entries to TMDB tv pages", () => {
    render(
      <EntryCard
        entry={{ ...base, kind: "tv", title: "Severance", tmdbId: 888 }}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByText("TMDB ↗")).toHaveAttribute(
      "href",
      "https://www.themoviedb.org/tv/888",
    );
  });

  it("calls onEdit and onDelete", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(<EntryCard entry={base} onEdit={onEdit} onDelete={onDelete} />);
    await user.click(screen.getByText("Edit"));
    await user.click(screen.getByText("Remove"));
    expect(onEdit).toHaveBeenCalledWith(base);
    expect(onDelete).toHaveBeenCalledWith("1");
  });
});
