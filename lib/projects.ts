import { createFallbackProfile, createFullModulePermissions, createModulePermissions, normalizeRole } from "@/lib/auth";
import { demoProject } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import { getStoragePublicUrl } from "@/lib/storage";
import type { AppUserProfile, ApprovalStatus, DrawingType, ProjectBundle, UserRole } from "@/types/app";

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

const BASE_MEMBERSHIP_SELECT =
  "id, project_id, user_id, email, role, can_overview, can_contractor_submissions, can_handover, can_daily_reports, can_weekly_reports, can_financials, can_completion, can_defects";

const MEMBERSHIP_SELECT_WITH_SITE_INTELLIGENCE = `${BASE_MEMBERSHIP_SELECT}, can_site_intelligence`;

const RECTIFICATION_ASSISTANT_SELECT = "root_cause, responsible_trade, rectification_steps, closure_checklist";
const FOLLOW_UP_SELECT = "follow_up_date, follow_up_reason";

const DEFECT_BASE_SELECT = "id, project_id, zone, title, status, details, created_at";
const DEFECT_SELECT_WITH_FOLLOW_UP = `${DEFECT_BASE_SELECT}, ${FOLLOW_UP_SELECT}`;
const DEFECT_SELECT_WITH_RECTIFICATION = `${DEFECT_SELECT_WITH_FOLLOW_UP}, ${RECTIFICATION_ASSISTANT_SELECT}`;

const AI_SITE_OBSERVATION_BASE_SELECT =
  "id, project_id, created_by_user_id, location, trade, image_path, ai_summary, detected_type, confidence, status, linked_record_type, linked_record_id, created_at";

const AI_SITE_OBSERVATION_SELECT_WITH_PROGRESS = `${AI_SITE_OBSERVATION_BASE_SELECT}, previous_observation_id, progress_status, progress_delta_summary, comparison_confidence`;
const AI_SITE_OBSERVATION_SELECT_WITH_RECURRENCE = `${AI_SITE_OBSERVATION_SELECT_WITH_PROGRESS}, recurrence_group_id, recurrence_count, recurrence_summary, is_recurring_issue`;
const AI_SITE_OBSERVATION_SELECT_WITH_FOLLOW_UP = `${AI_SITE_OBSERVATION_SELECT_WITH_RECURRENCE}, ${FOLLOW_UP_SELECT}`;
const AI_SITE_OBSERVATION_SELECT_WITH_ASSISTANT = `${AI_SITE_OBSERVATION_SELECT_WITH_FOLLOW_UP}, ${RECTIFICATION_ASSISTANT_SELECT}`;

const DRAWING_SHEET_BASE_SELECT =
  "id, project_id, title, revision, discipline, sheet_number, file_path, uploaded_by_user_id, created_at";

const DRAWING_SHEET_SELECT_WITH_TYPE = `${DRAWING_SHEET_BASE_SELECT}, drawing_type`;
const DRAWING_SHEET_SELECT_WITH_AI_SUMMARY = `${DRAWING_SHEET_SELECT_WITH_TYPE}, ai_drawing_title, ai_discipline, ai_likely_zones, ai_key_notes, ai_risks, ai_summarized_at`;
const DRAWING_SHEET_SELECT_WITH_AI_SUMMARY_LEGACY = `${DRAWING_SHEET_BASE_SELECT}, ai_drawing_title, ai_discipline, ai_likely_zones, ai_key_notes, ai_risks, ai_summarized_at`;

const DRAWING_LINK_SELECT =
  "id, project_id, drawing_sheet_id, record_type, record_id, x_coordinate, y_coordinate, markup_label, notes, created_by_user_id, created_at";

type ProjectMembershipRow = {
  id: string;
  project_id: string;
  user_id: string | null;
  email: string | null;
  role: string | null;
  can_overview: boolean | null;
  can_contractor_submissions: boolean | null;
  can_handover: boolean | null;
  can_daily_reports: boolean | null;
  can_weekly_reports: boolean | null;
  can_financials: boolean | null;
  can_completion: boolean | null;
  can_defects: boolean | null;
  can_site_intelligence?: boolean | null;
};

type MembershipResponse = {
  data: ProjectMembershipRow[] | null;
  error: { message?: string; code?: string } | null;
};

type MembershipQuery = {
  eq(column: string, value: string): PromiseLike<MembershipResponse>;
  in(column: string, values: string[]): PromiseLike<MembershipResponse>;
};

function isMissingSiteIntelligenceColumn(error: { message?: string; code?: string } | null | undefined) {
  return (
    error?.code === "42703" ||
    (typeof error?.message === "string" &&
      error.message.includes("can_site_intelligence") &&
      error.message.includes("does not exist"))
  );
}

function isMissingProgressComparisonColumn(error: { message?: string; code?: string } | null | undefined) {
  return (
    error?.code === "42703" ||
    (typeof error?.message === "string" &&
      ["previous_observation_id", "progress_status", "progress_delta_summary", "comparison_confidence"].some((column) =>
        error.message?.includes(column)
      ) &&
      error.message.includes("does not exist"))
  );
}

function isMissingRecurrenceColumn(error: { message?: string; code?: string } | null | undefined) {
  return (
    error?.code === "42703" ||
    (typeof error?.message === "string" &&
      ["recurrence_group_id", "recurrence_count", "recurrence_summary", "is_recurring_issue"].some((column) =>
        error.message?.includes(column)
      ) &&
      error.message.includes("does not exist"))
  );
}

function isMissingRectificationColumn(error: { message?: string; code?: string } | null | undefined) {
  return (
    error?.code === "42703" ||
    (typeof error?.message === "string" &&
      ["root_cause", "responsible_trade", "rectification_steps", "closure_checklist"].some((column) => error.message?.includes(column)) &&
      error.message.includes("does not exist"))
  );
}

function isMissingFollowUpColumn(error: { message?: string; code?: string } | null | undefined) {
  return (
    error?.code === "42703" ||
    (typeof error?.message === "string" &&
      ["follow_up_date", "follow_up_reason"].some((column) => error.message?.includes(column)) &&
      error.message.includes("does not exist"))
  );
}

function isMissingDrawingTable(error: { message?: string; code?: string } | null | undefined) {
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    error?.code === "PGRST106" ||
    (typeof error?.message === "string" &&
      (error.message.includes("drawing_sheets") || error.message.includes("drawing_links")) &&
      (error.message.includes("does not exist") || error.message.includes("schema cache") || error.message.includes("Could not find")))
  );
}

function isMissingDrawingSummaryColumn(error: { message?: string; code?: string } | null | undefined) {
  return (
    error?.code === "42703" ||
    (typeof error?.message === "string" &&
      ["ai_drawing_title", "ai_discipline", "ai_likely_zones", "ai_key_notes", "ai_risks", "ai_summarized_at"].some((column) =>
        error.message?.includes(column)
      ) &&
      error.message.includes("does not exist"))
  );
}

function isMissingDrawingTypeColumn(error: { message?: string; code?: string } | null | undefined) {
  return (
    error?.code === "42703" ||
    (typeof error?.message === "string" &&
      error.message.includes("drawing_type") &&
      (error.message.includes("does not exist") || error.message.includes("schema cache") || error.message.includes("Could not find")))
  );
}

function normalizeDrawingType(value: unknown): DrawingType {
  if (value === "tender_drawing" || value === "shop_drawing" || value === "as_built_drawing" || value === "design_drawing") {
    return value;
  }

  return "design_drawing";
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function mapRectificationAssistant(row: Record<string, unknown>): ProjectBundle["defects"][number]["rectification"] {
  return {
    rootCause: typeof row.root_cause === "string" ? row.root_cause : "",
    responsibleTrade: typeof row.responsible_trade === "string" ? row.responsible_trade : "",
    rectificationSteps: normalizeStringArray(row.rectification_steps),
    closureChecklist: normalizeStringArray(row.closure_checklist)
  };
}

async function loadMembershipRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  applyFilters: (query: MembershipQuery) => PromiseLike<MembershipResponse>
) {
  const response = await applyFilters(
    supabase.from("project_members").select(MEMBERSHIP_SELECT_WITH_SITE_INTELLIGENCE) as unknown as MembershipQuery
  );

  if (!isMissingSiteIntelligenceColumn(response.error)) {
    return response;
  }

  return applyFilters(supabase.from("project_members").select(BASE_MEMBERSHIP_SELECT) as unknown as MembershipQuery);
}

async function loadAiSiteObservationRows(supabase: Awaited<ReturnType<typeof createClient>>, projectIds: string[]) {
  const response = await supabase
    .from("ai_site_observations")
    .select(AI_SITE_OBSERVATION_SELECT_WITH_ASSISTANT)
    .in("project_id", projectIds)
    .order("created_at", { ascending: false });

  if (
    !isMissingRectificationColumn(response.error) &&
    !isMissingFollowUpColumn(response.error) &&
    !isMissingRecurrenceColumn(response.error) &&
    !isMissingProgressComparisonColumn(response.error)
  ) {
    return response;
  }

  const followUpResponse = await supabase
    .from("ai_site_observations")
    .select(AI_SITE_OBSERVATION_SELECT_WITH_FOLLOW_UP)
    .in("project_id", projectIds)
    .order("created_at", { ascending: false });

  if (!isMissingFollowUpColumn(followUpResponse.error) && !isMissingRecurrenceColumn(followUpResponse.error) && !isMissingProgressComparisonColumn(followUpResponse.error)) {
    return followUpResponse;
  }

  const recurrenceResponse = await supabase
    .from("ai_site_observations")
    .select(AI_SITE_OBSERVATION_SELECT_WITH_RECURRENCE)
    .in("project_id", projectIds)
    .order("created_at", { ascending: false });

  if (!isMissingRecurrenceColumn(recurrenceResponse.error) && !isMissingProgressComparisonColumn(recurrenceResponse.error)) {
    return recurrenceResponse;
  }

  const progressResponse = await supabase
    .from("ai_site_observations")
    .select(AI_SITE_OBSERVATION_SELECT_WITH_PROGRESS)
    .in("project_id", projectIds)
    .order("created_at", { ascending: false });

  if (!isMissingProgressComparisonColumn(progressResponse.error)) {
    return progressResponse;
  }

  return supabase
    .from("ai_site_observations")
    .select(AI_SITE_OBSERVATION_BASE_SELECT)
    .in("project_id", projectIds)
    .order("created_at", { ascending: false });
}

async function loadDefectRows(supabase: Awaited<ReturnType<typeof createClient>>, projectIds: string[]) {
  const response = await supabase.from("defects").select(DEFECT_SELECT_WITH_RECTIFICATION).in("project_id", projectIds);

  if (!isMissingRectificationColumn(response.error) && !isMissingFollowUpColumn(response.error)) {
    return response;
  }

  const followUpResponse = await supabase.from("defects").select(DEFECT_SELECT_WITH_FOLLOW_UP).in("project_id", projectIds);

  if (!isMissingFollowUpColumn(followUpResponse.error)) {
    return followUpResponse;
  }

  return supabase.from("defects").select(DEFECT_BASE_SELECT).in("project_id", projectIds);
}

async function loadDrawingSheetRows(supabase: Awaited<ReturnType<typeof createClient>>, projectIds: string[]) {
  const response = await supabase
    .from("drawing_sheets")
    .select(DRAWING_SHEET_SELECT_WITH_AI_SUMMARY)
    .in("project_id", projectIds)
    .order("created_at", { ascending: false });

  if (isMissingDrawingTable(response.error)) {
    return { data: [], error: null };
  }

  if (isMissingDrawingTypeColumn(response.error)) {
    const legacyResponse = await supabase
      .from("drawing_sheets")
      .select(DRAWING_SHEET_SELECT_WITH_AI_SUMMARY_LEGACY)
      .in("project_id", projectIds)
      .order("created_at", { ascending: false });

    if (isMissingDrawingSummaryColumn(legacyResponse.error)) {
      return supabase
        .from("drawing_sheets")
        .select(DRAWING_SHEET_BASE_SELECT)
        .in("project_id", projectIds)
        .order("created_at", { ascending: false });
    }

    return legacyResponse;
  }

  if (isMissingDrawingSummaryColumn(response.error)) {
    const typeResponse = await supabase
      .from("drawing_sheets")
      .select(DRAWING_SHEET_SELECT_WITH_TYPE)
      .in("project_id", projectIds)
      .order("created_at", { ascending: false });

    if (isMissingDrawingTypeColumn(typeResponse.error)) {
      return supabase
        .from("drawing_sheets")
        .select(DRAWING_SHEET_BASE_SELECT)
        .in("project_id", projectIds)
        .order("created_at", { ascending: false });
    }

    return typeResponse;
  }

  return response;
}

async function loadDrawingLinkRows(supabase: Awaited<ReturnType<typeof createClient>>, projectIds: string[]) {
  const response = await supabase
    .from("drawing_links")
    .select(DRAWING_LINK_SELECT)
    .in("project_id", projectIds)
    .order("created_at", { ascending: false });

  if (isMissingDrawingTable(response.error)) {
    return { data: [], error: null };
  }

  return response;
}

function normalizeAiSiteObservationStatus(value: unknown): ProjectBundle["aiSiteObservations"][number]["status"] {
  if (
    value === "reviewed" ||
    value === "approved" ||
    value === "converted" ||
    value === "dismissed" ||
    value === "failed" ||
    value === "pending"
  ) {
    return value;
  }

  return "pending";
}

function normalizeAiLinkedRecordType(value: unknown): ProjectBundle["aiSiteObservations"][number]["linkedRecordType"] {
  if (value === "defect" || value === "daily_report") {
    return value;
  }

  return null;
}

function normalizeDrawingLinkRecordType(value: unknown): ProjectBundle["drawingLinks"][number]["recordType"] {
  if (value === "ai_site_observation" || value === "defect" || value === "daily_report") {
    return value;
  }

  return "ai_site_observation";
}

function normalizeAiProgressStatus(value: unknown): ProjectBundle["aiSiteObservations"][number]["progressStatus"] {
  if (value === "improved" || value === "unchanged" || value === "delayed" || value === "worsened" || value === "unknown") {
    return value;
  }

  if (value === "progress_detected") return "improved";
  if (value === "no_visible_change") return "unchanged";
  if (value === "possible_delay" || value === "repeated_issue") return "delayed";
  if (value === "worsening_condition") return "worsened";

  return "unknown";
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

  const selfMembershipResponse =
    viewer.role === "master_admin"
      ? { data: [] as ProjectMembershipRow[], error: null }
      : await loadMembershipRows(supabase, (query) => query.eq("user_id", user.id));
  const safeSelfMembershipRows = selfMembershipResponse.data ?? [];

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
    { data: aiSiteObservations = [] },
    { data: drawingSheets = [] },
    { data: drawingLinks = [] },
    { data: attachments = [] },
    { data: notifications = [] }
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
    loadDefectRows(supabase, projectIds),
    loadAiSiteObservationRows(supabase, projectIds),
    loadDrawingSheetRows(supabase, projectIds),
    loadDrawingLinkRows(supabase, projectIds),
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
  const safeAiSiteObservations = aiSiteObservations ?? [];
  const safeDrawingSheets = drawingSheets ?? [];
  const safeDrawingLinks = drawingLinks ?? [];
  const safeAttachments = attachments ?? [];
  const safeNotifications = notifications ?? [];
  const membershipsResponse =
    viewer.role === "master_admin"
      ? await loadMembershipRows(supabase, (query) => query.in("project_id", projectIds))
      : { data: safeSelfMembershipRows, error: null };
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
      userId: item.user_id ?? "",
      email: item.email ?? "",
      role: normalizeRole(item.role),
      modules: createModulePermissions({
        overview: Boolean(item.can_overview),
        contractor_submissions: Boolean(item.can_contractor_submissions),
        handover: Boolean(item.can_handover),
        daily_reports: Boolean(item.can_daily_reports),
        weekly_reports: Boolean(item.can_weekly_reports),
        financials: Boolean(item.can_financials),
        completion: Boolean(item.can_completion),
        defects: Boolean(item.can_defects),
        site_intelligence: Boolean(item.can_site_intelligence)
      })
    });
    return accumulator;
  }, {});

  const selfMembershipByProject = safeMemberships.reduce<Record<string, ProjectBundle["members"][number]>>((accumulator, item) => {
    if (item.user_id === user.id) {
      accumulator[item.project_id] = {
        id: item.id,
        userId: item.user_id ?? "",
        email: item.email ?? "",
        role: normalizeRole(item.role),
        modules: createModulePermissions({
          overview: Boolean(item.can_overview),
          contractor_submissions: Boolean(item.can_contractor_submissions),
          handover: Boolean(item.can_handover),
          daily_reports: Boolean(item.can_daily_reports),
          weekly_reports: Boolean(item.can_weekly_reports),
          financials: Boolean(item.can_financials),
          completion: Boolean(item.can_completion),
          defects: Boolean(item.can_defects),
          site_intelligence: Boolean(item.can_site_intelligence)
        })
      };
    }
    return accumulator;
  }, {});

  function resolveContractorSubmissionOwnerRole(projectId: string, ownerEmail: string, storedRole?: string | null): UserRole {
    const memberRole = membershipsByProject[projectId]?.find((member) => member.email.toLowerCase() === ownerEmail.toLowerCase())?.role;
    if (memberRole && memberRole !== "consultant") {
      return memberRole;
    }

    const normalizedRole = normalizeRole(storedRole);
    return normalizedRole === "consultant" ? "contractor" : normalizedRole;
  }

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
        ownerRole: resolveContractorSubmissionOwnerRole(row.id, item.owner_email ?? "", item.owner_role),
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
      .map((rawItem) => {
        const item = rawItem as typeof rawItem & {
          follow_up_date?: string | null;
          follow_up_reason?: string | null;
          created_at?: string | null;
        };

        return {
          id: item.id,
          zone: item.zone ?? "",
          title: item.title,
          status: item.status as ProjectBundle["defects"][number]["status"],
          details: item.details ?? "",
          followUpDate: item.follow_up_date ?? null,
          followUpReason: item.follow_up_reason ?? "",
          rectification: mapRectificationAssistant(item),
          attachments: attachmentsByRecord[`defect:${item.id}`] ?? [],
          createdAt: item.created_at ?? ""
        };
      }),
    aiSiteObservations: safeAiSiteObservations
      .filter((item) => item.project_id === row.id)
      .map((rawItem) => {
        const item = rawItem as typeof rawItem & {
          previous_observation_id?: string | null;
          progress_status?: unknown;
          progress_delta_summary?: string | null;
          comparison_confidence?: number | string | null;
          recurrence_group_id?: string | null;
          recurrence_count?: number | string | null;
          recurrence_summary?: string | null;
          is_recurring_issue?: boolean | null;
          follow_up_date?: string | null;
          follow_up_reason?: string | null;
          root_cause?: string | null;
          responsible_trade?: string | null;
          rectification_steps?: unknown;
          closure_checklist?: unknown;
        };

        return {
          id: item.id,
          projectId: item.project_id,
          createdByUserId: item.created_by_user_id ?? null,
          location: item.location ?? "",
          trade: item.trade ?? "",
          imagePath: item.image_path,
          imagePublicUrl: getStoragePublicUrl(item.image_path),
          aiSummary: item.ai_summary ?? "",
          detectedType: item.detected_type ?? "unknown",
          confidence: Number(item.confidence ?? 0),
          status: normalizeAiSiteObservationStatus(item.status),
          linkedRecordType: normalizeAiLinkedRecordType(item.linked_record_type),
          linkedRecordId: item.linked_record_id ?? null,
          previousObservationId: item.previous_observation_id ?? null,
          progressStatus: normalizeAiProgressStatus(item.progress_status),
          progressDeltaSummary: item.progress_delta_summary ?? "",
          comparisonConfidence: Number(item.comparison_confidence ?? 0),
          recurrenceGroupId: item.recurrence_group_id ?? null,
          recurrenceCount: Number(item.recurrence_count ?? 0),
          recurrenceSummary: item.recurrence_summary ?? "",
          isRecurringIssue: Boolean(item.is_recurring_issue),
          followUpDate: item.follow_up_date ?? null,
          followUpReason: item.follow_up_reason ?? "",
          rectification: mapRectificationAssistant(item),
          createdAt: item.created_at
        };
      }),
    drawingSheets: safeDrawingSheets
      .filter((item) => item.project_id === row.id)
      .map((rawItem) => {
        const item = rawItem as typeof rawItem & {
          drawing_type?: string | null;
          ai_drawing_title?: string | null;
          ai_discipline?: string | null;
          ai_likely_zones?: unknown;
          ai_key_notes?: unknown;
          ai_risks?: unknown;
          ai_summarized_at?: string | null;
        };

        return {
          id: item.id,
          projectId: item.project_id,
          title: item.title ?? "",
          drawingType: normalizeDrawingType(item.drawing_type),
          revision: item.revision ?? "",
          discipline: item.discipline ?? "",
          sheetNumber: item.sheet_number ?? "",
          filePath: item.file_path ?? "",
          filePublicUrl: item.file_path ? getStoragePublicUrl(item.file_path) : null,
          aiDrawingTitle: typeof item.ai_drawing_title === "string" ? item.ai_drawing_title : "",
          aiDiscipline: typeof item.ai_discipline === "string" ? item.ai_discipline : "",
          aiLikelyZones: normalizeStringArray(item.ai_likely_zones),
          aiKeyNotes: normalizeStringArray(item.ai_key_notes),
          aiRisks: normalizeStringArray(item.ai_risks),
          aiSummarizedAt: typeof item.ai_summarized_at === "string" ? item.ai_summarized_at : null,
          uploadedByUserId: item.uploaded_by_user_id ?? null,
          createdAt: item.created_at
        };
      }),
    drawingLinks: safeDrawingLinks
      .filter((item) => item.project_id === row.id)
      .map((item) => ({
        id: item.id,
        projectId: item.project_id,
        drawingSheetId: item.drawing_sheet_id,
        recordType: normalizeDrawingLinkRecordType(item.record_type),
        recordId: item.record_id,
        xCoordinate: item.x_coordinate === null || item.x_coordinate === undefined ? null : Number(item.x_coordinate),
        yCoordinate: item.y_coordinate === null || item.y_coordinate === undefined ? null : Number(item.y_coordinate),
        markupLabel: item.markup_label ?? "",
        notes: item.notes ?? "",
        createdByUserId: item.created_by_user_id ?? null,
        createdAt: item.created_at
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
