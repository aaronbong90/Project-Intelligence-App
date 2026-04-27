import { NextResponse } from "next/server";
import { getProjectDashboardData } from "@/lib/projects";
import { getCurrentDateSnapshot } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { projects, viewer } = await getProjectDashboardData();
    const isConfigured = Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    if (isConfigured && !viewer) {
      return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    }

    return NextResponse.json({
      projects,
      viewer,
      isConfigured,
      todaySnapshot: getCurrentDateSnapshot()
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load dashboard data."
      },
      { status: 500 }
    );
  }
}
