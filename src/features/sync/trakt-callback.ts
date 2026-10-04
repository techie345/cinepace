import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isDbConfigured, saveTraktToken } from "@/lib/db";
import { userKey } from "@/lib/current-user";
import {
  exchangeCodeForToken,
  getRequestCookie,
  getTraktRedirectUri,
  TRAKT_PKCE_COOKIE,
  TRAKT_PKCE_COOKIE_PATH,
} from "@/features/sync/trakt-sync";

// Shared Trakt OAuth callback: exchange ?code= for tokens (PKCE verifier
// from the auth-step cookie — no client secret), store them, redirect.
export async function handleTraktCallback(req: Request) {
  const session = await auth();
  const uid = session?.user ? userKey(session) : null;
  if (!uid) return NextResponse.redirect(new URL("/?error=signin", req.url));
  const code = new URL(req.url).searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/search?trakt=error", req.url));
  if (!isDbConfigured())
    return NextResponse.redirect(new URL("/search?trakt=nodb", req.url));

  const clientId = process.env.TRAKT_CLIENT_ID;
  if (!clientId)
    return NextResponse.redirect(new URL("/search?trakt=misconfigured", req.url));
  const verifier = getRequestCookie(req, TRAKT_PKCE_COOKIE);
  if (!verifier) {
    console.error("[trakt] callback missing PKCE verifier cookie");
    return NextResponse.redirect(new URL("/search?trakt=error", req.url));
  }

  let token;
  try {
    token = await exchangeCodeForToken({
      clientId,
      redirectUri: getTraktRedirectUri(req),
      code,
      codeVerifier: verifier,
    });
  } catch (e) {
    console.error(
      "[trakt] token exchange failed:",
      e instanceof Error ? e.message : e,
    );
    return NextResponse.redirect(new URL("/search?trakt=error", req.url));
  }
  try {
    await saveTraktToken(uid, token.access_token, token.refresh_token ?? null);
  } catch (e) {
    console.error(
      "[trakt] token save failed:",
      e instanceof Error ? e.message : e,
    );
    return NextResponse.redirect(new URL("/search?trakt=error", req.url));
  }
  const done = NextResponse.redirect(
    new URL("/search?trakt=connected", req.url),
  );
  done.cookies.set(TRAKT_PKCE_COOKIE, "", {
    maxAge: 0,
    path: TRAKT_PKCE_COOKIE_PATH,
  });
  return done;
}
