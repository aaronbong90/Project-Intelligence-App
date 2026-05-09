import { NextResponse } from "next/server";
import { MASTER_ADMIN_EMAIL, normalizeRole } from "@/lib/auth";
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

export async function DELETE(_request: Request, { params }: Params) {
  const { viewer, isAllowed } = await getAdminViewerContext();

  if (!viewer || !isAllowed || (viewer.role !== "master_admin" && viewer.role !== "client")) {
    return NextResponse.json({ error: "You do not have permission to delete user accounts." }, { status: 403 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase service credentials are missing." }, { status: 500 });
  }

  const { userId } = await params;

  if (!userId || userId === viewer.id) {
    return NextResponse.json({ error: "You cannot delete your own signed-in account." }, { status: 400 });
  }

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

  if (!targetProfile?.id) {
    return NextResponse.json({ error: "The selected user could not be found." }, { status: 404 });
  }

  const targetRole = normalizeRole(targetProfile.role);
  const targetEmail = targetProfile.email ?? "the selected user";

  if (targetRole === "master_admin" || targetEmail.toLowerCase() === MASTER_ADMIN_EMAIL.toLowerCase()) {
    return NextResponse.json({ error: "The master admin account cannot be deleted from Settings." }, { status: 403 });
  }

  if (viewer.role === "client") {
    if (fallbackTargetProfileResponse || targetRole === "client" || targetProfile.client_owner_id !== viewer.id) {
      return NextResponse.json({ error: "You can only delete contractor, subcontractor, or consultant users in your own directory." }, { status: 403 });
    }
  }

  const { data: ownedProjectsData, error: ownedProjectsError } = await admin
    .from("projects")
    .select("id, name")
    .eq("owner_id", userId)
    .limit(1);

  if (ownedProjectsError) {
    return NextResponse.json({ error: ownedProjectsError.message }, { status: 400 });
  }

  const ownedProjects = ownedProjectsData ?? [];

  if (ownedProjects.length) {
    return NextResponse.json(
      {
        error: `Transfer or remove ${ownedProjects[0]?.name ?? "this user's project"} before deleting this account.`
      },
      { status: 400 }
    );
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 400 });
  }

  return NextResponse.json({
    message: `Deleted ${targetEmail}.`
  });
}
