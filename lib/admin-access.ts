import { canAccessAdminConsole, createFallbackProfile, normalizeRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { AppUserProfile } from "@/types/app";

export async function getAdminViewerContext(): Promise<{
  viewer: AppUserProfile | null;
  isAllowed: boolean;
}> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      viewer: null,
      isAllowed: false
    };
  }

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("id, email, role, is_suspended")
    .eq("id", user.id)
    .maybeSingle();

  const viewer: AppUserProfile = profileRow
    ? {
        id: profileRow.id,
        email: profileRow.email ?? user.email ?? "",
        role: normalizeRole(profileRow.role),
        isSuspended: profileRow.is_suspended ?? false
      }
    : createFallbackProfile(user.email ?? "");

  return {
    viewer,
    isAllowed: !viewer.isSuspended && canAccessAdminConsole(viewer.role)
  };
}
