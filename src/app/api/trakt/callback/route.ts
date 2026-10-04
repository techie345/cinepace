import { handleTraktCallback } from "@/features/sync/trakt-callback";

// GET /api/trakt/callback?code=... — exchange code, store tokens, redirect.
export async function GET(req: Request) {
  return handleTraktCallback(req);
}
