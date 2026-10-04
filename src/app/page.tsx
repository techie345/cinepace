import { redirect } from "next/navigation";
import { auth } from "@/auth";

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-2xl py-16 text-center">
      <h1 className="text-4xl font-bold tracking-tight">
        Cine<span className="text-indigo-400">Pace</span>
      </h1>
      <p className="mt-4 text-lg text-zinc-400">
        Track your movies and TV shows at your own pace. Keep lists, score
        what you finish, and sync with Trakt.
      </p>
      <ul className="mx-auto mt-8 max-w-md space-y-2 text-left text-sm text-zinc-300">
        <li className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
          📊 Dashboard with stats across movies &amp; TV
        </li>
        <li className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
          📚 Separate movie and TV lists with statuses &amp; scores
        </li>
        <li className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
          🔍 Search TMDB and 2-way sync with Trakt
        </li>
      </ul>
      <p className="mt-8 text-sm text-zinc-400">
        Sign in above with GitHub or Discord to start tracking.
      </p>
    </div>
  );
}
