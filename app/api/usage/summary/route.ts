import { NextRequest, NextResponse } from "next/server";
import { getUsageSummary } from "@/lib/usage";

export const dynamic = "force-dynamic";

/**
 * GET /api/usage/summary?days=30&refresh=1
 *
 * Aggregated token usage per day + totals + per-model breakdown.
 * `refresh=1` forces a full re-scan of session files (backfill).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const days = Number(params.get("days")) || 30;
  const forceBackfill = params.get("refresh") === "1";
  const summary = await getUsageSummary({ days, forceBackfill });
  return NextResponse.json(summary);
}
