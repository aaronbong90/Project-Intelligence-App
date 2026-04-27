import { NextResponse, type NextRequest } from "next/server";
import { normalizeRole } from "@/lib/auth";
import { getAdminViewerContext } from "@/lib/admin-access";
import { createAdminClient } from "@/lib/supabase/admin";

type Params = {
  params: Promise<{
    userId: string;
  }>;
};

function isMissingProfileDirectoryColumnsError(error: { message?: string | null } | null | undefined) {
  const message = error?.message ?? "";
  return message.includes("profiles.client_owner_id");
}

export async function POST(request: NextRequest, { params }: Params) {
  const { viewer, isAllowed } = await getAdminViewerContext();

  if (!viewer || !isAllowed) {
    return NextResponse.json({ error: "Sign in with an allowed admin account first." }, { status: 403 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase service credentials are missing." }, { status: 500 });
  }

  const { userId } = await params;
  const admin = createAdminClient();
  const targetProfileResponse = await admin
    .from("profiles")
    .select("id, email, role, client_owner_id")
    .eq("id", userId)
    .maybeSingle();

  const fallbackTargetProfileResponse = isMissingProfileDirectoryColumnsError(targetProfileResponse.error)
    ? await admin.from("profiles").select("id, email, role").eq("id", userId).maybeSingle()
    : null;

  const targetProfile = (fallbackTargetProfileResponse?.data ?? targetProfileResponse.data) as
    | {
        id: string;
        email: string | null;
        role: string | null;
        client_owner_id?: string | null;
      }
    | null;
  const targetError = fallbackTargetProfileResponse?.error ?? targetProfileResponse.error;

  if (targetError) {
    return NextResponse.json({ error: targetError.message }, { status: 400 });
  }

  if (!targetProfile?.email) {
    return NextResponse.json({ error: "The selected user could not be found." }, { status: 404 });
  }

  const targetRole = normalizeRole(targetProfile.role);
  const targetClientOwnerId =
    targetRole === "client"
      ? targetProfile.id
      : fallbackTargetProfileResponse
        ? null
        : targetProfile.client_owner_id;
  const canReset =
    viewer.role === "master_admin" ||
    viewer.id === targetProfile.id ||
    (!fallbackTargetProfileResponse && viewer.role === "client" && targetClientOwnerId === viewer.id);

  if (!canReset) {
    return NextResponse.json({ error: "You can only send reset emails to your own client directory users." }, { status: 403 });
  }

  if (viewer.role !== "master_admin" && targetRole === "master_admin") {
    return NextResponse.json({ error: "You do not have permission to reset this account." }, { status: 403 });
  }

  const redirectTo = new URL("/auth/update-password", request.url).toString();
  const { error: resetError } = await admin.auth.resetPasswordForEmail(targetProfile.email, {
    redirectTo
  });

  if (resetError) {
    return NextResponse.json({ error: resetError.message }, { status: 400 });
  }

  return NextResponse.json({
    message: `Password reset email sent to ${targetProfile.email}.`
  });
}
