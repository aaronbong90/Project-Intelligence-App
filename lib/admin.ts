import { createFullModulePermissions, createModulePermissions, normalizeRole } from "@/lib/auth";
import { getAdminViewerContext } from "@/lib/admin-access";
import { demoAdminProjects, demoAdminUsers } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import type { AdminProjectSummary, AdminUserRecord, AppUserProfile, UserProjectAccess } from "@/types/app";

function hasSupabaseEnv() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

type ProfileRow = {
  id: string;
  email: string | null;
  role: string | null;
  is_suspended: boolean | null;
  client_owner_id?: string | null;
  created_by_user_id?: string | null;
};

type ProjectRow = {
  id: string;
  owner_id: string;
  name: string;
};

type MembershipRow = {
  id: string;
  project_id: string;
  user_id: string;
  email: string;
  role: string;
  can_overview: boolean;
  can_contractor_submissions: boolean;
  can_handover: boolean;
  can_daily_reports: boolean;
  can_weekly_reports: boolean;
  can_financials: boolean;
  can_completion: boolean;
  can_defects: boolean;
};

function isMissingProfileDirectoryColumnsError(error: { message?: string | null } | null | undefined) {
  const message = error?.message ?? "";
  return message.includes("profiles.client_owner_id") || message.includes("profiles.created_by_user_id");
}

export async function getAdminAccessData(): Promise<{
  viewer: AppUserProfile | null;
  isAllowed: boolean;
  users: AdminUserRecord[];
  projects: AdminProjectSummary[];
}> {
  if (!hasSupabaseEnv()) {
    return {
      viewer: {
        id: "",
        email: "aaronbong90@gmail.com",
        role: "master_admin",
        isSuspended: false
      },
      isAllowed: true,
      users: demoAdminUsers,
      projects: demoAdminProjects
    };
  }

  const { viewer, isAllowed } = await getAdminViewerContext();

  if (!viewer || !isAllowed) {
    return {
      viewer,
      isAllowed: false,
      users: [],
      projects: []
    };
  }

  const supabase = await createClient();
  const membershipSelect =
    "id, project_id, user_id, email, role, can_overview, can_contractor_submissions, can_handover, can_daily_reports, can_weekly_reports, can_financials, can_completion, can_defects";
  const profileSelect = "id, email, role, is_suspended, client_owner_id, created_by_user_id";
  const basicProfileSelect = "id, email, role, is_suspended";

  let profileRows: ProfileRow[] = [];
  let projectRows: ProjectRow[] = [];
  let membershipRows: MembershipRow[] = [];
  let selfMembershipRows: MembershipRow[] = [];
  let hasProfileDirectoryColumns = true;

  if (viewer.role === "master_admin") {
    const [allProfilesResponse, { data: allProjects = [] }, { data: allMemberships = [] }] = await Promise.all([
      supabase.from("profiles").select(profileSelect).order("email", { ascending: true }),
      supabase.from("projects").select("id, owner_id, name").order("created_at", { ascending: false }),
      supabase.from("project_members").select(membershipSelect)
    ]);

    if (isMissingProfileDirectoryColumnsError(allProfilesResponse.error)) {
      hasProfileDirectoryColumns = false;
      const { data: fallbackProfiles = [] } = await supabase.from("profiles").select(basicProfileSelect).order("email", { ascending: true });
      profileRows = (fallbackProfiles ?? []) as ProfileRow[];
    } else {
      profileRows = (allProfilesResponse.data ?? []) as ProfileRow[];
    }
    projectRows = (allProjects ?? []) as ProjectRow[];
    membershipRows = (allMemberships ?? []) as MembershipRow[];
  } else {
    const { data: viewerMemberships = [] } = await supabase.from("project_members").select(membershipSelect).eq("user_id", viewer.id);
    selfMembershipRows = (viewerMemberships ?? []) as MembershipRow[];
    const membershipProjectIds = selfMembershipRows.map((membership) => membership.project_id);

    const [ownedProjectsResponse, memberProjectsResponse] = await Promise.all([
      supabase.from("projects").select("id, owner_id, name").eq("owner_id", viewer.id).order("created_at", { ascending: false }),
      membershipProjectIds.length
        ? supabase.from("projects").select("id, owner_id, name").in("id", membershipProjectIds)
        : Promise.resolve({ data: [], error: null })
    ]);

    const projectMap = new Map<string, ProjectRow>();
    (ownedProjectsResponse.data ?? []).forEach((project) => {
      if (project) {
        projectMap.set(project.id, project as ProjectRow);
      }
    });
    (memberProjectsResponse.data ?? []).forEach((project) => {
      if (project) {
        projectMap.set(project.id, project as ProjectRow);
      }
    });

    projectRows = Array.from(projectMap.values());

    if (projectRows.length) {
      const { data: scopedMemberships = [] } = await supabase
        .from("project_members")
        .select(membershipSelect)
        .in(
          "project_id",
          projectRows.map((project) => project.id)
        );
      membershipRows = (scopedMemberships ?? []) as MembershipRow[];
    }

    const fallbackProfileIds = Array.from(
      new Set([viewer.id, ...projectRows.map((project) => project.owner_id), ...membershipRows.map((membership) => membership.user_id)])
    );

    const scopedProfilesResponse = await supabase
      .from("profiles")
      .select(profileSelect)
      .or(`id.eq.${viewer.id},client_owner_id.eq.${viewer.id}`)
      .order("email", { ascending: true });

    if (isMissingProfileDirectoryColumnsError(scopedProfilesResponse.error)) {
      hasProfileDirectoryColumns = false;
      if (fallbackProfileIds.length) {
        const { data: fallbackProfiles = [] } = await supabase
          .from("profiles")
          .select(basicProfileSelect)
          .in("id", fallbackProfileIds)
          .order("email", { ascending: true });
        profileRows = (fallbackProfiles ?? []) as ProfileRow[];
      }
    } else {
      profileRows = (scopedProfilesResponse.data ?? []) as ProfileRow[];
    }
  }

  const safeProfiles = profileRows ?? [];
  const safeProjects = projectRows ?? [];
  const safeMemberships = membershipRows ?? [];
  const safeSelfMemberships = selfMembershipRows ?? [];

  const profileEmailById = new Map(safeProfiles.map((profile) => [profile.id, profile.email ?? ""]));
  const viewerMembershipRoleByProject = new Map(safeSelfMemberships.map((membership) => [membership.project_id, normalizeRole(membership.role)]));

  const projectSummaries: AdminProjectSummary[] = safeProjects.map((project) => ({
    id: project.id,
    name: project.name,
    ownerId: project.owner_id,
    ownerEmail: profileEmailById.get(project.owner_id) ?? "",
    canManageMembers:
      viewer.role === "master_admin" || project.owner_id === viewer.id || viewerMembershipRoleByProject.get(project.id) === "client"
  }));

  const projectNameById = new Map(projectSummaries.map((project) => [project.id, project.name]));

  const users: AdminUserRecord[] = safeProfiles
    .map((profile) => {
      const normalizedProfileRole = normalizeRole(profile.role);
      const projectAccessMap = new Map<string, UserProjectAccess>();

      safeProjects
        .filter((project) => project.owner_id === profile.id)
        .forEach((project) => {
          projectAccessMap.set(project.id, {
            membershipId: null,
            projectId: project.id,
            projectName: project.name,
            role: normalizedProfileRole,
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
              contractor_submissions: membership.can_contractor_submissions,
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

      const clientOwnerId = normalizedProfileRole === "client" ? profile.id : hasProfileDirectoryColumns ? profile.client_owner_id ?? null : null;

      return {
        id: profile.id,
        email: profile.email ?? "",
        role: normalizedProfileRole,
        isSuspended: profile.is_suspended ?? false,
        clientOwnerId,
        clientOwnerEmail: clientOwnerId ? profileEmailById.get(clientOwnerId) ?? null : null,
        createdByUserId: hasProfileDirectoryColumns ? profile.created_by_user_id ?? null : null,
        createdByEmail:
          hasProfileDirectoryColumns && profile.created_by_user_id ? profileEmailById.get(profile.created_by_user_id) ?? null : null,
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
