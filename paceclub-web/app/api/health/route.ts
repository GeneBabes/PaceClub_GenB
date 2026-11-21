import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json(
    { status: "ok", application: "PaceClub", version: "full-v1" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
