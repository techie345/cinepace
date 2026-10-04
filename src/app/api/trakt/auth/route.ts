import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isDbConfigured } from "@/lib/db";
import {
  buildAuthorizeUrl,
  createPkcePair,
  getTraktRedirectUri,
  TRAKT_PKCE_COOKIE,
  TRAKT_PKCE_COOKIE_PATH,
} from "@/features/sync/trakt-sync";

// GET /api/trakt/auth — redirect the signed-in user to Trakt OAuth (PKCE,
// no client secret: the verifier travels in a short-lived httpOnly cookie).
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
  const { verifier, challenge } = await createPkcePair();
  const res = NextResponse.redirect(
    buildAuthorizeUrl({ clientId, redirectUri, codeChallenge: challenge }),
  );
  res.cookies.set(TRAKT_PKCE_COOKIE, verifier, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: TRAKT_PKCE_COOKIE_PATH,
  });
  return res;
}
