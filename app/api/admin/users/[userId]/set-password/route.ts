import { NextResponse, type NextRequest } from "next/server";
import { getAdminViewerContext } from "@/lib/admin-access";
import { createAdminClient } from "@/lib/supabase/admin";

type Params = {
  params: Promise<{
    userId: string;
  }>;
};

export async function POST(request: NextRequest, { params }: Params) {
  const { viewer, isAllowed } = await getAdminViewerContext();

  if (!viewer || !isAllowed || viewer.role !== "master_admin") {
    return NextResponse.json({ error: "You do not have permission to override account passwords directly." }, { status: 403 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase service credentials are missing." }, { status: 500 });
  }

  const { userId } = await params;
  const payload = (await request.json()) as {
    password?: string;
  };
  const password = String(payload.password ?? "");

  if (password.length < 8) {
    return NextResponse.json({ error: "Use at least 8 characters for the override password." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: targetProfile, error: targetError } = await admin
    .from("profiles")
    .select("id, email")
    .eq("id", userId)
    .maybeSingle();

  if (targetError) {
    return NextResponse.json({ error: targetError.message }, { status: 400 });
  }

  if (!targetProfile?.id) {
    return NextResponse.json({ error: "The selected user could not be found." }, { status: 404 });
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    password
  });

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({
    message: `Password override saved for ${targetProfile.email ?? "the selected user"}.`
  });
}
