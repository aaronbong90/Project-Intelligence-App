"use client";

import { useMemo, useState, useTransition } from "react";
import { createModulePermissions, getRoleLabel, MASTER_ADMIN_EMAIL, MODULE_KEYS } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";
import { formatSectionLabel } from "@/lib/utils";
import type { AdminProjectSummary, AdminUserRecord, AppUserProfile, ModuleKey, ModulePermissions, UserProjectAccess, UserRole } from "@/types/app";

type AssignableRole = Exclude<UserRole, "master_admin">;

type AssignmentDraft = {
  projectId: string;
  role: AssignableRole;
  modules: ModulePermissions;
};

type Props = {
  initialUsers: AdminUserRecord[];
  projects: AdminProjectSummary[];
  viewer: AppUserProfile | null;
  isAllowed: boolean;
  isConfigured: boolean;
};

function getAssignableRole(role: UserRole): AssignableRole {
  if (role === "client" || role === "contractor" || role === "subcontractor") {
    return role;
  }

  return "consultant";
}

function buildDraft(projectId = "", role: UserRole = "consultant", modules?: ModulePermissions): AssignmentDraft {
  return {
    projectId,
    role: getAssignableRole(role),
    modules: modules ?? createModulePermissions()
  };
}

function buildDraftFromAccess(access: UserProjectAccess): AssignmentDraft {
  return buildDraft(access.projectId, access.role, access.modules);
}

function buildInitialDrafts(users: AdminUserRecord[], projects: AdminProjectSummary[]) {
  return Object.fromEntries(
    users.map((user) => {
      const editableAccess = user.projectAccess.find((access) => !access.isOwner);
      const firstAssignableProject = projects.find((project) => project.ownerId !== user.id)?.id ?? "";

      return [
        user.id,
        editableAccess ? buildDraftFromAccess(editableAccess) : buildDraft(firstAssignableProject, user.role)
      ];
    })
  ) as Record<string, AssignmentDraft>;
}

export function AdminShell({ initialUsers, projects, viewer, isAllowed, isConfigured }: Props) {
  const [users, setUsers] = useState(initialUsers);
  const [drafts, setDrafts] = useState<Record<string, AssignmentDraft>>(() => buildInitialDrafts(initialUsers, projects));
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const activeUsers = useMemo(() => users.filter((user) => !user.isSuspended).length, [users]);
  const suspendedUsers = useMemo(() => users.filter((user) => user.isSuspended).length, [users]);
  const assignmentCount = useMemo(
    () => users.reduce((total, user) => total + user.projectAccess.filter((access) => !access.isOwner).length, 0),
    [users]
  );

  async function requireAdminUser() {
    if (!isConfigured) {
      throw new Error("Configure Supabase in .env.local to enable live admin changes.");
    }

    if (!viewer || viewer.role !== "master_admin" || viewer.isSuspended) {
      throw new Error("Only the active master admin account can manage users and permissions.");
    }

    const supabase = createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      throw new Error("Sign in first before managing users.");
    }

    return supabase;
  }

  function resetMessages() {
    setFeedback(null);
    setError(null);
  }

  function updateUser(userId: string, updater: (user: AdminUserRecord) => AdminUserRecord) {
    setUsers((current) => current.map((user) => (user.id === userId ? updater(user) : user)));
  }

  function updateDraft(userId: string, updater: (draft: AssignmentDraft) => AssignmentDraft) {
    setDrafts((current) => ({
      ...current,
      [userId]: updater(current[userId] ?? buildDraft())
    }));
  }

  function handleRoleChange(user: AdminUserRecord, role: AssignableRole) {
    resetMessages();

    startTransition(async () => {
      try {
        if (user.email.toLowerCase() === MASTER_ADMIN_EMAIL.toLowerCase()) {
          throw new Error("The universal master admin account is locked to your email.");
        }

        const supabase = await requireAdminUser();
        const { error: updateError } = await supabase.from("profiles").update({ role }).eq("id", user.id);
        if (updateError) throw updateError;

        updateUser(user.id, (current) => ({
          ...current,
          role,
          projectAccess: current.projectAccess.map((access) =>
            access.isOwner
              ? {
                  ...access,
                  role
                }
              : access
          )
        }));
        updateDraft(user.id, (draft) => ({
          ...draft,
          role
        }));
        setFeedback(`Updated ${user.email} to ${getRoleLabel(role, user.email)}.`);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to update the user role.");
      }
    });
  }

  function handleSuspensionToggle(user: AdminUserRecord) {
    resetMessages();

    startTransition(async () => {
      try {
        if (user.email.toLowerCase() === MASTER_ADMIN_EMAIL.toLowerCase()) {
          throw new Error("The universal master admin account cannot be suspended.");
        }

        const nextSuspended = !user.isSuspended;
        const supabase = await requireAdminUser();
        const { error: updateError } = await supabase.from("profiles").update({ is_suspended: nextSuspended }).eq("id", user.id);
        if (updateError) throw updateError;

        updateUser(user.id, (current) => ({
          ...current,
          isSuspended: nextSuspended
        }));
        setFeedback(nextSuspended ? `${user.email} has been suspended.` : `${user.email} has been reactivated.`);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to change suspension status.");
      }
    });
  }

  function handleProjectSelect(user: AdminUserRecord, projectId: string) {
    const existingAccess = user.projectAccess.find((access) => access.projectId === projectId && !access.isOwner);
    updateDraft(user.id, () => (existingAccess ? buildDraftFromAccess(existingAccess) : buildDraft(projectId, user.role)));
  }

  function handleModuleToggle(userId: string, moduleKey: ModuleKey, checked: boolean) {
    updateDraft(userId, (draft) => ({
      ...draft,
      modules: {
        ...draft.modules,
        [moduleKey]: checked
      }
    }));
  }

  function handleAssignmentSave(user: AdminUserRecord) {
    resetMessages();

    startTransition(async () => {
      try {
        const draft = drafts[user.id];
        if (!draft?.projectId) {
          throw new Error("Select a project before saving access.");
        }

        const project = projects.find((item) => item.id === draft.projectId);
        if (!project) {
          throw new Error("The selected project could not be found.");
        }

        if (project.ownerId === user.id) {
          throw new Error("Project owners already have full access. Use project ownership instead of a member assignment.");
        }

        const supabase = await requireAdminUser();
        const payload = {
          project_id: draft.projectId,
          user_id: user.id,
          email: user.email,
          role: draft.role,
          can_overview: draft.modules.overview,
          can_handover: draft.modules.handover,
          can_daily_reports: draft.modules.daily_reports,
          can_weekly_reports: draft.modules.weekly_reports,
          can_financials: draft.modules.financials,
          can_completion: draft.modules.completion,
          can_defects: draft.modules.defects
        };

        const { data, error: upsertError } = await supabase
          .from("project_members")
          .upsert(payload, { onConflict: "project_id,user_id" })
          .select(
            "id, project_id, user_id, role, can_overview, can_handover, can_daily_reports, can_weekly_reports, can_financials, can_completion, can_defects"
          )
          .single();

        if (upsertError) throw upsertError;

        updateUser(user.id, (current) => ({
          ...current,
          projectAccess: [
            ...current.projectAccess.filter((access) => access.projectId !== draft.projectId || access.isOwner),
            {
              membershipId: data.id,
              projectId: data.project_id,
              projectName: project.name,
              role: draft.role,
              modules: createModulePermissions({
                overview: data.can_overview,
                handover: data.can_handover,
                daily_reports: data.can_daily_reports,
                weekly_reports: data.can_weekly_reports,
                financials: data.can_financials,
                completion: data.can_completion,
                defects: data.can_defects
              }),
              isOwner: false
            }
          ].sort((a, b) => a.projectName.localeCompare(b.projectName))
        }));
        setFeedback(`Saved ${project.name} access for ${user.email}.`);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to save project access.");
      }
    });
  }

  function handleLoadAccess(userId: string, access: UserProjectAccess) {
    resetMessages();
    updateDraft(userId, () => buildDraftFromAccess(access));
    setFeedback(`Loaded ${access.projectName} permissions into the editor.`);
  }

  function handleRemoveAccess(user: AdminUserRecord, access: UserProjectAccess) {
    resetMessages();

    startTransition(async () => {
      try {
        if (access.isOwner || !access.membershipId) {
          throw new Error("Project ownership cannot be removed from this screen.");
        }

        const supabase = await requireAdminUser();
        const { error: deleteError } = await supabase.from("project_members").delete().eq("id", access.membershipId);
        if (deleteError) throw deleteError;

        updateUser(user.id, (current) => ({
          ...current,
          projectAccess: current.projectAccess.filter((item) => item.membershipId !== access.membershipId)
        }));
        setFeedback(`Removed ${access.projectName} access for ${user.email}.`);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to remove project access.");
      }
    });
  }

  return (
    <>
      <section className="hero-card">
        <div className="hero-copy-block">
          <p className="eyebrow">Admin Console</p>
          <h2>Users & Permissions</h2>
          <p className="hero-description">
            Manage your client, contractor, subcontractor, consultant, and master-admin access from one screen with project-by-project
            module control.
          </p>
          {viewer ? (
            <div className="viewer-banner">
              <span className="pill">{getRoleLabel(viewer.role, viewer.email)}</span>
              <span className="muted-copy">
                Signed in as {viewer.email || "current user"}
                {viewer.isSuspended ? ". This account is currently suspended." : ". You can update global roles and project-level permissions here."}
              </span>
            </div>
          ) : null}
        </div>
        <div className="countdown-card">
          <span>Directory Summary</span>
          <strong>{users.length} users</strong>
          <small>{projects.length} tracked projects</small>
        </div>
      </section>

      {!isConfigured ? (
        <p className="form-message">Demo mode is active. Add Supabase credentials to enable live admin changes.</p>
      ) : null}
      {feedback ? <p className="form-message">{feedback}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}

      {!isAllowed ? (
        <section className="content-card">
          <div className="section-header">
            <div>
              <p className="eyebrow">Access Required</p>
              <h3>Master admin access only</h3>
            </div>
          </div>
          <p className="muted-copy">
            {viewer?.isSuspended
              ? "This account is suspended. Contact the master admin to restore access before using the admin console."
              : "Sign in with your master admin account to manage users, project assignments, and module permissions."}
          </p>
        </section>
      ) : (
        <>
          <section className="content-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Admin Summary</p>
                <h3>Current account health</h3>
              </div>
            </div>
            <div className="stats-grid">
              <article className="stat-card">
                <span>Active Users</span>
                <strong>{activeUsers}</strong>
              </article>
              <article className="stat-card">
                <span>Suspended Users</span>
                <strong>{suspendedUsers}</strong>
              </article>
              <article className="stat-card">
                <span>Projects</span>
                <strong>{projects.length}</strong>
              </article>
              <article className="stat-card">
                <span>Assignments</span>
                <strong>{assignmentCount}</strong>
              </article>
            </div>
          </section>

          <section className="section-stack">
            {users.map((user) => {
              const draft = drafts[user.id] ?? buildDraft();
              const assignableProjects = projects.filter((project) => project.ownerId !== user.id);

              return (
                <article className="content-card" key={user.id}>
                  <div className="section-header">
                    <div>
                      <p className="eyebrow">User</p>
                      <h3>{user.email}</h3>
                      <p className="muted-copy">
                        {user.projectAccess.filter((access) => access.isOwner).length} owned project
                        {user.projectAccess.filter((access) => access.isOwner).length === 1 ? "" : "s"} and{" "}
                        {user.projectAccess.filter((access) => !access.isOwner).length} assigned access record
                        {user.projectAccess.filter((access) => !access.isOwner).length === 1 ? "" : "s"}.
                      </p>
                    </div>
                    <div className="record-actions">
                      <span className="pill">{getRoleLabel(user.role, user.email)}</span>
                      <span className="pill">{user.isSuspended ? "Suspended" : "Active"}</span>
                    </div>
                  </div>

                  <div className="admin-controls-grid top-gap">
                    <div className="panel-surface admin-panel">
                      <p className="eyebrow">Global Role</p>
                      {user.email.toLowerCase() === MASTER_ADMIN_EMAIL.toLowerCase() ? (
                        <>
                          <strong>{getRoleLabel(user.role, user.email)}</strong>
                          <p className="muted-copy">The universal master admin account is locked to your email.</p>
                        </>
                      ) : (
                        <label className="field">
                          <span>User role</span>
                          <select
                            disabled={isPending || !isConfigured}
                            onChange={(event) => handleRoleChange(user, event.target.value as AssignableRole)}
                            value={getAssignableRole(user.role)}
                          >
                            <option value="client">Client</option>
                            <option value="contractor">Main Contractor</option>
                            <option value="subcontractor">Sub Contractor</option>
                            <option value="consultant">Consultant</option>
                          </select>
                        </label>
                      )}
                    </div>

                    <div className="panel-surface admin-panel">
                      <p className="eyebrow">Account Status</p>
                      <strong>{user.isSuspended ? "Suspended" : "Active"}</strong>
                      <p className="muted-copy">
                        Suspended users can still sign in, but project data and module access are blocked until reactivated.
                      </p>
                      <button
                        className="ghost-button"
                        disabled={isPending || !isConfigured || user.email.toLowerCase() === MASTER_ADMIN_EMAIL.toLowerCase()}
                        onClick={() => handleSuspensionToggle(user)}
                        type="button"
                      >
                        {user.isSuspended ? "Reactivate user" : "Suspend user"}
                      </button>
                    </div>
                  </div>

                  <div className="panel-surface top-gap">
                    <div className="section-header">
                      <div>
                        <p className="eyebrow">Project Assignment</p>
                        <h3>Project-specific role and modules</h3>
                      </div>
                    </div>
                    <div className="membership-form-grid">
                      <label className="field">
                        <span>Project</span>
                        <select
                          disabled={isPending || !isConfigured || !assignableProjects.length}
                          onChange={(event) => handleProjectSelect(user, event.target.value)}
                          value={draft.projectId}
                        >
                          <option value="">Select project</option>
                          {assignableProjects.map((project) => (
                            <option key={project.id} value={project.id}>
                              {project.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Project role</span>
                        <select
                          disabled={isPending || !isConfigured}
                          onChange={(event) =>
                            updateDraft(user.id, (current) => ({
                              ...current,
                              role: event.target.value as AssignableRole
                            }))
                          }
                          value={draft.role}
                        >
                          <option value="client">Client</option>
                          <option value="contractor">Main Contractor</option>
                          <option value="subcontractor">Sub Contractor</option>
                          <option value="consultant">Consultant</option>
                        </select>
                      </label>
                    </div>
                    <div className="permission-box top-gap">
                      <span>Module access</span>
                      <div className="permission-grid">
                        {MODULE_KEYS.map((moduleKey) => (
                          <label className="permission-item" key={`${user.id}-${moduleKey}`}>
                            <input
                              checked={draft.modules[moduleKey]}
                              disabled={isPending || !isConfigured}
                              onChange={(event) => handleModuleToggle(user.id, moduleKey, event.target.checked)}
                              type="checkbox"
                            />
                            <span>{formatSectionLabel(moduleKey)}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="admin-assignment-footer">
                      <p className="muted-copy">
                        Choose the same project again to update an existing assignment. Project owners keep full access automatically.
                      </p>
                      <button
                        className="primary-button"
                        disabled={isPending || !isConfigured || !draft.projectId || user.isSuspended}
                        onClick={() => handleAssignmentSave(user)}
                        type="button"
                      >
                        Save project access
                      </button>
                    </div>
                  </div>

                  <div className="list-grid top-gap">
                    {user.projectAccess.length ? (
                      user.projectAccess.map((access) => (
                        <article className="record-surface" key={`${user.id}-${access.projectId}-${access.membershipId ?? "owner"}`}>
                          <div className="record-header">
                            <div>
                              <strong>{access.projectName}</strong>
                              <p>{access.isOwner ? "Project owner" : getRoleLabel(access.role, user.email)}</p>
                            </div>
                            <div className="record-actions">
                              <span className="pill">{access.isOwner ? "Owner" : "Assigned"}</span>
                              {!access.isOwner ? (
                                <>
                                  <button className="ghost-button" onClick={() => handleLoadAccess(user.id, access)} type="button">
                                    Load
                                  </button>
                                  <button className="ghost-button" onClick={() => handleRemoveAccess(user, access)} type="button">
                                    Remove access
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </div>
                          <div className="attachment-list">
                            {MODULE_KEYS.filter((moduleKey) => access.modules[moduleKey]).map((moduleKey) => (
                              <span className="pill" key={`${access.projectId}-${moduleKey}`}>
                                {formatSectionLabel(moduleKey)}
                              </span>
                            ))}
                          </div>
                        </article>
                      ))
                    ) : (
                      <article className="record-surface">
                        <p className="muted-copy">No projects are assigned to this user yet.</p>
                      </article>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        </>
      )}
    </>
  );
}
