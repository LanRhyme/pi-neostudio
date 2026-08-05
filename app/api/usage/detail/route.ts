import { NextRequest, NextResponse } from "next/server";
import { getUsageDetail } from "@/lib/usage";

export const dynamic = "force-dynamic";

/**
 * GET /api/usage/detail?day=YYYY-MM-DD
 *
 * Per-call usage records for one calendar day (local timezone),
 * sorted by timestamp ascending.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const day = request.nextUrl.searchParams.get("day");
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return NextResponse.json({ error: "Invalid day, expected YYYY-MM-DD" }, { status: 400 });
  }
  return NextResponse.json(await getUsageDetail(day));
}
