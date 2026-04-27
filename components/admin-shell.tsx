"use client";

import { useMemo, useState, useTransition } from "react";
import {
  FREE_PILOT_MAX_ATTACHMENTS_PER_UPLOAD,
  FREE_PILOT_MAX_DOCUMENT_BYTES,
  FREE_PILOT_MAX_IMAGE_BYTES,
  FREE_PILOT_RECOMMENDED_ACTIVE_TESTERS,
  FREE_PILOT_RECOMMENDED_PROJECTS,
  formatBytes
} from "@/lib/free-pilot";
import { canAccessAdminConsole, createModulePermissions, getRoleLabel, MASTER_ADMIN_EMAIL, MODULE_KEYS } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";
import { cn, formatSectionLabel } from "@/lib/utils";
import type { AdminProjectSummary, AdminUserRecord, AppUserProfile, ModuleKey, ModulePermissions, UserProjectAccess, UserRole } from "@/types/app";

type AssignableRole = Exclude<UserRole, "master_admin">;

type AssignmentDraft = {
  projectId: string;
  role: AssignableRole;
  modules: ModulePermissions;
};

type CreateUserDraft = {
  email: string;
  role: AssignableRole;
  clientOwnerId: string;
  password: string;
  confirmPassword: string;
};

type PasswordDraft = {
  password: string;
  confirmPassword: string;
};

type Props = {
  initialUsers: AdminUserRecord[];
  projects: AdminProjectSummary[];
  viewer: AppUserProfile | null;
  isAllowed: boolean;
  isConfigured: boolean;
};

function getDefaultCreateRole(viewer: AppUserProfile | null): AssignableRole {
  return viewer?.role === "client" ? "contractor" : "client";
}

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
      const firstAssignableProject = projects.find((project) => project.canManageMembers && project.ownerId !== user.id)?.id ?? "";

      return [
        user.id,
        editableAccess ? buildDraftFromAccess(editableAccess) : buildDraft(firstAssignableProject, user.role)
      ];
    })
  ) as Record<string, AssignmentDraft>;
}

function createEmptyUserDraft(viewer: AppUserProfile | null): CreateUserDraft {
  return {
    email: "",
    role: getDefaultCreateRole(viewer),
    clientOwnerId: "",
    password: "",
    confirmPassword: ""
  };
}

function createEmptyPasswordDraft(): PasswordDraft {
  return {
    password: "",
    confirmPassword: ""
  };
}

function getProjectRoleOptions(viewer: AppUserProfile | null, user: AdminUserRecord) {
  if (viewer?.role === "master_admin") {
    return [
      { value: "client", label: "Client" },
      { value: "contractor", label: "Main Contractor" },
      { value: "subcontractor", label: "Sub Contractor" },
      { value: "consultant", label: "Consultant" }
    ] as const;
  }

  if (user.role === "client") {
    return [] as const;
  }

  return [
    { value: "contractor", label: "Main Contractor" },
    { value: "subcontractor", label: "Sub Contractor" },
    { value: "consultant", label: "Consultant" }
  ] as const;
}

export function AdminShell({ initialUsers, projects, viewer, isAllowed, isConfigured }: Props) {
  const [users, setUsers] = useState(initialUsers);
  const [drafts, setDrafts] = useState<Record<string, AssignmentDraft>>(() => buildInitialDrafts(initialUsers, projects));
  const [createUserDraft, setCreateUserDraft] = useState<CreateUserDraft>(() => createEmptyUserDraft(viewer));
  const [managedPasswordDrafts, setManagedPasswordDrafts] = useState<Record<string, PasswordDraft>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const activeUsers = useMemo(() => users.filter((user) => !user.isSuspended).length, [users]);
  const suspendedUsers = useMemo(() => users.filter((user) => user.isSuspended).length, [users]);
  const assignmentCount = useMemo(
    () => users.reduce((total, user) => total + user.projectAccess.filter((access) => !access.isOwner).length, 0),
    [users]
  );
  const freePilotWatch = useMemo(() => {
    const notes: string[] = [];

    if (activeUsers > FREE_PILOT_RECOMMENDED_ACTIVE_TESTERS) {
      notes.push(`Active users are above the recommended free-pilot cap of ${FREE_PILOT_RECOMMENDED_ACTIVE_TESTERS}.`);
    }

    if (projects.length > FREE_PILOT_RECOMMENDED_PROJECTS) {
      notes.push(`You currently have ${projects.length} visible projects. Keeping the live pilot to ${FREE_PILOT_RECOMMENDED_PROJECTS} project helps keep usage low.`);
    }

    return {
      tone: notes.length ? "pending" : "approved",
      title: notes.length ? "Watch free-tier usage" : "Free pilot looks healthy",
      notes
    } as const;
  }, [activeUsers, projects.length]);
  const clientDirectories = useMemo(
    () =>
      users
        .filter((user) => user.role === "client")
        .sort((left, right) => left.email.localeCompare(right.email)),
    [users]
  );
  const canCreateUsers = viewer?.role === "master_admin" || viewer?.role === "client";

  async function requireAllowedAdminUser() {
    if (!isConfigured) {
      throw new Error("Configure Supabase in .env.local to enable live Settings changes.");
    }

    if (!viewer || viewer.isSuspended || !canAccessAdminConsole(viewer.role)) {
      throw new Error("You do not have permission to manage directory Settings.");
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
    setUsers((current) =>
      current
        .map((user) => (user.id === userId ? updater(user) : user))
        .sort((left, right) => left.email.localeCompare(right.email))
    );
  }

  function updateDraft(userId: string, updater: (draft: AssignmentDraft) => AssignmentDraft) {
    setDrafts((current) => ({
      ...current,
      [userId]: updater(current[userId] ?? buildDraft())
    }));
  }

  function updateManagedPasswordDraft(userId: string, updater: (draft: PasswordDraft) => PasswordDraft) {
    setManagedPasswordDrafts((current) => ({
      ...current,
      [userId]: updater(current[userId] ?? createEmptyPasswordDraft())
    }));
  }

  function handleRoleChange(user: AdminUserRecord, role: AssignableRole) {
    resetMessages();

    startTransition(async () => {
      try {
        if (viewer?.role !== "master_admin") {
          throw new Error("You do not have permission to change global user roles.");
        }

        if (user.email.toLowerCase() === MASTER_ADMIN_EMAIL.toLowerCase()) {
          throw new Error("This owner account is locked to your email.");
        }

        const supabase = await requireAllowedAdminUser();
        const updates = {
          role,
          client_owner_id: role === "client" ? user.id : user.clientOwnerId === user.id ? null : user.clientOwnerId
        };
        const { error: updateError } = await supabase.from("profiles").update(updates).eq("id", user.id);
        if (updateError) throw updateError;

        updateUser(user.id, (current) => ({
          ...current,
          role,
          clientOwnerId: role === "client" ? current.id : current.clientOwnerId === current.id ? null : current.clientOwnerId,
          clientOwnerEmail: role === "client" ? current.email : current.clientOwnerId === current.id ? null : current.clientOwnerEmail,
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
          role: role === "client" && viewer?.role !== "master_admin" ? "consultant" : role
        }));
        setFeedback(`Updated ${user.email} to ${getRoleLabel(role, user.email)}.`);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to update the user role.");
      }
    });
  }

  function handleClientOwnerChange(user: AdminUserRecord, nextClientOwnerId: string) {
    resetMessages();

    startTransition(async () => {
      try {
        if (viewer?.role !== "master_admin") {
          throw new Error("You do not have permission to change client-directory ownership.");
        }

        if (user.role === "client") {
          throw new Error("Client accounts always own their own directory.");
        }

        const supabase = await requireAllowedAdminUser();
        const { error: updateError } = await supabase
          .from("profiles")
          .update({ client_owner_id: nextClientOwnerId || null })
          .eq("id", user.id);

        if (updateError) throw updateError;

        const nextClientOwnerEmail = nextClientOwnerId ? clientDirectories.find((client) => client.id === nextClientOwnerId)?.email ?? null : null;
        updateUser(user.id, (current) => ({
          ...current,
          clientOwnerId: nextClientOwnerId || null,
          clientOwnerEmail: nextClientOwnerEmail
        }));
        setFeedback(
          nextClientOwnerId
            ? `${user.email} is now managed under ${nextClientOwnerEmail ?? "the selected client"}.`
            : `${user.email} is no longer assigned to a client directory.`
        );
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to update the client directory.");
      }
    });
  }

  function handleSuspensionToggle(user: AdminUserRecord) {
    resetMessages();

    startTransition(async () => {
      try {
        if (viewer?.role !== "master_admin") {
          throw new Error("You do not have permission to suspend or reactivate accounts.");
        }

        if (user.email.toLowerCase() === MASTER_ADMIN_EMAIL.toLowerCase()) {
          throw new Error("This owner account cannot be suspended.");
        }

        const nextSuspended = !user.isSuspended;
        const supabase = await requireAllowedAdminUser();
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

        if (!project.canManageMembers) {
          throw new Error("You can only manage users on projects that belong to your admin scope.");
        }

        if (project.ownerId === user.id) {
          throw new Error("Project owners already have full access. Use project ownership instead of a member assignment.");
        }

        if (viewer?.role === "client" && draft.role === "client") {
          throw new Error("Client accounts can assign contractor or consultant users only.");
        }

        const supabase = await requireAllowedAdminUser();
        const payload = {
          project_id: draft.projectId,
          user_id: user.id,
          email: user.email,
          role: draft.role,
          can_overview: draft.modules.overview,
          can_contractor_submissions: draft.modules.contractor_submissions,
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
            "id, project_id, user_id, role, can_overview, can_contractor_submissions, can_handover, can_daily_reports, can_weekly_reports, can_financials, can_completion, can_defects"
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
                contractor_submissions: data.can_contractor_submissions,
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

        const project = projects.find((item) => item.id === access.projectId);
        if (!project?.canManageMembers) {
          throw new Error("You can only remove access from projects that belong to your admin scope.");
        }

        const supabase = await requireAllowedAdminUser();
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

  function handleCreateUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();

    startTransition(async () => {
      try {
        if (viewer?.role !== "master_admin" && viewer?.role !== "client") {
          throw new Error("You do not have permission to create user accounts.");
        }

        if (!createUserDraft.email.trim()) {
          throw new Error("Enter an email before creating the account.");
        }

        if (createUserDraft.password.length < 8) {
          throw new Error("Use at least 8 characters for the initial password.");
        }

        if (createUserDraft.password !== createUserDraft.confirmPassword) {
          throw new Error("The initial password confirmation does not match.");
        }

        if (viewer?.role === "client" && createUserDraft.role === "client") {
          throw new Error("Client accounts can create contractor, subcontractor, or consultant users only.");
        }

        if (viewer?.role === "master_admin" && createUserDraft.role !== "client" && !createUserDraft.clientOwnerId) {
          throw new Error("Select the client directory that should own this account.");
        }

        const response = await fetch("/api/admin/users", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            email: createUserDraft.email.trim(),
            role: createUserDraft.role,
            clientOwnerId:
              viewer?.role === "client" ? viewer.id : createUserDraft.role === "client" ? null : createUserDraft.clientOwnerId,
            password: createUserDraft.password
          })
        });

        const payload = (await response.json()) as {
          error?: string;
          message?: string;
          user?: AdminUserRecord;
        };

        if (!response.ok || !payload.user) {
          throw new Error(payload.error ?? "Unable to create the user account.");
        }

        const nextUser = payload.user;
        setUsers((current) =>
          [...current.filter((user) => user.id !== nextUser.id && user.email.toLowerCase() !== nextUser.email.toLowerCase()), nextUser].sort(
            (left, right) => left.email.localeCompare(right.email)
          )
        );
        setDrafts((current) => ({
          ...current,
          [nextUser.id]: buildDraft(
            projects.find((project) => project.canManageMembers && project.ownerId !== nextUser.id)?.id ?? "",
            nextUser.role
          )
        }));
        setCreateUserDraft(createEmptyUserDraft(viewer));
        setFeedback(payload.message ?? `Account created for ${nextUser.email}.`);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to create the user account.");
      }
    });
  }

  function handleOwnPasswordUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      try {
        if (!viewer) {
          throw new Error("Sign in first before changing your password.");
        }

        const password = String(formData.get("password") ?? "");
        const confirmPassword = String(formData.get("confirmPassword") ?? "");

        if (password.length < 8) {
          throw new Error("Use at least 8 characters for the new password.");
        }

        if (password !== confirmPassword) {
          throw new Error("The password confirmation does not match.");
        }

        const supabase = createClient();
        const { error: updateError } = await supabase.auth.updateUser({ password });
        if (updateError) throw updateError;

        setFeedback("Your password has been updated.");
        form.reset();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to change your password.");
      }
    });
  }

  function handleManagedPasswordOverride(user: AdminUserRecord) {
    resetMessages();

    startTransition(async () => {
      try {
        if (viewer?.role !== "master_admin") {
          throw new Error("You do not have permission to override user passwords directly.");
        }

        const draft = managedPasswordDrafts[user.id] ?? createEmptyPasswordDraft();
        if (draft.password.length < 8) {
          throw new Error("Use at least 8 characters for the override password.");
        }

        if (draft.password !== draft.confirmPassword) {
          throw new Error("The override password confirmation does not match.");
        }

        const response = await fetch(`/api/admin/users/${user.id}/set-password`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            password: draft.password
          })
        });

        const payload = (await response.json()) as {
          error?: string;
          message?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to override the password.");
        }

        setManagedPasswordDrafts((current) => ({
          ...current,
          [user.id]: createEmptyPasswordDraft()
        }));
        setFeedback(payload.message ?? `Password override saved for ${user.email}.`);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to override the password.");
      }
    });
  }

  function handleResetEmail(user: AdminUserRecord) {
    resetMessages();

    startTransition(async () => {
      try {
        const response = await fetch(`/api/admin/users/${user.id}/reset-password`, {
          method: "POST"
        });
        const payload = (await response.json()) as {
          error?: string;
          message?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to send the password reset email.");
        }

        setFeedback(payload.message ?? `Password reset email sent to ${user.email}.`);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to send the password reset email.");
      }
    });
  }

  return (
    <>
      <section className="hero-card">
        <div className="hero-copy-block">
          <p className="eyebrow">Settings</p>
          <h2>Users, passwords, and access</h2>
          {viewer ? (
            <div className="viewer-banner">
              <span className="pill">{getRoleLabel(viewer.role, viewer.email)}</span>
              <span className="pill">{viewer.email || "current user"}</span>
              {viewer.isSuspended ? <span className="pill">Suspended</span> : null}
            </div>
          ) : null}
        </div>
        <div className="countdown-card">
          <span>Directory</span>
          <strong>{users.length} users</strong>
          <small>{projects.length} visible projects</small>
        </div>
      </section>

      {!isConfigured ? (
        <p className="form-message">Live admin mode needs Supabase plus the service-role key in .env.local.</p>
      ) : null}
      {feedback ? <p className="form-message">{feedback}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}

      {viewer ? (
        <section className="content-card">
          <div className="section-header">
            <div>
              <p className="eyebrow">My Account</p>
              <h3>Change your password</h3>
            </div>
          </div>
          <form className="membership-form-grid" onSubmit={handleOwnPasswordUpdate}>
            <label className="field">
              <span>New password</span>
              <input name="password" placeholder="At least 8 characters" required type="password" />
            </label>
            <label className="field">
              <span>Confirm password</span>
              <input name="confirmPassword" placeholder="Repeat the new password" required type="password" />
            </label>
            <div className="record-actions field-full">
              <button className="primary-button" disabled={isPending || !isConfigured || viewer.isSuspended} type="submit">
                Save my password
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {!isAllowed ? (
        <section className="content-card">
          <div className="section-header">
            <div>
              <p className="eyebrow">Directory Controls</p>
              <h3>Account settings only</h3>
            </div>
          </div>
          <p className="muted-copy">{viewer?.isSuspended ? "Account suspended." : "Password changes only in this view."}</p>
        </section>
      ) : (
        <>
          <section className="content-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Overview</p>
                <h3>Directory summary</h3>
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

          <section className="content-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Free Pilot Watch</p>
                <h3>Keep the rollout inside the free tier</h3>
              </div>
              <span className={cn("pill", "status-pill", `status-${freePilotWatch.tone}`)}>{freePilotWatch.title}</span>
            </div>
            <div className="pilot-guard-grid">
              <article className="panel-surface admin-panel">
                <p className="eyebrow">Recommended Limits</p>
                <div className="attachment-list">
                  <span className="pill">{FREE_PILOT_RECOMMENDED_ACTIVE_TESTERS} active testers</span>
                  <span className="pill">{FREE_PILOT_RECOMMENDED_PROJECTS} live project</span>
                  <span className="pill">{FREE_PILOT_MAX_ATTACHMENTS_PER_UPLOAD} files per upload</span>
                  <span className="pill">{formatBytes(FREE_PILOT_MAX_IMAGE_BYTES)} max image</span>
                  <span className="pill">{formatBytes(FREE_PILOT_MAX_DOCUMENT_BYTES)} max document</span>
                </div>
              </article>
              <article className="panel-surface admin-panel">
                <p className="eyebrow">Current Watch Notes</p>
                {freePilotWatch.notes.length ? (
                  <ul className="notice-list">
                    {freePilotWatch.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted-copy">Current user and project counts are still within the recommended free-pilot range.</p>
                )}
              </article>
            </div>
            <p className="muted-copy top-gap">
              Video uploads are disabled in the pilot. Users can keep working with photos, PDF, Word, Excel, and PowerPoint files, and larger photos are automatically optimized before upload.
            </p>
          </section>

          {canCreateUsers ? (
            <section className="content-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">User Setup</p>
                  <h3>Create a new account</h3>
                </div>
              </div>
              <form className="membership-form-grid" onSubmit={handleCreateUser}>
                <label className="field field-full">
                  <span>Email</span>
                  <input
                    name="email"
                    onChange={(event) => setCreateUserDraft((current) => ({ ...current, email: event.target.value }))}
                    placeholder="new.user@company.com"
                    required
                    type="email"
                    value={createUserDraft.email}
                  />
                </label>
                <label className="field">
                  <span>Account role</span>
                  <select
                    onChange={(event) =>
                      setCreateUserDraft((current) => ({
                        ...current,
                        role: event.target.value as AssignableRole,
                        clientOwnerId: event.target.value === "client" ? "" : current.clientOwnerId
                      }))
                    }
                    value={createUserDraft.role}
                  >
                    {viewer?.role === "master_admin" ? <option value="client">Client</option> : null}
                    <option value="contractor">Main Contractor</option>
                    <option value="subcontractor">Sub Contractor</option>
                    <option value="consultant">Consultant</option>
                  </select>
                </label>
                <label className="field">
                  <span>Client directory</span>
                  <select
                    disabled={viewer?.role === "client" || createUserDraft.role === "client" || !clientDirectories.length}
                    onChange={(event) => setCreateUserDraft((current) => ({ ...current, clientOwnerId: event.target.value }))}
                    value={viewer?.role === "client" || createUserDraft.role === "client" ? "" : createUserDraft.clientOwnerId}
                  >
                    <option value="">
                      {viewer?.role === "client" ? viewer.email : clientDirectories.length ? "Select client" : "Create a client first"}
                    </option>
                    {viewer?.role === "master_admin"
                      ? clientDirectories.map((client) => (
                          <option key={client.id} value={client.id}>
                            {client.email}
                          </option>
                        ))
                      : null}
                  </select>
                </label>
                <label className="field">
                  <span>Initial password</span>
                  <input
                    name="password"
                    onChange={(event) => setCreateUserDraft((current) => ({ ...current, password: event.target.value }))}
                    placeholder="At least 8 characters"
                    required
                    type="password"
                    value={createUserDraft.password}
                  />
                </label>
                <label className="field">
                  <span>Confirm password</span>
                  <input
                    name="confirmPassword"
                    onChange={(event) => setCreateUserDraft((current) => ({ ...current, confirmPassword: event.target.value }))}
                    placeholder="Repeat the starter password"
                    required
                    type="password"
                    value={createUserDraft.confirmPassword}
                  />
                </label>
                <div className="record-actions field-full">
                  <span className="pill">Starter password required</span>
                  <button className="primary-button" disabled={isPending || !isConfigured} type="submit">
                    {isPending ? "Creating account..." : "Create account"}
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          <section className="section-stack">
            {users.map((user) => {
              const draft = drafts[user.id] ?? buildDraft();
              const assignableProjects = projects.filter((project) => project.canManageMembers && project.ownerId !== user.id);
              const projectRoleOptions = getProjectRoleOptions(viewer, user);

              return (
                <article className="content-card" key={user.id}>
                  <div className="section-header">
                    <div>
                      <p className="eyebrow">User</p>
                      <h3>{user.email}</h3>
                    </div>
                    <div className="record-actions">
                      <span className="pill">{getRoleLabel(user.role, user.email)}</span>
                      <span className="pill">{user.isSuspended ? "Suspended" : "Active"}</span>
                    </div>
                  </div>

                  <div className="attachment-list top-gap">
                    <span className="pill">
                      {user.projectAccess.filter((access) => access.isOwner).length} owned /{" "}
                      {user.projectAccess.filter((access) => !access.isOwner).length} assigned
                    </span>
                    <span className="pill">Directory: {user.clientOwnerEmail ?? (user.role === "client" ? user.email : "Unassigned")}</span>
                    {user.createdByEmail ? <span className="pill">Created by {user.createdByEmail}</span> : null}
                  </div>

                  <div className="admin-controls-grid top-gap">
                    <div className="panel-surface admin-panel">
                      <p className="eyebrow">Global Role</p>
                      {viewer?.role === "master_admin" && user.email.toLowerCase() !== MASTER_ADMIN_EMAIL.toLowerCase() ? (
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
                      ) : (
                        <>
                          <strong>{getRoleLabel(user.role, user.email)}</strong>
                          <p className="muted-copy">{user.email.toLowerCase() === MASTER_ADMIN_EMAIL.toLowerCase() ? "Locked account." : "Restricted."}</p>
                        </>
                      )}
                    </div>

                    <div className="panel-surface admin-panel">
                      <p className="eyebrow">Client Directory</p>
                      {user.role === "client" ? (
                        <>
                          <strong>{user.email}</strong>
                          <p className="muted-copy">Own directory.</p>
                        </>
                      ) : viewer?.role === "master_admin" ? (
                        <label className="field">
                          <span>Managed by client</span>
                          <select
                            disabled={isPending || !isConfigured}
                            onChange={(event) => handleClientOwnerChange(user, event.target.value)}
                            value={user.clientOwnerId ?? ""}
                          >
                            <option value="">Unassigned</option>
                            {clientDirectories.map((client) => (
                              <option key={client.id} value={client.id}>
                                {client.email}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <>
                          <strong>{user.clientOwnerEmail ?? "Unassigned"}</strong>
                          <p className="muted-copy">Read only.</p>
                        </>
                      )}
                    </div>

                    <div className="panel-surface admin-panel">
                      <p className="eyebrow">Account Status</p>
                      <strong>{user.isSuspended ? "Suspended" : "Active"}</strong>
                      <p className="muted-copy">Reset or override password from here.</p>
                      <div className="record-actions">
                        <button className="ghost-button" disabled={isPending || !isConfigured} onClick={() => handleResetEmail(user)} type="button">
                          Send reset email
                        </button>
                        {viewer?.role === "master_admin" ? (
                          <button
                            className="ghost-button"
                            disabled={isPending || !isConfigured || user.email.toLowerCase() === MASTER_ADMIN_EMAIL.toLowerCase()}
                            onClick={() => handleSuspensionToggle(user)}
                            type="button"
                          >
                            {user.isSuspended ? "Reactivate user" : "Suspend user"}
                          </button>
                        ) : null}
                      </div>
                      {viewer?.role === "master_admin" ? (
                        <div className="membership-form-grid top-gap">
                          <label className="field">
                            <span>Override password</span>
                            <input
                              onChange={(event) =>
                                updateManagedPasswordDraft(user.id, (current) => ({ ...current, password: event.target.value }))
                              }
                              placeholder="At least 8 characters"
                              type="password"
                              value={(managedPasswordDrafts[user.id] ?? createEmptyPasswordDraft()).password}
                            />
                          </label>
                          <label className="field">
                            <span>Confirm override</span>
                            <input
                              onChange={(event) =>
                                updateManagedPasswordDraft(user.id, (current) => ({ ...current, confirmPassword: event.target.value }))
                              }
                              placeholder="Repeat the override password"
                              type="password"
                              value={(managedPasswordDrafts[user.id] ?? createEmptyPasswordDraft()).confirmPassword}
                            />
                          </label>
                          <div className="record-actions field-full">
                            <button className="ghost-button" disabled={isPending || !isConfigured} onClick={() => handleManagedPasswordOverride(user)} type="button">
                              Set password
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {projectRoleOptions.length ? (
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
                            <option value="">{assignableProjects.length ? "Select project" : "No visible projects"}</option>
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
                            {projectRoleOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
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
                      <div className="record-actions">
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
                  ) : (
                    <div className="panel-surface top-gap">
                      <p className="eyebrow">Project Assignment</p>
                      <strong>Read only</strong>
                      <p className="muted-copy">{viewer?.role === "client" ? "Client scope only." : "Not assignable here."}</p>
                    </div>
                  )}

                  <div className="list-grid top-gap">
                    {user.projectAccess.length ? (
                      user.projectAccess.map((access) => {
                        const project = projects.find((item) => item.id === access.projectId);
                        const canManageThisAccess = Boolean(project?.canManageMembers && !access.isOwner);

                        return (
                          <article className="record-surface" key={`${user.id}-${access.projectId}-${access.membershipId ?? "owner"}`}>
                            <div className="record-header">
                              <div>
                                <strong>{access.projectName}</strong>
                                <p>{access.isOwner ? "Project owner" : getRoleLabel(access.role, user.email)}</p>
                              </div>
                              <div className="record-actions">
                                <span className="pill">{access.isOwner ? "Owner" : "Assigned"}</span>
                                {canManageThisAccess ? (
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
                        );
                      })
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
