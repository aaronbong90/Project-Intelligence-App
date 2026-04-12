import { createFallbackProfile, createFullModulePermissions, createModulePermissions, normalizeRole } from "@/lib/auth";
import { demoAdminProjects, demoAdminUsers } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import type { AdminProjectSummary, AdminUserRecord, AppUserProfile, UserProjectAccess } from "@/types/app";

function hasSupabaseEnv() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export async function getAdminAccessData(): Promise<{
  viewer: AppUserProfile | null;
  isAllowed: boolean;
  users: AdminUserRecord[];
  projects: AdminProjectSummary[];
}> {
  if (!hasSupabaseEnv()) {
    return {
      viewer: createFallbackProfile("aaronbong90@gmail.com"),
      isAllowed: true,
      users: demoAdminUsers,
      projects: demoAdminProjects
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      viewer: null,
      isAllowed: false,
      users: [],
      projects: []
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

  if (viewer.role !== "master_admin" || viewer.isSuspended) {
    return {
      viewer,
      isAllowed: false,
      users: [],
      projects: []
    };
  }

  const membershipSelect =
    "id, project_id, user_id, email, role, can_overview, can_handover, can_daily_reports, can_weekly_reports, can_financials, can_completion, can_defects";

  const [{ data: profileRows = [] }, { data: projectRows = [] }, { data: membershipRows = [] }] = await Promise.all([
    supabase.from("profiles").select("id, email, role, is_suspended").order("email", { ascending: true }),
    supabase.from("projects").select("id, owner_id, name").order("created_at", { ascending: false }),
    supabase.from("project_members").select(membershipSelect)
  ]);

  const safeProfiles = profileRows ?? [];
  const safeProjects = projectRows ?? [];
  const safeMemberships = membershipRows ?? [];

  const projectSummaries: AdminProjectSummary[] = safeProjects.map((project) => ({
    id: project.id,
    name: project.name,
    ownerId: project.owner_id,
    ownerEmail: safeProfiles.find((profile) => profile.id === project.owner_id)?.email ?? ""
  }));

  const projectNameById = new Map(projectSummaries.map((project) => [project.id, project.name]));

  const users: AdminUserRecord[] = safeProfiles
    .map((profile) => {
      const projectAccessMap = new Map<string, UserProjectAccess>();

      safeProjects
        .filter((project) => project.owner_id === profile.id)
        .forEach((project) => {
          projectAccessMap.set(project.id, {
            membershipId: null,
            projectId: project.id,
            projectName: project.name,
            role: normalizeRole(profile.role),
            modules: createFullModulePermissions(),
            isOwner: true
          });
        });

      safeMemberships
        .filter((membership) => membership.user_id === profile.id)
        .forEach((membership) => {
          if (projectAccessMap.has(membership.project_id)) {
            return;
          }

          projectAccessMap.set(membership.project_id, {
            membershipId: membership.id,
            projectId: membership.project_id,
            projectName: projectNameById.get(membership.project_id) ?? "Untitled project",
            role: normalizeRole(membership.role),
            modules: createModulePermissions({
              overview: membership.can_overview,
              handover: membership.can_handover,
              daily_reports: membership.can_daily_reports,
              weekly_reports: membership.can_weekly_reports,
              financials: membership.can_financials,
              completion: membership.can_completion,
              defects: membership.can_defects
            }),
            isOwner: false
          });
        });

      return {
        id: profile.id,
        email: profile.email ?? "",
        role: normalizeRole(profile.role),
        isSuspended: profile.is_suspended ?? false,
        projectAccess: Array.from(projectAccessMap.values()).sort((a, b) => a.projectName.localeCompare(b.projectName))
      };
    })
    .sort((a, b) => a.email.localeCompare(b.email));

  return {
    viewer,
    isAllowed: true,
    users,
    projects: projectSummaries
  };
}
