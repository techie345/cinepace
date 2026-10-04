import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isDbConfigured, saveTraktToken } from "@/lib/db";
import { userKey } from "@/lib/current-user";
import {
  exchangeCodeForToken,
  getTraktRedirectUri,
} from "@/features/sync/trakt-sync";

// Shared Trakt OAuth callback: exchange ?code= for tokens, store them, redirect.
export async function handleTraktCallback(req: Request) {
  const session = await auth();
  const uid = session?.user ? userKey(session) : null;
  if (!uid) return NextResponse.redirect(new URL("/?error=signin", req.url));
  const code = new URL(req.url).searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/search?trakt=error", req.url));
  if (!isDbConfigured())
    return NextResponse.redirect(new URL("/search?trakt=nodb", req.url));

  const { TRAKT_CLIENT_ID: clientId, TRAKT_CLIENT_SECRET: clientSecret } =
    process.env;
  if (!clientId || !clientSecret)
    return NextResponse.redirect(new URL("/search?trakt=misconfigured", req.url));

  try {
    const token = await exchangeCodeForToken({
      clientId,
      clientSecret,
      redirectUri: getTraktRedirectUri(req),
      code,
    });
    await saveTraktToken(uid, token.access_token, token.refresh_token ?? null);
    return NextResponse.redirect(new URL("/search?trakt=connected", req.url));
  } catch {
    return NextResponse.redirect(new URL("/search?trakt=error", req.url));
  }
}
