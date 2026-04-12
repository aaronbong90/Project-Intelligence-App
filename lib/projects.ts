import { createFallbackProfile, createFullModulePermissions, createModulePermissions, normalizeRole } from "@/lib/auth";
import { demoProject } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import { getStoragePublicUrl } from "@/lib/storage";
import type { AppUserProfile, ProjectBundle } from "@/types/app";

function hasSupabaseEnv() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export async function getProjectDashboardData(): Promise<{ projects: ProjectBundle[]; viewer: AppUserProfile | null }> {
  if (!hasSupabaseEnv()) {
    return { projects: [demoProject], viewer: null };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { projects: [demoProject], viewer: null };
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

  if (viewer.isSuspended) {
    return { projects: [], viewer };
  }

  const membershipSelect =
    "id, project_id, user_id, email, role, can_overview, can_handover, can_daily_reports, can_weekly_reports, can_financials, can_completion, can_defects";

  const { data: selfMembershipRows = [] } =
    viewer.role === "master_admin"
      ? { data: [] }
      : await supabase.from("project_members").select(membershipSelect).eq("user_id", user.id);
  const safeSelfMembershipRows = selfMembershipRows ?? [];

  let projectRows:
    | Array<{
        id: string;
        owner_id: string;
        name: string;
        location: string | null;
        client_name: string | null;
        contractor_name: string | null;
        details: string | null;
        handover_date: string | null;
        completion_date: string | null;
      }>
    | null = null;
  let error: Error | null = null;

  if (viewer.role === "master_admin") {
    const response = await supabase
      .from("projects")
      .select("id, owner_id, name, location, client_name, contractor_name, details, handover_date, completion_date")
      .order("created_at", { ascending: false });
    projectRows = response.data;
    error = response.error;
  } else {
    const membershipProjectIds = safeSelfMembershipRows.map((row) => row.project_id);
    const [ownedResponse, memberResponse] = await Promise.all([
      supabase
        .from("projects")
        .select("id, owner_id, name, location, client_name, contractor_name, details, handover_date, completion_date")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false }),
      membershipProjectIds.length
        ? supabase
            .from("projects")
            .select("id, owner_id, name, location, client_name, contractor_name, details, handover_date, completion_date")
            .in("id", membershipProjectIds)
        : Promise.resolve({ data: [], error: null })
    ]);

    if (ownedResponse.error) {
      error = ownedResponse.error;
    } else if (memberResponse.error) {
      error = memberResponse.error;
    } else {
      const map = new Map<string, (typeof ownedResponse.data)[number]>();
      (ownedResponse.data ?? []).forEach((row) => {
        if (row) map.set(row.id, row);
      });
      (memberResponse.data ?? []).forEach((row) => {
        if (row) map.set(row.id, row);
      });
      projectRows = Array.from(map.values());
    }
  }

  if (error) {
    return { projects: [], viewer };
  }

  if (!projectRows?.length) {
    return { projects: [], viewer };
  }

  const projectIds = projectRows.map((row) => row.id);

  const [
    { data: milestones = [] },
    { data: surveyItems = [] },
    { data: dailyReports = [] },
    { data: weeklyReports = [] },
    { data: financialRecords = [] },
    { data: completionChecklist = [] },
    { data: defectZones = [] },
    { data: defects = [] },
    { data: attachments = [] },
    membershipsResponse
  ] = await Promise.all([
    supabase.from("milestones").select("id, project_id, title, due_date").in("project_id", projectIds),
    supabase.from("survey_items").select("id, project_id, area, item, status, details").in("project_id", projectIds),
    supabase
      .from("daily_reports")
      .select("id, project_id, report_date, location, work_done, manpower_by_trade")
      .in("project_id", projectIds),
    supabase.from("weekly_reports").select("id, project_id, week_ending, summary").in("project_id", projectIds),
    supabase
      .from("financial_records")
      .select(
        "id, project_id, document_type, reference_number, amount, status, notes, owner_user_id, owner_email, owner_role, submitted_at, reviewed_at, reviewed_by_user_id, reviewed_by_email, review_note"
      )
      .in("project_id", projectIds),
    supabase
      .from("completion_checklist_items")
      .select("id, project_id, item, status, details")
      .in("project_id", projectIds),
    supabase.from("defect_zones").select("id, project_id, name").in("project_id", projectIds),
    supabase.from("defects").select("id, project_id, zone, title, status, details").in("project_id", projectIds),
    supabase
      .from("attachments")
      .select("id, project_id, section_type, record_id, name, mime_type, storage_path")
      .in("project_id", projectIds),
    viewer.role === "master_admin"
      ? supabase.from("project_members").select(membershipSelect).in("project_id", projectIds)
      : Promise.resolve({ data: safeSelfMembershipRows, error: null })
  ]);

  const safeMilestones = milestones ?? [];
  const safeSurveyItems = surveyItems ?? [];
  const safeDailyReports = dailyReports ?? [];
  const safeWeeklyReports = weeklyReports ?? [];
  const safeFinancialRecords = financialRecords ?? [];
  const safeCompletionChecklist = completionChecklist ?? [];
  const safeDefectZones = defectZones ?? [];
  const safeDefects = defects ?? [];
  const safeAttachments = attachments ?? [];
  const safeMemberships = membershipsResponse.data ?? [];

  const attachmentsByRecord = safeAttachments.reduce<Record<string, ProjectBundle["surveyItems"][number]["attachments"]>>(
    (accumulator, item) => {
      const key = `${item.section_type}:${item.record_id}`;
      if (!accumulator[key]) {
        accumulator[key] = [];
      }
      accumulator[key].push({
        id: item.id,
        name: item.name,
        mimeType: item.mime_type,
        path: item.storage_path,
        publicUrl: getStoragePublicUrl(item.storage_path)
      });
      return accumulator;
    },
    {}
  );

  const membershipsByProject = safeMemberships.reduce<Record<string, ProjectBundle["members"]>>((accumulator, item) => {
    if (!accumulator[item.project_id]) {
      accumulator[item.project_id] = [];
    }

    accumulator[item.project_id].push({
      id: item.id,
      userId: item.user_id,
      email: item.email ?? "",
      role: normalizeRole(item.role),
      modules: createModulePermissions({
        overview: item.can_overview,
        handover: item.can_handover,
        daily_reports: item.can_daily_reports,
        weekly_reports: item.can_weekly_reports,
        financials: item.can_financials,
        completion: item.can_completion,
        defects: item.can_defects
      })
    });
    return accumulator;
  }, {});

  const selfMembershipByProject = safeMemberships.reduce<Record<string, ProjectBundle["members"][number]>>((accumulator, item) => {
    if (item.user_id === user.id) {
      accumulator[item.project_id] = {
        id: item.id,
        userId: item.user_id,
        email: item.email ?? "",
        role: normalizeRole(item.role),
        modules: createModulePermissions({
          overview: item.can_overview,
          handover: item.can_handover,
          daily_reports: item.can_daily_reports,
          weekly_reports: item.can_weekly_reports,
          financials: item.can_financials,
          completion: item.can_completion,
          defects: item.can_defects
        })
      };
    }
    return accumulator;
  }, {});

  const projects = projectRows.map((row) => ({
    overview: {
      id: row.id,
      name: row.name,
      location: row.location ?? "",
      clientName: row.client_name ?? "",
      contractorName: row.contractor_name ?? "",
      details: row.details ?? "",
      handoverDate: row.handover_date,
      completionDate: row.completion_date
    },
    access:
      viewer.role === "master_admin" || row.owner_id === user.id
        ? {
            isOwner: row.owner_id === user.id,
            canManageAccess: viewer.role === "master_admin",
            assignedRole: viewer.role,
            modules: createFullModulePermissions()
          }
        : {
            isOwner: false,
            canManageAccess: false,
            assignedRole: selfMembershipByProject[row.id]?.role ?? viewer.role,
            modules: selfMembershipByProject[row.id]?.modules ?? createModulePermissions()
          },
    members: membershipsByProject[row.id] ?? [],
    milestones: safeMilestones
      .filter((item) => item.project_id === row.id)
      .map((item) => ({ id: item.id, title: item.title, dueDate: item.due_date })),
    surveyItems: safeSurveyItems
      .filter((item) => item.project_id === row.id)
      .map((item) => ({
        id: item.id,
        area: item.area,
        item: item.item,
        status: item.status as ProjectBundle["surveyItems"][number]["status"],
        details: item.details ?? "",
        attachments: attachmentsByRecord[`survey_item:${item.id}`] ?? []
      })),
    dailyReports: safeDailyReports
      .filter((item) => item.project_id === row.id)
      .map((item) => ({
        id: item.id,
        reportDate: item.report_date,
        location: item.location,
        workDone: item.work_done ?? "",
        manpowerByTrade: item.manpower_by_trade ?? "",
        attachments: attachmentsByRecord[`daily_report:${item.id}`] ?? []
      })),
    weeklyReports: safeWeeklyReports
      .filter((item) => item.project_id === row.id)
      .map((item) => ({
        id: item.id,
        weekEnding: item.week_ending,
        summary: item.summary ?? "",
        attachments: attachmentsByRecord[`weekly_report:${item.id}`] ?? []
      })),
    financialRecords: safeFinancialRecords
      .filter((item) => item.project_id === row.id)
      .map((item) => ({
        id: item.id,
        documentType: item.document_type as ProjectBundle["financialRecords"][number]["documentType"],
        referenceNumber: item.reference_number ?? "",
        amount: Number(item.amount ?? 0),
        status: item.status as ProjectBundle["financialRecords"][number]["status"],
        notes: item.notes ?? "",
        ownerUserId: item.owner_user_id ?? "",
        ownerEmail: item.owner_email ?? "",
        ownerRole: normalizeRole(item.owner_role),
        submittedAt: item.submitted_at ?? null,
        reviewedAt: item.reviewed_at ?? null,
        reviewedByUserId: item.reviewed_by_user_id ?? null,
        reviewedByEmail: item.reviewed_by_email ?? "",
        reviewNote: item.review_note ?? "",
        attachments: attachmentsByRecord[`financial_record:${item.id}`] ?? []
      })),
    completionChecklist: safeCompletionChecklist
      .filter((item) => item.project_id === row.id)
      .map((item) => ({
        id: item.id,
        item: item.item,
        status: item.status as ProjectBundle["completionChecklist"][number]["status"],
        details: item.details ?? ""
      })),
    defectZones: safeDefectZones
      .filter((item) => item.project_id === row.id)
      .map((item) => ({
        id: item.id,
        name: item.name
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    defects: safeDefects
      .filter((item) => item.project_id === row.id)
      .map((item) => ({
        id: item.id,
        zone: item.zone ?? "",
        title: item.title,
        status: item.status as ProjectBundle["defects"][number]["status"],
        details: item.details ?? "",
        attachments: attachmentsByRecord[`defect:${item.id}`] ?? []
      }))
  }));

  return { projects, viewer };
}
