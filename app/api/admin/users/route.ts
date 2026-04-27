import { NextResponse, type NextRequest } from "next/server";
import { normalizeRole } from "@/lib/auth";
import { getAdminViewerContext } from "@/lib/admin-access";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AdminUserRecord, UserRole } from "@/types/app";

type CreateUserPayload = {
  email?: string;
  role?: UserRole;
  clientOwnerId?: string | null;
  password?: string;
};

type CompatibleProfileRow = {
  id: string;
  email: string | null;
  role: string | null;
  is_suspended: boolean | null;
  client_owner_id?: string | null;
  created_by_user_id?: string | null;
};

function isMissingProfileDirectoryColumnsError(error: { message?: string | null } | null | undefined) {
  const message = error?.message ?? "";
  return message.includes("profiles.client_owner_id") || message.includes("profiles.created_by_user_id");
}

async function fetchProfileRow(admin: ReturnType<typeof createAdminClient>, userId: string): Promise<{
  row: CompatibleProfileRow | null;
  hasDirectoryColumns: boolean;
  error: { message?: string | null } | null;
}> {
  const advanced = await admin
    .from("profiles")
    .select("id, email, role, is_suspended, client_owner_id, created_by_user_id")
    .eq("id", userId)
    .maybeSingle();

  if (isMissingProfileDirectoryColumnsError(advanced.error)) {
    const fallback = await admin.from("profiles").select("id, email, role, is_suspended").eq("id", userId).maybeSingle();
    return {
      row: (fallback.data ?? null) as CompatibleProfileRow | null,
      hasDirectoryColumns: false,
      error: fallback.error
    };
  }

  return {
    row: (advanced.data ?? null) as CompatibleProfileRow | null,
    hasDirectoryColumns: true,
    error: advanced.error
  };
}

async function ensureProfileRow(
  admin: ReturnType<typeof createAdminClient>,
  params: {
    userId: string;
    email: string;
    role: UserRole;
    viewerId: string;
    resolvedClientOwnerId: string | null;
  }
) {
  const existing = await fetchProfileRow(admin, params.userId);
  if (existing.error) {
    throw new Error(existing.error.message ?? "Unable to load the profile row.");
  }

  if (existing.row) {
    return existing;
  }

  const baseInsert = {
    id: params.userId,
    email: params.email,
    role: params.role,
    is_suspended: false
  };

  const insertPayload = existing.hasDirectoryColumns
    ? {
        ...baseInsert,
        client_owner_id: params.role === "client" ? params.userId : params.resolvedClientOwnerId,
        created_by_user_id: params.viewerId
      }
    : baseInsert;

  const insertResult = await admin.from("profiles").upsert(insertPayload).select("id").eq("id", params.userId).maybeSingle();
  if (insertResult.error && !isMissingProfileDirectoryColumnsError(insertResult.error)) {
    throw new Error(insertResult.error.message ?? "Unable to create the profile row.");
  }

  const refreshed = await fetchProfileRow(admin, params.userId);
  if (refreshed.error) {
    throw new Error(refreshed.error.message ?? "Unable to reload the profile row.");
  }

  return refreshed;
}

async function findAuthUserByEmail(admin: ReturnType<typeof createAdminClient>, email: string) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) {
    throw new Error(error.message);
  }

  return (data.users ?? []).find((user) => user.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

export async function POST(request: NextRequest) {
  const { viewer, isAllowed } = await getAdminViewerContext();

  if (!viewer || !isAllowed || (viewer.role !== "master_admin" && viewer.role !== "client")) {
    return NextResponse.json({ error: "You do not have permission to create user accounts." }, { status: 403 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase service credentials are missing." }, { status: 500 });
  }

  const payload = (await request.json()) as CreateUserPayload;
  const email = String(payload.email ?? "").trim().toLowerCase();
  const role = normalizeRole(payload.role);
  const clientOwnerId = payload.clientOwnerId ? String(payload.clientOwnerId) : null;
  const password = String(payload.password ?? "");

  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: "Use at least 8 characters for the initial password." }, { status: 400 });
  }

  if (role === "master_admin") {
    return NextResponse.json({ error: "This account role cannot be created from Settings." }, { status: 400 });
  }

  const admin = createAdminClient();
  let clientOwnerEmail: string | null = null;
  let resolvedClientOwnerId: string | null = null;

  if (viewer.role === "client") {
    if (role === "client") {
      return NextResponse.json({ error: "Client accounts can create contractor, subcontractor, or consultant users only." }, { status: 403 });
    }

    resolvedClientOwnerId = viewer.id;
    clientOwnerEmail = viewer.email;
  }

  if (viewer.role === "master_admin" && role !== "client") {
    if (!clientOwnerId) {
      return NextResponse.json({ error: "Select the client directory that should own this user account." }, { status: 400 });
    }

    const { data: clientProfile, error: clientError } = await admin
      .from("profiles")
      .select("id, email, role")
      .eq("id", clientOwnerId)
      .maybeSingle();

    if (clientError) {
      return NextResponse.json({ error: clientError.message }, { status: 400 });
    }

    if (!clientProfile || normalizeRole(clientProfile.role) !== "client") {
      return NextResponse.json({ error: "The selected client directory could not be found." }, { status: 400 });
    }

    clientOwnerEmail = clientProfile.email ?? null;
    resolvedClientOwnerId = clientProfile.id;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      role,
      client_owner_id: role === "client" ? null : resolvedClientOwnerId,
      created_by_user_id: viewer.id
    }
  });

  let userId = data.user?.id ?? null;
  let creationMessage = `Account created for ${email}. Share the initial password with that user securely.`;

  if (error) {
    if (!error.message.toLowerCase().includes("already been registered")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const existingAuthUser = await findAuthUserByEmail(admin, email);
    if (!existingAuthUser?.id) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    userId = existingAuthUser.id;
    creationMessage = `An account for ${email} already existed, so it has been linked back into Settings.`;
  }

  if (!userId) {
    return NextResponse.json({ error: "The account was created, but no user id was returned." }, { status: 500 });
  }

  const { row: profileRow, hasDirectoryColumns } = await ensureProfileRow(admin, {
    userId,
    email,
    role,
    viewerId: viewer.id,
    resolvedClientOwnerId
  });

  const nextUser: AdminUserRecord = {
    id: profileRow?.id ?? userId,
    email: profileRow?.email ?? email,
    role: normalizeRole(profileRow?.role ?? role),
    isSuspended: profileRow?.is_suspended ?? false,
    clientOwnerId:
      normalizeRole(profileRow?.role ?? role) === "client" ? userId : hasDirectoryColumns ? profileRow?.client_owner_id ?? resolvedClientOwnerId : null,
    clientOwnerEmail:
      normalizeRole(profileRow?.role ?? role) === "client"
        ? email
        : hasDirectoryColumns
          ? clientOwnerEmail
          : null,
    createdByUserId: hasDirectoryColumns ? profileRow?.created_by_user_id ?? viewer.id : null,
    createdByEmail: viewer.email,
    projectAccess: []
  };

  return NextResponse.json({
    user: nextUser,
    message: creationMessage
  });
}
