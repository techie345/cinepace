import { redirect } from "next/navigation";
import { auth } from "@/auth";
import ListPage from "@/features/tracking/ListPage";

export default async function MoviesPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  return <ListPage kind="movie" title="Movies" />;
}
