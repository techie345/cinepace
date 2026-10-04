import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isDbConfigured } from "@/lib/db";
import { buildAuthorizeUrl, getTraktRedirectUri } from "@/features/sync/trakt-sync";

// GET /api/trakt/auth — redirect the signed-in user to Trakt OAuth.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDbConfigured())
    return NextResponse.json(
      { error: "Database required — connect Neon to store Trakt tokens." },
      { status: 503 },
    );
  const clientId = process.env.TRAKT_CLIENT_ID;
  if (!clientId)
    return NextResponse.json(
      { error: "Missing TRAKT_CLIENT_ID — create an app at trakt.tv/oauth/applications." },
      { status: 500 },
    );
  const redirectUri = getTraktRedirectUri(req);
  return NextResponse.redirect(buildAuthorizeUrl({ clientId, redirectUri }));
}
