import { createFallbackProfile, createFullModulePermissions, createModulePermissions, normalizeRole } from "@/lib/auth";
import { demoProject } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import { getStoragePublicUrl } from "@/lib/storage";
import type { AppUserProfile, ApprovalStatus, ProjectBundle } from "@/types/app";

function normalizeContractorSubmissionType(
  value: unknown
): ProjectBundle["contractorSubmissions"][number]["items"][number]["submissionType"] {
  if (value === "method_statement" || value === "project_programme" || value === "rfi" || value === "material_submission") {
    return value;
  }

  return "material_submission";
}

function mapContractorSubmissionItems(row: {
  id: string;
  items?: unknown;
  submission_type?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
}) {
  const normalizedItems = Array.isArray(row.items)
    ? row.items.flatMap((entry, index) => {
        if (!entry || typeof entry !== "object") return [];
        const item = entry as Record<string, unknown>;
        return [
          {
            id: typeof item.id === "string" ? item.id : `${row.id}-item-${index + 1}`,
            submissionType: normalizeContractorSubmissionType(item.submissionType),
            description: typeof item.description === "string" ? item.description : "",
            quantity:
              item.quantity === null || item.quantity === undefined || item.quantity === ""
                ? null
                : Number(item.quantity),
            unit: typeof item.unit === "string" ? item.unit : ""
          }
        ];
      })
    : [];

  if (normalizedItems.length) {
    return normalizedItems;
  }

  return [
    {
      id: `${row.id}-item-1`,
      submissionType: normalizeContractorSubmissionType(row.submission_type),
      description: row.description ?? "",
      quantity: row.quantity === null || row.quantity === undefined || row.quantity === "" ? null : Number(row.quantity),
      unit: row.unit ?? ""
    }
  ];
}

function mapConsultantSubmissionItems(row: {
  id: string;
  items?: unknown;
  document_type?: string | null;
  description?: string | null;
}) {
  const normalizedItems = Array.isArray(row.items)
    ? row.items.flatMap((entry, index) => {
        if (!entry || typeof entry !== "object") return [];
        const item = entry as Record<string, unknown>;
        return [
          {
            id: typeof item.id === "string" ? item.id : `${row.id}-item-${index + 1}`,
            documentType: typeof item.documentType === "string" ? item.documentType : "",
            description: typeof item.description === "string" ? item.description : ""
          }
        ];
      })
    : [];

  if (normalizedItems.length) {
    return normalizedItems;
  }

  return [
    {
      id: `${row.id}-item-1`,
      documentType: row.document_type ?? "",
      description: row.description ?? ""
    }
  ];
}

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
    "id, project_id, user_id, email, role, can_overview, can_contractor_submissions, can_handover, can_daily_reports, can_weekly_reports, can_financials, can_completion, can_defects";

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
    { data: projectContractors = [] },
    { data: projectConsultants = [] },
    { data: milestones = [] },
    { data: contractorSubmissions = [] },
    { data: consultantSubmissions = [] },
    { data: surveyItems = [] },
    { data: dailyReports = [] },
    { data: weeklyReports = [] },
    { data: financialRecords = [] },
    { data: completionChecklist = [] },
    { data: defectZones = [] },
    { data: defects = [] },
    { data: attachments = [] },
    { data: notifications = [] },
    membershipsResponse
  ] = await Promise.all([
    supabase.from("project_contractors").select("id, project_id, company_name, contractor_type, trades").in("project_id", projectIds),
    supabase.from("project_consultants").select("id, project_id, company_name, trades").in("project_id", projectIds),
    supabase.from("milestones").select("id, project_id, title, due_date").in("project_id", projectIds),
    supabase
      .from("contractor_submissions")
      .select(
        "id, project_id, submission_type, submitted_date, description, quantity, unit, items, owner_user_id, owner_email, owner_role, client_status, client_reviewed_at, client_reviewed_by_user_id, client_reviewed_by_email, client_review_note, consultant_status, consultant_reviewed_at, consultant_reviewed_by_user_id, consultant_reviewed_by_email, consultant_review_note"
      )
      .in("project_id", projectIds),
    supabase
      .from("consultant_submissions")
      .select(
        "id, project_id, submitted_date, document_type, description, items, owner_user_id, owner_email, owner_role, status, reviewed_at, reviewed_by_user_id, reviewed_by_email, review_note"
      )
      .in("project_id", projectIds),
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
    supabase
      .from("project_notifications")
      .select("id, project_id, actor_user_id, actor_email, action, section, title, details, created_at")
      .in("project_id", projectIds)
      .order("created_at", { ascending: false })
      .limit(80),
    viewer.role === "master_admin"
      ? supabase.from("project_members").select(membershipSelect).in("project_id", projectIds)
      : Promise.resolve({ data: safeSelfMembershipRows, error: null })
  ]);

  const safeMilestones = milestones ?? [];
  const safeProjectContractors = projectContractors ?? [];
  const safeProjectConsultants = projectConsultants ?? [];
  const safeContractorSubmissions = contractorSubmissions ?? [];
  const safeConsultantSubmissions = consultantSubmissions ?? [];
  const safeSurveyItems = surveyItems ?? [];
  const safeDailyReports = dailyReports ?? [];
  const safeWeeklyReports = weeklyReports ?? [];
  const safeFinancialRecords = financialRecords ?? [];
  const safeCompletionChecklist = completionChecklist ?? [];
  const safeDefectZones = defectZones ?? [];
  const safeDefects = defects ?? [];
  const safeAttachments = attachments ?? [];
  const safeNotifications = notifications ?? [];
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
        contractor_submissions: item.can_contractor_submissions,
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
          contractor_submissions: item.can_contractor_submissions,
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
    projectContractors: safeProjectContractors
      .filter((item) => item.project_id === row.id)
      .map((item) => ({
        id: item.id,
        companyName: item.company_name,
        contractorType: item.contractor_type as ProjectBundle["projectContractors"][number]["contractorType"],
        trades: Array.isArray(item.trades)
          ? item.trades.filter((trade): trade is ProjectBundle["projectContractors"][number]["trades"][number] => typeof trade === "string")
          : []
      })),
    projectConsultants: safeProjectConsultants
      .filter((item) => item.project_id === row.id)
      .map((item) => ({
        id: item.id,
        companyName: item.company_name,
        trades: Array.isArray(item.trades)
          ? item.trades.filter((trade): trade is ProjectBundle["projectConsultants"][number]["trades"][number] => typeof trade === "string")
          : []
      })),
    milestones: safeMilestones
      .filter((item) => item.project_id === row.id)
      .map((item) => ({ id: item.id, title: item.title, dueDate: item.due_date })),
    contractorSubmissions: safeContractorSubmissions
      .filter((item) => item.project_id === row.id)
      .map((item) => ({
        id: item.id,
        submittedDate: item.submitted_date,
        items: mapContractorSubmissionItems(item),
        ownerUserId: item.owner_user_id ?? "",
        ownerEmail: item.owner_email ?? "",
        ownerRole: normalizeRole(item.owner_role),
        clientStatus: (item.client_status ?? "pending") as ApprovalStatus,
        clientReviewedAt: item.client_reviewed_at ?? null,
        clientReviewedByUserId: item.client_reviewed_by_user_id ?? null,
        clientReviewedByEmail: item.client_reviewed_by_email ?? "",
        clientReviewNote: item.client_review_note ?? "",
        consultantStatus: (item.consultant_status ?? "pending") as ApprovalStatus,
        consultantReviewedAt: item.consultant_reviewed_at ?? null,
        consultantReviewedByUserId: item.consultant_reviewed_by_user_id ?? null,
        consultantReviewedByEmail: item.consultant_reviewed_by_email ?? "",
        consultantReviewNote: item.consultant_review_note ?? "",
        attachments: attachmentsByRecord[`contractor_submission:${item.id}`] ?? []
      })),
    consultantSubmissions: safeConsultantSubmissions
      .filter((item) => item.project_id === row.id)
      .map((item) => ({
        id: item.id,
        submittedDate: item.submitted_date,
        items: mapConsultantSubmissionItems(item),
        ownerUserId: item.owner_user_id ?? "",
        ownerEmail: item.owner_email ?? "",
        ownerRole: normalizeRole(item.owner_role),
        status: (item.status ?? "pending") as ApprovalStatus,
        reviewedAt: item.reviewed_at ?? null,
        reviewedByUserId: item.reviewed_by_user_id ?? null,
        reviewedByEmail: item.reviewed_by_email ?? "",
        reviewNote: item.review_note ?? "",
        attachments: attachmentsByRecord[`consultant_submission:${item.id}`] ?? []
      })),
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
      })),
    notifications: safeNotifications
      .filter((item) => item.project_id === row.id)
      .map((item) => ({
        id: item.id,
        projectId: item.project_id,
        actorUserId: item.actor_user_id ?? null,
        actorEmail: item.actor_email ?? "",
        action: item.action ?? "updated",
        section: item.section ?? "Project",
        title: item.title ?? "Project updated",
        details: item.details ?? "",
        createdAt: item.created_at
      }))
  }));

  return { projects, viewer };
}
