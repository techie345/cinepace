import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { statsFor } from "@/lib/db";
import { userKey } from "@/lib/current-user";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const uid = userKey(session);
  const stats = await statsFor(uid).catch(() => null);

  const cards = [
    { href: "/movies", title: "Movies", desc: "What you're watching & planning", count: stats?.movies },
    { href: "/tv", title: "TV shows", desc: "Series you're following & planning", count: stats?.tv },
    { href: "/search", title: "Search & import", desc: "Find titles on TMDB or import from Trakt" },
    { href: "/profile", title: "Profile", desc: "Your account & storage info" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">
          Welcome{session.user.name ? `, ${session.user.name}` : ""} 👋
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          {stats
            ? `You have ${stats.movies} movies and ${stats.tv} shows tracked (${stats.completed} completed).`
            : "Your lists live in this browser for now — add a database later to sync everywhere."}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 hover:border-indigo-500"
          >
            <div className="flex items-baseline justify-between">
              <h2 className="font-medium">{c.title}</h2>
              {c.count != null && (
                <span className="text-2xl font-bold text-indigo-400">{c.count}</span>
              )}
            </div>
            <p className="mt-1 text-sm text-zinc-400">{c.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
