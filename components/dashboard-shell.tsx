"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { ReactNode } from "react";
import {
  canReviewFinancialRecords,
  canSeeAllFinancialRecords,
  createFullModulePermissions,
  createModulePermissions,
  getRoleLabel,
  MODULE_KEYS,
  normalizeRole
} from "@/lib/auth";
import {
  FREE_PILOT_EXCEL_IMPORT_ACCEPT,
  FREE_PILOT_IMAGE_ONLY_ACCEPT,
  FREE_PILOT_MIXED_ACCEPT,
  getFreePilotUploadHint,
  type FreePilotUploadMode
} from "@/lib/free-pilot";
import { prepareFreePilotFiles } from "@/lib/free-pilot-client";
import { createClient } from "@/lib/supabase/client";
import { PROJECT_FILES_BUCKET } from "@/lib/storage";
import { cn, formatCountdown, formatCurrency, formatDate, formatDateTime, formatSectionLabel, sanitizeFilename } from "@/lib/utils";
import type {
  AttachmentRecord,
  ApprovalStatus,
  AppUserProfile,
  ChecklistStatus,
  CompletionStatus,
  ConsultantTrade,
  ContractorPartyType,
  ContractorTrade,
  DefectRecord,
  DefectStatus,
  FinancialStatus,
  ModuleKey,
  ModulePermissions,
  ProjectMember,
  ProjectBundle,
  ProjectNotification,
  RecordSectionType
} from "@/types/app";

const CONTRACTOR_SUBMISSION_SELECT =
  "id, submission_type, submitted_date, description, quantity, unit, items, owner_user_id, owner_email, owner_role, client_status, client_reviewed_at, client_reviewed_by_user_id, client_reviewed_by_email, client_review_note, consultant_status, consultant_reviewed_at, consultant_reviewed_by_user_id, consultant_reviewed_by_email, consultant_review_note";
const CONSULTANT_SUBMISSION_SELECT =
  "id, submitted_date, document_type, description, items, owner_user_id, owner_email, owner_role, status, reviewed_at, reviewed_by_user_id, reviewed_by_email, review_note";

const CONTRACTOR_TYPE_OPTIONS: Array<{ value: ContractorPartyType; label: string }> = [
  { value: "main_contractor", label: "Main Contractor" },
  { value: "subcontractor", label: "Sub Contractor" }
];

const CONTRACTOR_TRADE_OPTIONS: Array<{ value: ContractorTrade; label: string }> = [
  { value: "architectural", label: "Architectural" },
  { value: "electrical", label: "Electrical" },
  { value: "plumbing_sanitary", label: "Plumbing & Sanitary" },
  { value: "fire_protection", label: "Fire Protection" },
  { value: "electrical_low_voltage", label: "Electrical (Low Voltage)" }
];

const CONSULTANT_TRADE_OPTIONS: Array<{ value: ConsultantTrade; label: string }> = [
  { value: "architect", label: "Architect" },
  { value: "mep", label: "MEP" }
];

const CONSULTANT_DOCUMENT_STATUS_LABELS: Partial<Record<ApprovalStatus, string>> = {
  approved: "Accepted",
  rejected: "Returned"
};

type ContractorSubmissionDraftItem = {
  id: string;
  submissionType: ProjectBundle["contractorSubmissions"][number]["items"][number]["submissionType"];
  description: string;
  quantity: string;
  unit: string;
};

type ConsultantSubmissionDraftItem = {
  id: string;
  documentType: string;
  description: string;
};

type CompletionDraftItem = {
  id: string;
  item: string;
  status: CompletionStatus;
  details: string;
};

type DefectDraftItem = {
  id: string;
  zone: string;
  title: string;
  status: DefectStatus;
  details: string;
  attachments: File[];
};

function createDraftId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyContractorSubmissionDraftItem(id = "contractor-draft-1"): ContractorSubmissionDraftItem {
  return {
    id,
    submissionType: "material_submission",
    description: "",
    quantity: "",
    unit: ""
  };
}

function createEmptyConsultantSubmissionDraftItem(id = "consultant-draft-1"): ConsultantSubmissionDraftItem {
  return {
    id,
    documentType: "",
    description: ""
  };
}

function createEmptyCompletionDraftItem(id = "completion-draft-1"): CompletionDraftItem {
  return {
    id,
    item: "",
    status: "open",
    details: ""
  };
}

function createEmptyDefectDraftItem(id = "defect-draft-1"): DefectDraftItem {
  return {
    id,
    zone: "",
    title: "",
    status: "open",
    details: "",
    attachments: []
  };
}

function emptyProject(name = ""): ProjectBundle {
  return {
    overview: {
      id: "",
      name,
      location: "",
      clientName: "",
      contractorName: "",
      details: "",
      handoverDate: null,
      completionDate: null
    },
    access: {
      isOwner: false,
      canManageAccess: false,
      assignedRole: "consultant",
      modules: createModulePermissions()
    },
    members: [],
    projectContractors: [],
    projectConsultants: [],
    milestones: [],
    contractorSubmissions: [],
    consultantSubmissions: [],
    surveyItems: [],
    dailyReports: [],
    weeklyReports: [],
    financialRecords: [],
    completionChecklist: [],
    defectZones: [],
    defects: [],
    notifications: []
  };
}

function getUploadModeForSection(sectionType: RecordSectionType): FreePilotUploadMode {
  if (sectionType === "contractor_submission" || sectionType === "consultant_submission" || sectionType === "weekly_report" || sectionType === "financial_record") {
    return "mixed";
  }

  return "image-only";
}

function getUploadAcceptForMode(mode: FreePilotUploadMode) {
  return mode === "mixed" ? FREE_PILOT_MIXED_ACCEPT : FREE_PILOT_IMAGE_ONLY_ACCEPT;
}

function FreePilotUploadHint({ mode }: { mode: FreePilotUploadMode }) {
  return <p className="field-hint">{getFreePilotUploadHint(mode)}</p>;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function AttachmentList({ attachments }: { attachments: AttachmentRecord[] }) {
  if (!attachments.length) {
    return <span className="pill">0 attachments</span>;
  }

  return (
    <div className="attachment-list">
      {attachments.map((attachment) => (
        <a
          className="attachment-link"
          href={attachment.publicUrl ?? "#"}
          key={attachment.id}
          rel="noreferrer"
          target="_blank"
        >
          {attachment.name}
        </a>
      ))}
    </div>
  );
}

function buildFinancialRecordFromRow(data: Record<string, unknown>, attachments: AttachmentRecord[]): ProjectBundle["financialRecords"][number] {
  return {
    id: String(data.id),
    documentType: data.document_type as ProjectBundle["financialRecords"][number]["documentType"],
    referenceNumber: String(data.reference_number ?? ""),
    amount: Number(data.amount ?? 0),
    status: data.status as FinancialStatus,
    notes: String(data.notes ?? ""),
    ownerUserId: String(data.owner_user_id ?? ""),
    ownerEmail: String(data.owner_email ?? ""),
    ownerRole: normalizeRole(typeof data.owner_role === "string" ? data.owner_role : undefined),
    submittedAt: typeof data.submitted_at === "string" ? data.submitted_at : null,
    reviewedAt: typeof data.reviewed_at === "string" ? data.reviewed_at : null,
    reviewedByUserId: typeof data.reviewed_by_user_id === "string" ? data.reviewed_by_user_id : null,
    reviewedByEmail: String(data.reviewed_by_email ?? ""),
    reviewNote: String(data.review_note ?? ""),
    attachments
  };
}

function buildProjectContractorFromRow(data: Record<string, unknown>): ProjectBundle["projectContractors"][number] {
  return {
    id: String(data.id),
    companyName: String(data.company_name ?? ""),
    contractorType: data.contractor_type as ContractorPartyType,
    trades: Array.isArray(data.trades)
      ? data.trades.filter((trade): trade is ContractorTrade => typeof trade === "string")
      : []
  };
}

function buildProjectConsultantFromRow(data: Record<string, unknown>): ProjectBundle["projectConsultants"][number] {
  return {
    id: String(data.id),
    companyName: String(data.company_name ?? ""),
    trades: Array.isArray(data.trades)
      ? data.trades.filter((trade): trade is ConsultantTrade => typeof trade === "string")
      : []
  };
}

function sortProjectContractors(contractors: ProjectBundle["projectContractors"]) {
  return [...contractors].sort((left, right) => {
    if (left.contractorType !== right.contractorType) {
      return left.contractorType === "main_contractor" ? -1 : 1;
    }

    return left.companyName.localeCompare(right.companyName);
  });
}

function sortProjectConsultants(consultants: ProjectBundle["projectConsultants"]) {
  return [...consultants].sort((left, right) => left.companyName.localeCompare(right.companyName));
}

function formatContractorTypeLabel(value: ContractorPartyType) {
  return CONTRACTOR_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? "Contractor";
}

function formatContractorTradeLabel(value: ContractorTrade) {
  return CONTRACTOR_TRADE_OPTIONS.find((option) => option.value === value)?.label ?? formatSectionLabel(value);
}

function formatConsultantTradeLabel(value: ConsultantTrade) {
  return CONSULTANT_TRADE_OPTIONS.find((option) => option.value === value)?.label ?? formatSectionLabel(value);
}

function normalizeContractorSubmissionType(
  value: unknown
): ProjectBundle["contractorSubmissions"][number]["items"][number]["submissionType"] {
  if (value === "method_statement" || value === "project_programme" || value === "rfi" || value === "material_submission") {
    return value;
  }

  return "material_submission";
}

function buildContractorSubmissionFromRow(
  data: Record<string, unknown>,
  attachments: AttachmentRecord[]
): ProjectBundle["contractorSubmissions"][number] {
  const normalizedItems = Array.isArray(data.items)
    ? data.items.flatMap((entry, index) => {
        if (!entry || typeof entry !== "object") return [];
        const item = entry as Record<string, unknown>;

        return [
          {
            id: typeof item.id === "string" ? item.id : `${String(data.id)}-item-${index + 1}`,
            submissionType: normalizeContractorSubmissionType(item.submissionType),
            description: String(item.description ?? ""),
            quantity: item.quantity === null || item.quantity === undefined || item.quantity === "" ? null : Number(item.quantity),
            unit: String(item.unit ?? "")
          }
        ];
      })
    : [];

  return {
    id: String(data.id),
    submittedDate: String(data.submitted_date ?? ""),
    items:
      normalizedItems.length > 0
        ? normalizedItems
        : [
            {
              id: `${String(data.id)}-item-1`,
              submissionType: normalizeContractorSubmissionType(data.submission_type),
              description: String(data.description ?? ""),
              quantity: data.quantity === null || data.quantity === undefined || data.quantity === "" ? null : Number(data.quantity),
              unit: String(data.unit ?? "")
            }
          ],
    ownerUserId: String(data.owner_user_id ?? ""),
    ownerEmail: String(data.owner_email ?? ""),
    ownerRole: normalizeRole(typeof data.owner_role === "string" ? data.owner_role : undefined),
    clientStatus: (data.client_status ?? "pending") as ApprovalStatus,
    clientReviewedAt: typeof data.client_reviewed_at === "string" ? data.client_reviewed_at : null,
    clientReviewedByUserId: typeof data.client_reviewed_by_user_id === "string" ? data.client_reviewed_by_user_id : null,
    clientReviewedByEmail: String(data.client_reviewed_by_email ?? ""),
    clientReviewNote: String(data.client_review_note ?? ""),
    consultantStatus: (data.consultant_status ?? "pending") as ApprovalStatus,
    consultantReviewedAt: typeof data.consultant_reviewed_at === "string" ? data.consultant_reviewed_at : null,
    consultantReviewedByUserId:
      typeof data.consultant_reviewed_by_user_id === "string" ? data.consultant_reviewed_by_user_id : null,
    consultantReviewedByEmail: String(data.consultant_reviewed_by_email ?? ""),
    consultantReviewNote: String(data.consultant_review_note ?? ""),
    attachments
  };
}

function buildConsultantSubmissionFromRow(
  data: Record<string, unknown>,
  attachments: AttachmentRecord[]
): ProjectBundle["consultantSubmissions"][number] {
  const normalizedItems = Array.isArray(data.items)
    ? data.items.flatMap((entry, index) => {
        if (!entry || typeof entry !== "object") return [];
        const item = entry as Record<string, unknown>;

        return [
          {
            id: typeof item.id === "string" ? item.id : `${String(data.id)}-item-${index + 1}`,
            documentType: String(item.documentType ?? ""),
            description: String(item.description ?? "")
          }
        ];
      })
    : [];

  return {
    id: String(data.id),
    submittedDate: String(data.submitted_date ?? ""),
    items:
      normalizedItems.length > 0
        ? normalizedItems
        : [
            {
              id: `${String(data.id)}-item-1`,
              documentType: String(data.document_type ?? ""),
              description: String(data.description ?? "")
            }
          ],
    ownerUserId: String(data.owner_user_id ?? ""),
    ownerEmail: String(data.owner_email ?? ""),
    ownerRole: normalizeRole(typeof data.owner_role === "string" ? data.owner_role : undefined),
    status: (data.status ?? "pending") as ApprovalStatus,
    reviewedAt: typeof data.reviewed_at === "string" ? data.reviewed_at : null,
    reviewedByUserId: typeof data.reviewed_by_user_id === "string" ? data.reviewed_by_user_id : null,
    reviewedByEmail: String(data.reviewed_by_email ?? ""),
    reviewNote: String(data.review_note ?? ""),
    attachments
  };
}

function getApprovalLabel(status: ApprovalStatus, labels?: Partial<Record<ApprovalStatus, string>>) {
  const customLabel = labels?.[status];
  if (customLabel) return customLabel;
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Pending";
}

function getContractorSubmissionOverallStatus(
  submission: ProjectBundle["contractorSubmissions"][number]
): ApprovalStatus {
  if (submission.clientStatus === "rejected" || submission.consultantStatus === "rejected") {
    return "rejected";
  }

  if (submission.clientStatus === "approved" && submission.consultantStatus === "approved") {
    return "approved";
  }

  return "pending";
}

function getSafeContractorSubmissionItems(submission: ProjectBundle["contractorSubmissions"][number]) {
  return Array.isArray(submission.items) ? submission.items : [];
}

function getSafeConsultantSubmissionItems(submission: ProjectBundle["consultantSubmissions"][number]) {
  return Array.isArray(submission.items) ? submission.items : [];
}

function StatusPill({
  status,
  label,
  labels
}: {
  status: ApprovalStatus;
  label?: string;
  labels?: Partial<Record<ApprovalStatus, string>>;
}) {
  return (
    <span className={cn("pill", "status-pill", `status-${status}`)}>
      {label ? `${label}: ${getApprovalLabel(status, labels)}` : getApprovalLabel(status, labels)}
    </span>
  );
}

function TonePill({ tone, children }: { tone: "pending" | "approved" | "rejected"; children: ReactNode }) {
  return <span className={cn("pill", "status-pill", `status-${tone}`)}>{children}</span>;
}

function FinancialStatusPill({ status }: { status: FinancialStatus }) {
  const tone = status === "approved" || status === "paid" ? "approved" : status === "rejected" ? "rejected" : "pending";
  return <TonePill tone={tone}>{formatSectionLabel(status)}</TonePill>;
}

function CompletionStatusPill({ status }: { status: CompletionStatus }) {
  const tone = status === "completed" ? "approved" : "pending";
  return <TonePill tone={tone}>{formatSectionLabel(status)}</TonePill>;
}

function DefectStatusPill({ status }: { status: DefectStatus }) {
  const tone = status === "closed" ? "approved" : "pending";
  return <TonePill tone={tone}>{formatSectionLabel(status)}</TonePill>;
}

function DisclosureCard({
  title,
  subtitle,
  eyebrow,
  meta,
  badge,
  className,
  children
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  meta?: ReactNode;
  badge?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details className={cn("disclosure-card", className)}>
      <summary className="disclosure-summary">
        <span className="disclosure-copy">
          {eyebrow ? <span className="eyebrow disclosure-eyebrow">{eyebrow}</span> : null}
          <strong>{title}</strong>
          {subtitle ? <span className="muted-copy disclosure-subtitle">{subtitle}</span> : null}
          {meta ? <span className="disclosure-meta">{meta}</span> : null}
        </span>
        <span className="disclosure-summary-side">
          {badge}
          <span className="pill disclosure-toggle-pill" aria-hidden="true">
            <span className="disclosure-closed-label">Open</span>
            <span className="disclosure-open-label">Hide</span>
          </span>
        </span>
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}

type Props = {
  initialProjects: ProjectBundle[];
  isConfigured: boolean;
  todaySnapshot: string;
  viewer: AppUserProfile | null;
};

type DashboardPanelKey = ModuleKey | "access_control";

export function DashboardShell({ initialProjects, isConfigured, todaySnapshot, viewer }: Props) {
  const [projects, setProjects] = useState<ProjectBundle[]>(initialProjects);
  const [activeProjectId, setActiveProjectId] = useState<string>(initialProjects[0]?.overview.id ?? "");
  const [activePanelKey, setActivePanelKey] = useState<DashboardPanelKey>("overview");
  const [financialReviewNotes, setFinancialReviewNotes] = useState<Record<string, string>>({});
  const [contractorSubmissionReviewNotes, setContractorSubmissionReviewNotes] = useState<Record<string, string>>({});
  const [consultantSubmissionReviewNotes, setConsultantSubmissionReviewNotes] = useState<Record<string, string>>({});
  const [contractorSubmissionDraftItems, setContractorSubmissionDraftItems] = useState<ContractorSubmissionDraftItem[]>([
    createEmptyContractorSubmissionDraftItem()
  ]);
  const [consultantSubmissionDraftItems, setConsultantSubmissionDraftItems] = useState<ConsultantSubmissionDraftItem[]>([
    createEmptyConsultantSubmissionDraftItem()
  ]);
  const [completionDraftItems, setCompletionDraftItems] = useState<CompletionDraftItem[]>([createEmptyCompletionDraftItem()]);
  const [defectDraftItems, setDefectDraftItems] = useState<DefectDraftItem[]>([createEmptyDefectDraftItem()]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const activeProject = useMemo(
    () => projects.find((project) => project.overview.id === activeProjectId) ?? projects[0] ?? emptyProject(),
    [activeProjectId, projects]
  );
  const isSuspended = viewer?.isSuspended ?? false;
  const moduleAccess = activeProject.access.modules;
  const currentProjectRole = activeProject.access.assignedRole;
  const canSeeAllVisibleFinancials = canSeeAllFinancialRecords(viewer?.role === "master_admin" ? "master_admin" : currentProjectRole);
  const canReviewVisibleFinancials = canReviewFinancialRecords(viewer?.role === "master_admin" ? "master_admin" : currentProjectRole);
  const canCreateFinancialRecords =
    Boolean(moduleAccess.financials && activeProject.overview.id) && (viewer?.role === "master_admin" || currentProjectRole !== "client");
  const canCreateContractorSubmissions =
    Boolean(moduleAccess.contractor_submissions && activeProject.overview.id) &&
    (viewer?.role === "master_admin" || (currentProjectRole !== "client" && currentProjectRole !== "consultant"));
  const canCreateConsultantSubmissions = Boolean(moduleAccess.contractor_submissions && activeProject.overview.id) && (
    viewer?.role === "master_admin" ||
    currentProjectRole === "master_admin" ||
    currentProjectRole === "consultant"
  );
  const canReviewContractorSubmissionsAsClient = Boolean(
    moduleAccess.contractor_submissions && activeProject.overview.id && currentProjectRole === "client"
  );
  const canReviewContractorSubmissionsAsConsultant = Boolean(
    moduleAccess.contractor_submissions && activeProject.overview.id && currentProjectRole === "consultant"
  );
  const canReviewConsultantSubmissions = Boolean(
    moduleAccess.contractor_submissions &&
      activeProject.overview.id &&
      (viewer?.role === "master_admin" || currentProjectRole === "master_admin" || currentProjectRole === "client")
  );
  const canManageOverviewTeams = viewer?.role === "master_admin" || currentProjectRole === "master_admin" || currentProjectRole === "client";
  const canDeleteSelectedProject = Boolean(
    activeProject.overview.id &&
      (viewer?.role === "master_admin" || currentProjectRole === "master_admin" || activeProject.access.isOwner)
  );

  const approvedTotal = activeProject.financialRecords
    .filter((record) => record.status === "approved" || record.status === "paid")
    .reduce((sum, record) => sum + record.amount, 0);
  const leadContractorDisplayName =
    activeProject.overview.contractorName ||
    activeProject.projectContractors.find((item) => item.contractorType === "main_contractor")?.companyName ||
    activeProject.projectContractors[0]?.companyName ||
    "Not set";
  const overallTotal = activeProject.financialRecords.reduce((sum, record) => sum + record.amount, 0);
  const awaitingReviewTotal = activeProject.financialRecords
    .filter((record) => record.status === "submitted")
    .reduce((sum, record) => sum + record.amount, 0);
  const defectZoneNames = Array.from(
    new Set(
      [...activeProject.defectZones.map((zone) => zone.name), ...activeProject.defects.map((defect) => defect.zone).filter(Boolean)].sort((a, b) =>
        a.localeCompare(b)
      )
    )
  );
  const visibleModuleEntries = [
    { key: "overview", label: "Overview", href: "#overview" },
    { key: "contractor_submissions", label: "Documents Submission", href: "#contractor-submissions" },
    { key: "handover", label: "Pre-Handover Survey", href: "#handover" },
    { key: "daily_reports", label: "Daily Reports", href: "#daily" },
    { key: "weekly_reports", label: "Weekly Reports", href: "#weekly" },
    { key: "financials", label: "Financials", href: "#financials" },
    { key: "completion", label: "Completion", href: "#completion" },
    { key: "defects", label: "Defects", href: "#defects" }
  ] satisfies Array<{ key: ModuleKey; label: string; href: string }>;

  const enabledModuleEntries = visibleModuleEntries.filter((entry) => moduleAccess[entry.key]);
  const panelEntries = (
    viewer?.role === "master_admin" && activeProject.overview.id
      ? [...enabledModuleEntries, { key: "access_control", label: "Access Control", href: "#access-control" }]
      : enabledModuleEntries
  ) satisfies Array<{ key: DashboardPanelKey; label: string; href: string }>;
  const activePanel = panelEntries.find((entry) => entry.key === activePanelKey) ?? panelEntries[0] ?? null;

  useEffect(() => {
    if (activePanelKey !== activePanel?.key) {
      setActivePanelKey(activePanel?.key ?? "overview");
    }
  }, [activePanel?.key, activePanelKey]);

  useEffect(() => {
    if (!isConfigured || !viewer || isSuspended || !projects.length) {
      return;
    }

    const projectIds = new Set(projects.map((project) => project.overview.id).filter(Boolean));
    const supabase = createClient();
    const channel = supabase
      .channel("project-notifications")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "project_notifications" },
        (payload) => {
          const notification = buildNotificationFromRow(payload.new);
          if (!notification || !projectIds.has(notification.projectId)) return;

          replaceProject(notification.projectId, (project) => ({
            ...project,
            notifications: mergeNotifications(project.notifications, [notification])
          }));

          if (notification.actorUserId !== viewer.id) {
            setFeedback(`${notification.section}: ${notification.title}`);
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isConfigured, isSuspended, projects, viewer]);

  function handlePanelSelect(key: DashboardPanelKey, href: string) {
    setActivePanelKey(key);

    if (typeof window === "undefined") {
      return;
    }

    window.history.replaceState(null, "", href);
    window.requestAnimationFrame(() => {
      document.querySelector(href)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function requireConfiguredAndUser() {
    if (!isConfigured) {
      throw new Error("Configure Supabase in .env.local to enable live project operations.");
    }

    if (isSuspended) {
      throw new Error("Your account is suspended. Contact the person managing your access to restore it.");
    }

    const supabase = createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      throw new Error("Sign in first before changing project data.");
    }

    return user;
  }

  function getConfiguredClient() {
    if (!isConfigured) {
      throw new Error("Configure Supabase in .env.local to enable live project operations.");
    }

    return createClient();
  }

  function resetMessages() {
    setError(null);
    setFeedback(null);
  }

  function buildNotificationFromRow(row: Record<string, unknown>): ProjectNotification | null {
    if (!row.id || !row.project_id) return null;

    return {
      id: String(row.id),
      projectId: String(row.project_id),
      actorUserId: typeof row.actor_user_id === "string" ? row.actor_user_id : null,
      actorEmail: String(row.actor_email ?? ""),
      action: String(row.action ?? "updated"),
      section: String(row.section ?? "Project"),
      title: String(row.title ?? "Project updated"),
      details: String(row.details ?? ""),
      createdAt: String(row.created_at ?? new Date().toISOString())
    };
  }

  function mergeNotifications(current: ProjectNotification[], incoming: ProjectNotification[]) {
    const merged = [...incoming, ...current];
    const seen = new Set<string>();

    return merged
      .filter((notification) => {
        if (seen.has(notification.id)) return false;
        seen.add(notification.id);
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 40);
  }

  async function logProjectNotification(input: {
    projectId: string;
    action: string;
    section: string;
    title: string;
    details?: string;
  }) {
    if (!isConfigured || !viewer || !input.projectId) return;

    try {
      const supabase = getConfiguredClient();
      const { data, error: notificationError } = await supabase
        .from("project_notifications")
        .insert({
          project_id: input.projectId,
          actor_user_id: viewer.id,
          actor_email: viewer.email,
          action: input.action,
          section: input.section,
          title: input.title,
          details: input.details ?? ""
        })
        .select("id, project_id, actor_user_id, actor_email, action, section, title, details, created_at")
        .single();

      if (notificationError) {
        console.error("Unable to save project notification.", notificationError);
        return;
      }

      const notification = buildNotificationFromRow(data);
      if (!notification) return;

      replaceProject(input.projectId, (project) => ({
        ...project,
        notifications: mergeNotifications(project.notifications, [notification])
      }));
    } catch (caughtError) {
      console.error("Unable to save project notification.", caughtError);
    }
  }

  function resetContractorSubmissionDraftItems() {
    setContractorSubmissionDraftItems([createEmptyContractorSubmissionDraftItem(createDraftId("contractor-draft"))]);
  }

  function resetConsultantSubmissionDraftItems() {
    setConsultantSubmissionDraftItems([createEmptyConsultantSubmissionDraftItem(createDraftId("consultant-draft"))]);
  }

  function updateContractorSubmissionDraftItem(
    itemId: string,
    field: keyof Omit<ContractorSubmissionDraftItem, "id">,
    value: string
  ) {
    setContractorSubmissionDraftItems((current) =>
      current.map((item) => (item.id === itemId ? { ...item, [field]: value } : item))
    );
  }

  function addContractorSubmissionDraftItem() {
    setContractorSubmissionDraftItems((current) => [
      ...current,
      createEmptyContractorSubmissionDraftItem(createDraftId("contractor-draft"))
    ]);
  }

  function removeContractorSubmissionDraftItem(itemId: string) {
    setContractorSubmissionDraftItems((current) => {
      const next = current.filter((item) => item.id !== itemId);
      return next.length ? next : [createEmptyContractorSubmissionDraftItem(createDraftId("contractor-draft"))];
    });
  }

  function updateConsultantSubmissionDraftItem(
    itemId: string,
    field: keyof Omit<ConsultantSubmissionDraftItem, "id">,
    value: string
  ) {
    setConsultantSubmissionDraftItems((current) =>
      current.map((item) => (item.id === itemId ? { ...item, [field]: value } : item))
    );
  }

  function addConsultantSubmissionDraftItem() {
    setConsultantSubmissionDraftItems((current) => [
      ...current,
      createEmptyConsultantSubmissionDraftItem(createDraftId("consultant-draft"))
    ]);
  }

  function removeConsultantSubmissionDraftItem(itemId: string) {
    setConsultantSubmissionDraftItems((current) => {
      const next = current.filter((item) => item.id !== itemId);
      return next.length ? next : [createEmptyConsultantSubmissionDraftItem(createDraftId("consultant-draft"))];
    });
  }

  function resetCompletionDraftItems() {
    setCompletionDraftItems([createEmptyCompletionDraftItem(createDraftId("completion-draft"))]);
  }

  function updateCompletionDraftItem(itemId: string, field: keyof Omit<CompletionDraftItem, "id">, value: string) {
    setCompletionDraftItems((current) =>
      current.map((item) => (item.id === itemId ? { ...item, [field]: value } : item))
    );
  }

  function addCompletionDraftItem() {
    setCompletionDraftItems((current) => [...current, createEmptyCompletionDraftItem(createDraftId("completion-draft"))]);
  }

  function removeCompletionDraftItem(itemId: string) {
    setCompletionDraftItems((current) => {
      const next = current.filter((item) => item.id !== itemId);
      return next.length ? next : [createEmptyCompletionDraftItem(createDraftId("completion-draft"))];
    });
  }

  function resetDefectDraftItems() {
    setDefectDraftItems([createEmptyDefectDraftItem(createDraftId("defect-draft"))]);
  }

  function updateDefectDraftItem(itemId: string, field: keyof Omit<DefectDraftItem, "id" | "attachments">, value: string) {
    setDefectDraftItems((current) =>
      current.map((item) => (item.id === itemId ? { ...item, [field]: value } : item))
    );
  }

  function updateDefectDraftAttachments(itemId: string, files: File[]) {
    setDefectDraftItems((current) =>
      current.map((item) => (item.id === itemId ? { ...item, attachments: files } : item))
    );
  }

  function addDefectDraftItem() {
    setDefectDraftItems((current) => [...current, createEmptyDefectDraftItem(createDraftId("defect-draft"))]);
  }

  function removeDefectDraftItem(itemId: string) {
    setDefectDraftItems((current) => {
      const next = current.filter((item) => item.id !== itemId);
      return next.length ? next : [createEmptyDefectDraftItem(createDraftId("defect-draft"))];
    });
  }

  function normalizeZoneName(value: string) {
    return value.trim();
  }

  function readSelectedContractorTrades(formData: FormData): ContractorTrade[] {
    const allowed = new Set(CONTRACTOR_TRADE_OPTIONS.map((option) => option.value));
    return Array.from(
      new Set(
        formData
          .getAll("trades")
          .map((value) => String(value).trim())
          .filter((value): value is ContractorTrade => allowed.has(value as ContractorTrade))
      )
    );
  }

  function readSelectedConsultantTrades(formData: FormData): ConsultantTrade[] {
    const allowed = new Set(CONSULTANT_TRADE_OPTIONS.map((option) => option.value));
    return Array.from(
      new Set(
        formData
          .getAll("trades")
          .map((value) => String(value).trim())
          .filter((value): value is ConsultantTrade => allowed.has(value as ConsultantTrade))
      )
    );
  }

  function normalizeContractorSubmissionItemsPayload() {
    const items = contractorSubmissionDraftItems
      .map((item) => ({
        id: item.id,
        submissionType: item.submissionType,
        description: item.description.trim(),
        quantity: item.quantity.trim() ? Number(item.quantity) : null,
        unit: item.unit.trim()
      }))
      .filter((item) => item.description || item.quantity !== null || item.unit);

    if (!items.length) {
      throw new Error("Add at least one contractor submission item before saving.");
    }

    if (items.some((item) => !item.description)) {
      throw new Error("Each contractor submission item needs a description.");
    }

    return items;
  }

  function normalizeConsultantSubmissionItemsPayload() {
    const items = consultantSubmissionDraftItems
      .map((item) => ({
        id: item.id,
        documentType: item.documentType.trim(),
        description: item.description.trim()
      }))
      .filter((item) => item.documentType || item.description);

    if (!items.length) {
      throw new Error("Add at least one consultant document item before saving.");
    }

    if (items.some((item) => !item.documentType || !item.description)) {
      throw new Error("Each consultant document item needs both a document type and description.");
    }

    return items;
  }

  function normalizeExistingContractorSubmissionItemsPayload(
    formData: FormData,
    submission: ProjectBundle["contractorSubmissions"][number]
  ) {
    const items = getSafeContractorSubmissionItems(submission).map((item) => ({
      id: item.id,
      submissionType: normalizeContractorSubmissionType(formData.get(`submissionType:${item.id}`)),
      description: String(formData.get(`description:${item.id}`) ?? "").trim(),
      quantity: String(formData.get(`quantity:${item.id}`) ?? "").trim()
        ? Number(formData.get(`quantity:${item.id}`))
        : null,
      unit: String(formData.get(`unit:${item.id}`) ?? "").trim()
    }));

    if (!items.length) {
      throw new Error("This contractor submission needs at least one item.");
    }

    if (items.some((item) => !item.description)) {
      throw new Error("Each contractor submission item needs a description.");
    }

    return items;
  }

  function normalizeExistingConsultantSubmissionItemsPayload(
    formData: FormData,
    submission: ProjectBundle["consultantSubmissions"][number]
  ) {
    const items = getSafeConsultantSubmissionItems(submission).map((item) => ({
      id: item.id,
      documentType: String(formData.get(`documentType:${item.id}`) ?? "").trim(),
      description: String(formData.get(`description:${item.id}`) ?? "").trim()
    }));

    if (!items.length) {
      throw new Error("This consultant submission needs at least one item.");
    }

    if (items.some((item) => !item.documentType || !item.description)) {
      throw new Error("Each consultant document item needs both a document type and description.");
    }

    return items;
  }

  function normalizeCompletionDraftItemsPayload() {
    const items = completionDraftItems
      .map((item) => ({
        id: item.id,
        item: item.item.trim(),
        status: item.status,
        details: item.details.trim()
      }))
      .filter((item) => item.item || item.details);

    if (!items.length) {
      throw new Error("Add at least one completion checklist item before saving.");
    }

    if (items.some((item) => !item.item)) {
      throw new Error("Each completion checklist draft needs an item title.");
    }

    return items;
  }

  function normalizeDefectDraftItemsPayload() {
    const items = defectDraftItems
      .map((item) => ({
        id: item.id,
        zone: normalizeZoneName(item.zone),
        title: item.title.trim(),
        status: item.status,
        details: item.details.trim(),
        attachments: item.attachments
      }))
      .filter((item) => item.zone || item.title || item.details || item.attachments.length);

    if (!items.length) {
      throw new Error("Add at least one defect before saving.");
    }

    if (items.some((item) => !item.zone || !item.title)) {
      throw new Error("Each defect draft needs both a zone and a defect title.");
    }

    return items;
  }

  function getContractorSubmissionHeading(submission: ProjectBundle["contractorSubmissions"][number]) {
    const items = getSafeContractorSubmissionItems(submission);
    if (items.length === 1) {
      return formatSectionLabel(items[0]?.submissionType ?? "material_submission");
    }

    return `${items.length || 0} document items`;
  }

  function getConsultantSubmissionHeading(submission: ProjectBundle["consultantSubmissions"][number]) {
    const items = getSafeConsultantSubmissionItems(submission);
    if (items.length === 1) {
      return items[0]?.documentType || "Consultant document";
    }

    return `${items.length || 0} consultant items`;
  }

  function normalizeDefectStatus(value: string): DefectStatus {
    const normalized = value.trim().toLowerCase().replaceAll(" ", "_");

    if (normalized === "in_progress" || normalized === "closed") {
      return normalized;
    }

    return "open";
  }

  function readImportedCell(row: Record<string, unknown>, candidates: string[]) {
    const normalizedEntries = Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), value] as const);

    for (const candidate of candidates) {
      const match = normalizedEntries.find(([key]) => key === candidate);
      if (!match) continue;

      if (typeof match[1] === "string") {
        return match[1].trim();
      }

      if (typeof match[1] === "number") {
        return String(match[1]);
      }
    }

    return "";
  }

  function normalizeExcelImageExtension(extension: string) {
    const normalized = extension.trim().toLowerCase();

    if (normalized === "jpg") {
      return "jpeg";
    }

    if (normalized === "gif") {
      return "gif";
    }

    return "png";
  }

  function getExcelImageMimeType(extension: string) {
    return `image/${normalizeExcelImageExtension(extension)}`;
  }

  function toUint8Array(buffer: unknown) {
    if (buffer instanceof ArrayBuffer) {
      return new Uint8Array(buffer);
    }

    if (ArrayBuffer.isView(buffer)) {
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }

    if (buffer && typeof buffer === "object" && "data" in buffer) {
      const data = (buffer as { data?: unknown }).data;
      if (Array.isArray(data)) {
        return Uint8Array.from(data.filter((value): value is number => typeof value === "number"));
      }
    }

    return null;
  }

  function extractExcelImageFiles(
    worksheet: { getImages?: () => Array<{ imageId: string | number; range: { tl: { row: number } } }> },
    workbook: { model?: { media?: Array<{ type?: string; name?: string; extension?: string; buffer?: unknown }> } }
  ) {
    const imageFilesByRow = new Map<number, File[]>();
    const worksheetImages = typeof worksheet.getImages === "function" ? worksheet.getImages() : [];
    const workbookMedia = Array.isArray(workbook.model?.media) ? workbook.model.media : [];

    worksheetImages.forEach((image) => {
      const rowNumber = Math.floor(image.range?.tl?.row ?? -1) + 1;
      if (rowNumber <= 1) return;

      const mediaIndex = Number(image.imageId);
      const media = Number.isFinite(mediaIndex) ? workbookMedia[mediaIndex] : undefined;
      if (!media || media.type !== "image" || !media.extension) return;

      const bytes = toUint8Array(media.buffer);
      if (!bytes?.byteLength) return;

      const extension = normalizeExcelImageExtension(media.extension);
      const nextFiles = imageFilesByRow.get(rowNumber) ?? [];
      const fileBytes = Uint8Array.from(bytes);
      nextFiles.push(
        new File([fileBytes], `${media.name || `excel-photo-row-${rowNumber}-${nextFiles.length + 1}`}.${extension}`, {
          type: getExcelImageMimeType(extension)
        })
      );
      imageFilesByRow.set(rowNumber, nextFiles);
    });

    return imageFilesByRow;
  }

  function replaceProject(projectId: string, updater: (project: ProjectBundle) => ProjectBundle) {
    setProjects((current) => current.map((project) => (project.overview.id === projectId ? updater(project) : project)));
  }

  function setFinancialReviewNote(recordId: string, value: string) {
    setFinancialReviewNotes((current) => ({
      ...current,
      [recordId]: value
    }));
  }

  function getContractorSubmissionReviewKey(submissionId: string, reviewerRole: "client" | "consultant") {
    return `${submissionId}:${reviewerRole}`;
  }

  function setContractorSubmissionReviewNote(submissionId: string, reviewerRole: "client" | "consultant", value: string) {
    const key = getContractorSubmissionReviewKey(submissionId, reviewerRole);
    setContractorSubmissionReviewNotes((current) => ({
      ...current,
      [key]: value
    }));
  }

  async function ensureDefectZone(projectId: string, zoneName: string) {
    const normalizedName = normalizeZoneName(zoneName);
    if (!normalizedName) return null;

    const existingZone = activeProject.defectZones.find((zone) => zone.name.toLowerCase() === normalizedName.toLowerCase());
    if (existingZone) {
      return existingZone;
    }

    const supabase = getConfiguredClient();
    const { data, error: insertError } = await supabase
      .from("defect_zones")
      .insert({
        project_id: projectId,
        name: normalizedName
      })
      .select("id, name")
      .single();

    if (insertError) {
      throw insertError;
    }

    const nextZone = {
      id: data.id,
      name: data.name
    };

    replaceProject(projectId, (project) => ({
      ...project,
      defectZones: [...project.defectZones, nextZone].sort((a, b) => a.name.localeCompare(b.name))
    }));

    return nextZone;
  }

  async function syncDefectZones(projectId: string, zoneNames: string[]) {
    const uniqueZoneNames = Array.from(new Set(zoneNames.map(normalizeZoneName).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    if (!uniqueZoneNames.length) {
      return [];
    }

    const existingZonesByName = new Map(activeProject.defectZones.map((zone) => [zone.name.toLowerCase(), zone] as const));
    const missingZoneNames = uniqueZoneNames.filter((name) => !existingZonesByName.has(name.toLowerCase()));

    if (missingZoneNames.length) {
      const supabase = getConfiguredClient();
      const { data, error: upsertError } = await supabase
        .from("defect_zones")
        .upsert(
          missingZoneNames.map((name) => ({
            project_id: projectId,
            name
          })),
          { onConflict: "project_id,name" }
        )
        .select("id, name");

      if (upsertError) {
        throw upsertError;
      }

      if (data?.length) {
        replaceProject(projectId, (project) => {
          const merged = new Map(project.defectZones.map((zone) => [zone.name.toLowerCase(), zone] as const));
          data.forEach((zone) => {
            merged.set(zone.name.toLowerCase(), { id: zone.id, name: zone.name });
          });

          return {
            ...project,
            defectZones: Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name))
          };
        });
      }
    }

    return uniqueZoneNames;
  }

  function mergeDefects(current: DefectRecord[], incoming: DefectRecord[]) {
    const merged = [...incoming];
    const seen = new Set(incoming.map((defect) => defect.id));

    current.forEach((defect) => {
      if (!seen.has(defect.id)) {
        merged.push(defect);
      }
    });

    return merged;
  }

  async function uploadAttachments(
    projectId: string,
    sectionType: RecordSectionType,
    recordId: string,
    files: File[]
  ): Promise<AttachmentRecord[]> {
    if (!files.length) return [];
    const preparedFiles = await prepareFreePilotFiles(files, getUploadModeForSection(sectionType));
    const supabase = getConfiguredClient();

    const uploaded: AttachmentRecord[] = [];

    for (const file of preparedFiles) {
      const storagePath = `${projectId}/${sectionType}/${recordId}/${Date.now()}-${sanitizeFilename(file.name)}`;
      const { error: uploadError } = await supabase.storage.from(PROJECT_FILES_BUCKET).upload(storagePath, file, {
        cacheControl: "3600",
        upsert: false
      });

      if (uploadError) {
        throw uploadError;
      }

      const { data: attachmentRow, error: attachmentError } = await supabase
        .from("attachments")
        .insert({
          project_id: projectId,
          section_type: sectionType,
          record_id: recordId,
          name: file.name,
          mime_type: file.type || "application/octet-stream",
          storage_path: storagePath
        })
        .select("id, name, mime_type, storage_path")
        .single();

      if (attachmentError) {
        throw attachmentError;
      }

      const { data: publicUrlData } = supabase.storage.from(PROJECT_FILES_BUCKET).getPublicUrl(storagePath);

      uploaded.push({
        id: attachmentRow.id,
        name: attachmentRow.name,
        mimeType: attachmentRow.mime_type,
        path: attachmentRow.storage_path,
        publicUrl: publicUrlData.publicUrl
      });
    }

    return uploaded;
  }

  async function deleteAttachments(recordId: string, sectionType: RecordSectionType) {
    const supabase = getConfiguredClient();
    const { data: rows, error: fetchError } = await supabase
      .from("attachments")
      .select("id, storage_path")
      .eq("record_id", recordId)
      .eq("section_type", sectionType);

    if (fetchError) {
      throw fetchError;
    }

    const paths = (rows ?? []).map((row) => row.storage_path);
    if (paths.length) {
      const { error: storageError } = await supabase.storage.from(PROJECT_FILES_BUCKET).remove(paths);
      if (storageError) {
        throw storageError;
      }
    }

    const { error: deleteError } = await supabase
      .from("attachments")
      .delete()
      .eq("record_id", recordId)
      .eq("section_type", sectionType);

    if (deleteError) {
      throw deleteError;
    }
  }

  function handleProjectCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      try {
        const user = await requireConfiguredAndUser();
        const supabase = getConfiguredClient();
        const payload = {
          owner_id: user.id,
          name: String(formData.get("name") ?? "").trim(),
          location: String(formData.get("location") ?? "").trim(),
          client_name: String(formData.get("clientName") ?? "").trim(),
          contractor_name: String(formData.get("contractorName") ?? "").trim(),
          details: String(formData.get("details") ?? "").trim(),
          handover_date: String(formData.get("handoverDate") ?? "") || null,
          completion_date: String(formData.get("completionDate") ?? "") || null
        };

        const { data, error: insertError } = await supabase
          .from("projects")
          .insert(payload)
          .select("id, name, location, client_name, contractor_name, details, handover_date, completion_date")
          .single();

        if (insertError) throw insertError;

        const nextProject: ProjectBundle = {
          overview: {
            id: data.id,
            name: data.name,
            location: data.location ?? "",
            clientName: data.client_name ?? "",
            contractorName: data.contractor_name ?? "",
            details: data.details ?? "",
            handoverDate: data.handover_date,
            completionDate: data.completion_date
          },
          access: {
            isOwner: true,
            canManageAccess: viewer?.role === "master_admin",
            assignedRole: viewer?.role ?? "consultant",
            modules: createFullModulePermissions()
          },
          members: [],
          projectContractors: [],
          projectConsultants: [],
          milestones: [],
          contractorSubmissions: [],
          consultantSubmissions: [],
          surveyItems: [],
          dailyReports: [],
          weeklyReports: [],
          financialRecords: [],
          completionChecklist: [],
          defectZones: [],
          defects: [],
          notifications: []
        };

        setProjects((current) => [nextProject, ...current]);
        setActiveProjectId(nextProject.overview.id);
        await logProjectNotification({
          projectId: nextProject.overview.id,
          action: "created",
          section: "Project",
          title: `Project created: ${nextProject.overview.name}`,
          details: nextProject.overview.location
        });
        setFeedback("Project created.");
        form.reset();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to create project.");
      }
    });
  }

  function handleOverviewUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      try {
        await requireConfiguredAndUser();
        const supabase = getConfiguredClient();
        const payload = {
          name: String(formData.get("name") ?? "").trim(),
          location: String(formData.get("location") ?? "").trim(),
          client_name: String(formData.get("clientName") ?? "").trim(),
          contractor_name: String(formData.get("contractorName") ?? "").trim(),
          details: String(formData.get("details") ?? "").trim(),
          handover_date: String(formData.get("handoverDate") ?? "") || null,
          completion_date: String(formData.get("completionDate") ?? "") || null
        };

        const { error: updateError } = await supabase.from("projects").update(payload).eq("id", activeProject.overview.id);
        if (updateError) throw updateError;

        replaceProject(activeProject.overview.id, (project) => ({
          ...project,
          overview: {
            ...project.overview,
            name: payload.name,
            location: payload.location,
            clientName: payload.client_name,
            contractorName: payload.contractor_name,
            details: payload.details,
            handoverDate: payload.handover_date,
            completionDate: payload.completion_date
          }
        }));
        await logProjectNotification({
          projectId: activeProject.overview.id,
          action: "updated",
          section: "Overview",
          title: "Project overview updated",
          details: payload.name
        });
        setFeedback("Project overview updated.");
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to update project.");
      }
    });
  }

  function handleProjectDelete(projectId: string, projectName: string) {
    resetMessages();

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Delete "${projectName}"? This will remove the project together with its reports, attachments, and linked records.`
      );

      if (!confirmed) {
        return;
      }
    }

    startTransition(async () => {
      try {
        if (isConfigured) {
          await requireConfiguredAndUser();
          const supabase = getConfiguredClient();
          const { error: deleteError } = await supabase.from("projects").delete().eq("id", projectId);
          if (deleteError) throw deleteError;
        }

        const remainingProjects = projects.filter((project) => project.overview.id !== projectId);
        setProjects(remainingProjects);
        setActiveProjectId((current) => (current === projectId ? remainingProjects[0]?.overview.id ?? "" : current));
        setFeedback(isConfigured ? `Deleted ${projectName}.` : `Removed ${projectName} from this demo session.`);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to delete the project.");
      }
    });
  }

  function handleMilestoneCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      try {
        await requireConfiguredAndUser();
        const supabase = getConfiguredClient();
        const payload = {
          project_id: activeProject.overview.id,
          title: String(formData.get("title") ?? "").trim(),
          due_date: String(formData.get("dueDate") ?? "")
        };

        const { data, error: insertError } = await supabase
          .from("milestones")
          .insert(payload)
          .select("id, title, due_date")
          .single();

        if (insertError) throw insertError;

        replaceProject(activeProject.overview.id, (project) => ({
          ...project,
          milestones: [...project.milestones, { id: data.id, title: data.title, dueDate: data.due_date }].sort((a, b) =>
            a.dueDate.localeCompare(b.dueDate)
          )
        }));
        await logProjectNotification({
          projectId: activeProject.overview.id,
          action: "created",
          section: "Milestones",
          title: `Milestone added: ${data.title}`,
          details: formatDate(data.due_date)
        });
        setFeedback("Milestone added.");
        form.reset();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to add milestone.");
      }
    });
  }

  function handleRecordCreate<TableRow extends Record<string, unknown>>(
    event: React.FormEvent<HTMLFormElement>,
    options: {
      table: string;
      section?: RecordSectionType;
      label?: string;
      buildPayload: (formData: FormData) => Promise<TableRow> | TableRow;
      select: string;
      append: (project: ProjectBundle, data: Record<string, unknown>, attachments: AttachmentRecord[]) => ProjectBundle;
      afterSuccess?: () => void;
    }
  ) {
    event.preventDefault();
    resetMessages();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const rawFiles = formData
      .getAll("attachments")
      .filter((value): value is File => value instanceof File && value.size > 0);

    startTransition(async () => {
      try {
        const files = options.section ? await prepareFreePilotFiles(rawFiles, getUploadModeForSection(options.section)) : [];
        await requireConfiguredAndUser();
        const supabase = getConfiguredClient();
        const payload = {
          project_id: activeProject.overview.id,
          ...(await options.buildPayload(formData))
        };

        const { data, error: insertError } = await supabase.from(options.table).insert(payload).select(options.select).single();
        if (insertError) throw insertError;
        const row = data as unknown as Record<string, unknown> | null;
        if (!row) {
          throw new Error("The record was created but no response row was returned.");
        }

        const attachments =
          options.section && files.length ? await uploadAttachments(activeProject.overview.id, options.section, String(row.id), files) : [];
        replaceProject(activeProject.overview.id, (project) => options.append(project, row, attachments));
        await logProjectNotification({
          projectId: activeProject.overview.id,
          action: "created",
          section: options.section ? formatSectionLabel(options.section) : options.table,
          title: options.label ?? (options.section ? `${formatSectionLabel(options.section)} created.` : "Record created."),
          details: attachments.length ? `${attachments.length} attachment${attachments.length === 1 ? "" : "s"} added.` : ""
        });
        setFeedback(options.label ?? (options.section ? `${formatSectionLabel(options.section)} created.` : "Record created."));
        options.afterSuccess?.();
        form.reset();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to create record.");
      }
    });
  }

  function handleRecordUpdate(
    event: React.FormEvent<HTMLFormElement>,
    options: {
      table: string;
      recordId: string;
      section?: RecordSectionType;
      label?: string;
      buildPayload: (formData: FormData) => Promise<Record<string, unknown>> | Record<string, unknown>;
      select: string;
      update: (project: ProjectBundle, data: Record<string, unknown>, attachments: AttachmentRecord[]) => ProjectBundle;
    }
  ) {
    event.preventDefault();
    resetMessages();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const rawFiles = formData
      .getAll("attachments")
      .filter((value): value is File => value instanceof File && value.size > 0);

    startTransition(async () => {
      try {
        const files = options.section ? await prepareFreePilotFiles(rawFiles, getUploadModeForSection(options.section)) : [];
        await requireConfiguredAndUser();
        const supabase = getConfiguredClient();
        const payload = await options.buildPayload(formData);

        const { data, error: updateError } = await supabase
          .from(options.table)
          .update(payload)
          .eq("id", options.recordId)
          .select(options.select)
          .single();

        if (updateError) throw updateError;
        const row = data as unknown as Record<string, unknown> | null;
        if (!row) {
          throw new Error("The record was updated but no response row was returned.");
        }

        const attachments =
          options.section && files.length ? await uploadAttachments(activeProject.overview.id, options.section, options.recordId, files) : [];
        replaceProject(activeProject.overview.id, (project) => options.update(project, row, attachments));

        form.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach((input) => {
          input.value = "";
        });

        await logProjectNotification({
          projectId: activeProject.overview.id,
          action: "updated",
          section: options.section ? formatSectionLabel(options.section) : options.table,
          title: options.label ?? (options.section ? `${formatSectionLabel(options.section)} updated.` : "Record updated."),
          details: attachments.length ? `${attachments.length} attachment${attachments.length === 1 ? "" : "s"} added.` : ""
        });
        setFeedback(options.label ?? (options.section ? `${formatSectionLabel(options.section)} updated.` : "Record updated."));
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to update record.");
      }
    });
  }

  function handleDelete(options: {
    table: string;
    recordId: string;
    section?: RecordSectionType;
    remove: (project: ProjectBundle) => ProjectBundle;
  }) {
    resetMessages();
    startTransition(async () => {
      try {
        await requireConfiguredAndUser();
        const supabase = getConfiguredClient();
        if (options.section) {
          await deleteAttachments(options.recordId, options.section);
        }
        const { error: deleteError } = await supabase.from(options.table).delete().eq("id", options.recordId);
        if (deleteError) throw deleteError;

        replaceProject(activeProject.overview.id, options.remove);
        await logProjectNotification({
          projectId: activeProject.overview.id,
          action: "deleted",
          section: options.section ? formatSectionLabel(options.section) : options.table,
          title: "Record deleted"
        });
        setFeedback("Record deleted.");
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to delete record.");
      }
    });
  }

  function handleFinancialStatusUpdate(record: ProjectBundle["financialRecords"][number], nextStatus: FinancialStatus) {
    resetMessages();

    startTransition(async () => {
      try {
        await requireConfiguredAndUser();

        const reviewNote = (financialReviewNotes[record.id] ?? "").trim();
        if (nextStatus === "rejected" && !reviewNote) {
          throw new Error("Add a rejection reason before rejecting this submission.");
        }

        const supabase = getConfiguredClient();
        const payload: Record<string, string | null> = {
          status: nextStatus,
          review_note:
            nextStatus === "submitted"
              ? null
              : reviewNote || record.reviewNote || null
        };

        const { data, error: updateError } = await supabase
          .from("financial_records")
          .update(payload)
          .eq("id", record.id)
          .select(
            "id, document_type, reference_number, amount, status, notes, owner_user_id, owner_email, owner_role, submitted_at, reviewed_at, reviewed_by_user_id, reviewed_by_email, review_note"
          )
          .single();

        if (updateError) {
          throw updateError;
        }

        replaceProject(activeProject.overview.id, (project) => ({
          ...project,
          financialRecords: project.financialRecords.map((item) =>
            item.id === record.id ? buildFinancialRecordFromRow(data, item.attachments) : item
          )
        }));
        setFinancialReviewNotes((current) => {
          const next = { ...current };
          delete next[record.id];
          return next;
        });

        const statusMessages: Record<FinancialStatus, string> = {
          pending: "Financial draft saved.",
          submitted: "Financial submission sent for client review.",
          approved: "Financial submission approved.",
          rejected: "Financial submission rejected with client comments.",
          paid: "Financial submission marked as paid."
        };

        await logProjectNotification({
          projectId: activeProject.overview.id,
          action: "updated",
          section: "Financials",
          title: statusMessages[nextStatus],
          details: record.referenceNumber || formatCurrency(record.amount)
        });
        setFeedback(statusMessages[nextStatus]);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to update the financial status.");
      }
    });
  }

  function handleContractorSubmissionStatusUpdate(
    submission: ProjectBundle["contractorSubmissions"][number],
    nextStatus: ApprovalStatus
  ) {
    resetMessages();

    startTransition(async () => {
      try {
        await requireConfiguredAndUser();

        const reviewerRole =
          currentProjectRole === "client" ? "client" : currentProjectRole === "consultant" ? "consultant" : null;

        if (!reviewerRole) {
          throw new Error("Only the client or consultant can change contractor submission approvals.");
        }

        const noteKey = getContractorSubmissionReviewKey(submission.id, reviewerRole);
        const reviewNote = (contractorSubmissionReviewNotes[noteKey] ?? "").trim();
        if (nextStatus === "rejected" && !reviewNote) {
          throw new Error("Add a review comment before rejecting this contractor submission.");
        }

        const payload =
          reviewerRole === "client"
            ? { client_status: nextStatus, client_review_note: nextStatus === "pending" ? "" : reviewNote || submission.clientReviewNote || "" }
            : {
                consultant_status: nextStatus,
                consultant_review_note: nextStatus === "pending" ? "" : reviewNote || submission.consultantReviewNote || ""
              };

        const supabase = getConfiguredClient();
        const { data, error: updateError } = await supabase
          .from("contractor_submissions")
          .update(payload)
          .eq("id", submission.id)
          .select(CONTRACTOR_SUBMISSION_SELECT)
          .single();

        if (updateError) {
          throw updateError;
        }

        replaceProject(activeProject.overview.id, (project) => ({
          ...project,
          contractorSubmissions: project.contractorSubmissions.map((item) =>
            item.id === submission.id ? buildContractorSubmissionFromRow(data, item.attachments) : item
          )
        }));

        setContractorSubmissionReviewNotes((current) => {
          const next = { ...current };
          delete next[noteKey];
          return next;
        });

        const reviewMessage = `${getRoleLabel(reviewerRole)} review marked as ${getApprovalLabel(nextStatus).toLowerCase()}.`;
        await logProjectNotification({
          projectId: activeProject.overview.id,
          action: "updated",
          section: "Contractor Submission",
          title: reviewMessage,
          details: getContractorSubmissionHeading(submission)
        });
        setFeedback(reviewMessage);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to update the contractor submission status.");
      }
    });
  }

  function handleConsultantSubmissionStatusUpdate(
    submission: ProjectBundle["consultantSubmissions"][number],
    nextStatus: ApprovalStatus
  ) {
    resetMessages();

    startTransition(async () => {
      try {
        await requireConfiguredAndUser();

        if (!canReviewConsultantSubmissions) {
          throw new Error("Only clients or authorized reviewers can accept or return consultant documents.");
        }

        const reviewNote = (consultantSubmissionReviewNotes[submission.id] ?? "").trim();
        if (nextStatus === "rejected" && !reviewNote) {
          throw new Error("Add a review comment before returning this consultant document.");
        }

        const supabase = getConfiguredClient();
        const { data, error: updateError } = await supabase
          .from("consultant_submissions")
          .update({
            status: nextStatus,
            review_note: nextStatus === "pending" ? "" : reviewNote || submission.reviewNote || ""
          })
          .eq("id", submission.id)
          .select(CONSULTANT_SUBMISSION_SELECT)
          .single();

        if (updateError) {
          throw updateError;
        }

        replaceProject(activeProject.overview.id, (project) => ({
          ...project,
          consultantSubmissions: project.consultantSubmissions.map((item) =>
            item.id === submission.id ? buildConsultantSubmissionFromRow(data, item.attachments) : item
          )
        }));

        setConsultantSubmissionReviewNotes((current) => {
          const next = { ...current };
          delete next[submission.id];
          return next;
        });

        const statusMessage =
          nextStatus === "approved" ? "accepted" : nextStatus === "rejected" ? "returned" : "reset to pending";
        await logProjectNotification({
          projectId: activeProject.overview.id,
          action: "updated",
          section: "Consultant Documents",
          title: `Consultant document ${statusMessage}.`,
          details: getConsultantSubmissionHeading(submission)
        });
        setFeedback(`Consultant document ${statusMessage}.`);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to update the consultant document status.");
      }
    });
  }

  function handleCompletionBatchCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();

    startTransition(async () => {
      try {
        await requireConfiguredAndUser();
        const supabase = getConfiguredClient();
        const drafts = normalizeCompletionDraftItemsPayload();
        const createdItems: ProjectBundle["completionChecklist"] = [];

        for (const draft of drafts) {
          const { data, error: insertError } = await supabase
            .from("completion_checklist_items")
            .insert({
              project_id: activeProject.overview.id,
              item: draft.item,
              status: draft.status,
              details: draft.details
            })
            .select("id, item, status, details")
            .single();

          if (insertError) {
            throw insertError;
          }

          createdItems.push({
            id: String(data.id),
            item: String(data.item),
            status: data.status as CompletionStatus,
            details: String(data.details ?? "")
          });
        }

        replaceProject(activeProject.overview.id, (project) => ({
          ...project,
          completionChecklist: [...createdItems, ...project.completionChecklist]
        }));
        resetCompletionDraftItems();
        await logProjectNotification({
          projectId: activeProject.overview.id,
          action: "created",
          section: "Completion",
          title:
            createdItems.length === 1
              ? "Completion checklist item added."
              : `${createdItems.length} completion checklist items added.`,
          details: createdItems.map((item) => item.item).join(", ")
        });
        setFeedback(
          createdItems.length === 1
            ? "Completion checklist item added."
            : `${createdItems.length} completion checklist items added.`
        );
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to add completion checklist items.");
      }
    });
  }

  function handleDefectBatchCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();

    startTransition(async () => {
      try {
        await requireConfiguredAndUser();
        const supabase = getConfiguredClient();
        const drafts = await Promise.all(
          normalizeDefectDraftItemsPayload().map(async (draft) => ({
            ...draft,
            attachments: await prepareFreePilotFiles(draft.attachments, "image-only")
          }))
        );
        await syncDefectZones(
          activeProject.overview.id,
          drafts.map((draft) => draft.zone)
        );

        const createdDefects: ProjectBundle["defects"] = [];

        for (const draft of drafts) {
          const { data, error: insertError } = await supabase
            .from("defects")
            .insert({
              project_id: activeProject.overview.id,
              zone: draft.zone,
              title: draft.title,
              status: draft.status,
              details: draft.details
            })
            .select("id, zone, title, status, details")
            .single();

          if (insertError) {
            throw insertError;
          }

          const attachments = draft.attachments.length
            ? await uploadAttachments(activeProject.overview.id, "defect", String(data.id), draft.attachments)
            : [];

          createdDefects.push({
            id: String(data.id),
            zone: String(data.zone ?? ""),
            title: String(data.title),
            status: data.status as DefectStatus,
            details: String(data.details ?? ""),
            attachments
          });
        }

        replaceProject(activeProject.overview.id, (project) => ({
          ...project,
          defects: [...createdDefects, ...project.defects]
        }));
        resetDefectDraftItems();
        await logProjectNotification({
          projectId: activeProject.overview.id,
          action: "created",
          section: "Defects",
          title: createdDefects.length === 1 ? "Defect added." : `${createdDefects.length} defects added.`,
          details: createdDefects.map((defect) => defect.title).join(", ")
        });
        setFeedback(createdDefects.length === 1 ? "Defect added." : `${createdDefects.length} defects added.`);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to add defects.");
      }
    });
  }

  function handleDefectZoneCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      try {
        await requireConfiguredAndUser();
        const zoneName = normalizeZoneName(String(formData.get("zoneName") ?? ""));
        if (!zoneName) {
          throw new Error("Enter a zone name before saving.");
        }

        await ensureDefectZone(activeProject.overview.id, zoneName);
        await logProjectNotification({
          projectId: activeProject.overview.id,
          action: "created",
          section: "Defect Zones",
          title: `Defect zone saved: ${zoneName}`
        });
        setFeedback("Defect zone saved.");
        form.reset();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to save defect zone.");
      }
    });
  }

  function handleDefectTemplateDownload() {
    resetMessages();

    startTransition(async () => {
      try {
        const ExcelJS = await import("exceljs");
        const templateRows = [
          {
            zone: "Pantry",
            defectTitle: "Silicone joint gap at backsplash",
            status: "open",
            details: "Observed during internal pre-handover inspection. Requires reseal."
          },
          {
            zone: "Front-of-house",
            defectTitle: "Paint touch-up beside entrance return wall",
            status: "in_progress",
            details: "Minor scuff marks visible after fit-out protection removal."
          }
        ];

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet("Defects");
        worksheet.columns = [
          { header: "Zone", key: "zone", width: 24 },
          { header: "Defect Title", key: "defectTitle", width: 40 },
          { header: "Status", key: "status", width: 18 },
          { header: "Details", key: "details", width: 56 },
          { header: "Photo", key: "photo", width: 22 }
        ];
        templateRows.forEach((row) =>
          worksheet.addRow({
            ...row,
            photo: "Insert image anchored on this row"
          })
        );
        worksheet.getRow(2).height = 72;
        worksheet.getRow(3).height = 72;

        const instructions = workbook.addWorksheet("Instructions");
        instructions.columns = [{ header: "How to use", key: "instruction", width: 110 }];
        instructions.addRows([
          { instruction: "Keep row 1 as the header row." },
          { instruction: "Enter each defect on its own row using Zone, Defect Title, Status, and Details." },
          { instruction: "To import a photo, insert it into the Photo column on the same defect row. The app matches embedded Excel images by row." },
          { instruction: "Save the file as .xlsx or .xlsm before importing." }
        ]);

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "project-field-hub-defect-template.xlsx";
        link.click();
        URL.revokeObjectURL(url);
        setFeedback("Excel defect template downloaded.");
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to generate the defect template.");
      }
    });
  }

  function handleDefectImport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("defectImport");

    startTransition(async () => {
      try {
        if (!(file instanceof File) || file.size === 0) {
          throw new Error("Choose an Excel file before importing.");
        }

        await requireConfiguredAndUser();
        const ExcelJS = await import("exceljs");
        const buffer = await file.arrayBuffer();
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        const worksheet = workbook.worksheets[0];

        if (!worksheet) {
          throw new Error("The workbook is empty.");
        }

        const imageFilesByRow = extractExcelImageFiles(worksheet, workbook);
        const headerRow = worksheet.getRow(1);
        const headers = (Array.isArray(headerRow.values) ? headerRow.values.slice(1) : []).map((value) =>
          String(value ?? "")
            .trim()
            .toLowerCase()
        );

        const rows: Array<{ rowNumber: number; values: Record<string, unknown> }> = [];
        worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
          if (rowNumber === 1) return;

          const values: Record<string, unknown> = {};
          headers.forEach((header, index) => {
            if (!header) return;
            values[header] = row.getCell(index + 1).text?.trim() ?? "";
          });
          rows.push({ rowNumber, values });
        });

        const importedRows = rows
          .map(({ rowNumber, values }) => {
            const zone = normalizeZoneName(readImportedCell(values, ["zone", "area", "location"]));
            const title = readImportedCell(values, ["defect title", "title", "defect", "issue"]);
            const status = normalizeDefectStatus(readImportedCell(values, ["status"]));
            const details = readImportedCell(values, ["details", "description", "remarks", "comment"]);
            const imageFiles = imageFilesByRow.get(rowNumber) ?? [];

            return { rowNumber, zone, title, status, details, imageFiles };
          })
          .filter((row) => row.zone && row.title);

        const skippedRows = rows.length - importedRows.length;

        if (!importedRows.length) {
          throw new Error("No valid defect rows were found. Use columns like Zone, Defect Title, Status, and Details.");
        }

        const preparedRows = await Promise.all(
          importedRows.map(async (row) => ({
            ...row,
            imageFiles: await prepareFreePilotFiles(row.imageFiles, "image-only")
          }))
        );

        await syncDefectZones(
          activeProject.overview.id,
          preparedRows.map((row) => row.zone)
        );

        const supabase = getConfiguredClient();
        const createdDefects: DefectRecord[] = [];
        let uploadedImageCount = 0;
        let imageUploadFailureRows = 0;

        for (const row of preparedRows) {
          const { data, error: insertError } = await supabase
            .from("defects")
            .insert({
              project_id: activeProject.overview.id,
              zone: row.zone,
              title: row.title,
              status: row.status,
              details: row.details
            })
            .select("id, zone, title, status, details")
            .single();

          if (insertError) {
            throw insertError;
          }

          let attachments: AttachmentRecord[] = [];
          if (row.imageFiles.length) {
            try {
              attachments = await uploadAttachments(activeProject.overview.id, "defect", data.id, row.imageFiles);
              uploadedImageCount += attachments.length;
            } catch (attachmentError) {
              imageUploadFailureRows += 1;
              console.error(`Unable to upload Excel images for defect row ${row.rowNumber}.`, attachmentError);
            }
          }

          createdDefects.push({
            id: data.id,
            zone: data.zone ?? "",
            title: data.title,
            status: data.status as DefectStatus,
            details: data.details ?? "",
            attachments
          });
        }

        replaceProject(activeProject.overview.id, (project) => ({
          ...project,
          defects: mergeDefects(project.defects, createdDefects)
        }));

        await logProjectNotification({
          projectId: activeProject.overview.id,
          action: "created",
          section: "Defects",
          title: `Imported ${importedRows.length} defect${importedRows.length === 1 ? "" : "s"}.`,
          details: uploadedImageCount > 0 ? `${uploadedImageCount} embedded photo${uploadedImageCount === 1 ? "" : "s"} included.` : ""
        });
        setFeedback(
          `Imported ${importedRows.length} defect${importedRows.length === 1 ? "" : "s"}${
            skippedRows > 0 ? ` and skipped ${skippedRows} incomplete row${skippedRows === 1 ? "" : "s"}` : ""
          }${
            uploadedImageCount > 0 ? `, including ${uploadedImageCount} embedded photo${uploadedImageCount === 1 ? "" : "s"}` : ""
          }${
            imageUploadFailureRows > 0
              ? `. ${imageUploadFailureRows} row${imageUploadFailureRows === 1 ? "" : "s"} had photo upload issues`
              : "."
          }`
        );
        form.reset();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to import the defect register.");
      }
    });
  }

  function buildPermissionsFromFormData(formData: FormData): ModulePermissions {
    return createModulePermissions({
      overview: formData.get("overview") === "on",
      contractor_submissions: formData.get("contractor_submissions") === "on",
      handover: formData.get("handover") === "on",
      daily_reports: formData.get("daily_reports") === "on",
      weekly_reports: formData.get("weekly_reports") === "on",
      financials: formData.get("financials") === "on",
      completion: formData.get("completion") === "on",
      defects: formData.get("defects") === "on"
    });
  }

  function handleMembershipSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      try {
        await requireConfiguredAndUser();
        if (viewer?.role !== "master_admin") {
          throw new Error("You do not have permission to manage access roles.");
        }

        const supabase = getConfiguredClient();
        const email = String(formData.get("email") ?? "").trim().toLowerCase();
        const role = String(formData.get("role") ?? "consultant") as AppUserProfile["role"];
        const modules = buildPermissionsFromFormData(formData);

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("id, email, role")
          .eq("email", email)
          .maybeSingle();

        if (profileError) throw profileError;
        if (!profile) {
          throw new Error("That user account must be created from Settings before you can assign project access.");
        }

        if (profile.role !== role) {
          const { error: profileUpdateError } = await supabase.from("profiles").update({ role }).eq("id", profile.id);
          if (profileUpdateError) throw profileUpdateError;
        }

        const membershipPayload = {
          project_id: activeProject.overview.id,
          user_id: profile.id,
          email,
          role,
          can_overview: modules.overview,
          can_contractor_submissions: modules.contractor_submissions,
          can_handover: modules.handover,
          can_daily_reports: modules.daily_reports,
          can_weekly_reports: modules.weekly_reports,
          can_financials: modules.financials,
          can_completion: modules.completion,
          can_defects: modules.defects
        };

        const { data: membershipRow, error: membershipError } = await supabase
          .from("project_members")
          .upsert(membershipPayload, { onConflict: "project_id,user_id" })
          .select(
            "id, project_id, user_id, email, role, can_overview, can_contractor_submissions, can_handover, can_daily_reports, can_weekly_reports, can_financials, can_completion, can_defects"
          )
          .single();

        if (membershipError) throw membershipError;

        const nextMember: ProjectMember = {
          id: membershipRow.id,
          userId: membershipRow.user_id,
          email: membershipRow.email,
          role: membershipRow.role,
          modules
        };

        replaceProject(activeProject.overview.id, (project) => ({
          ...project,
          members: [...project.members.filter((member) => member.userId !== nextMember.userId), nextMember].sort((a, b) =>
            a.email.localeCompare(b.email)
          )
        }));
        await logProjectNotification({
          projectId: activeProject.overview.id,
          action: "updated",
          section: "Access Control",
          title: `Project access updated for ${nextMember.email}`,
          details: getRoleLabel(nextMember.role)
        });
        setFeedback("Project access updated.");
        form.reset();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to save project access.");
      }
    });
  }

  function handleMembershipDelete(memberId: string, userId: string) {
    resetMessages();
    startTransition(async () => {
      try {
        await requireConfiguredAndUser();
        if (viewer?.role !== "master_admin") {
          throw new Error("You do not have permission to remove project access.");
        }

        const supabase = getConfiguredClient();
        const { error: deleteError } = await supabase.from("project_members").delete().eq("id", memberId);
        if (deleteError) throw deleteError;

        replaceProject(activeProject.overview.id, (project) => ({
          ...project,
          members: project.members.filter((member) => member.id !== memberId),
          access:
            userId === viewer.id
              ? {
                  ...project.access,
                  modules: createModulePermissions()
                }
              : project.access
        }));
        await logProjectNotification({
          projectId: activeProject.overview.id,
          action: "deleted",
          section: "Access Control",
          title: "Project access removed"
        });
        setFeedback("Project access removed.");
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to remove access.");
      }
    });
  }

  return (
    <>
      <section className="hero-card">
        <div className="hero-copy-block">
          <p className="eyebrow">Active Project</p>
          <h2>{activeProject.overview.name || "Create your first project"}</h2>
          {viewer ? (
            <div className="viewer-banner">
              <span className="pill">{getRoleLabel(viewer.role, viewer.email)}</span>
              <span className="pill">{viewer.email || "current user"}</span>
            </div>
          ) : null}
          <div className="hero-meta-grid">
            <div>
              <span>Location</span>
              <strong>{activeProject.overview.location || "Not set"}</strong>
            </div>
            <div>
              <span>Client</span>
              <strong>{activeProject.overview.clientName || "Not set"}</strong>
            </div>
              <div>
                <span>Contractor</span>
              <strong>{leadContractorDisplayName}</strong>
              </div>
            <div>
              <span>Handover</span>
              <strong>{formatDate(activeProject.overview.handoverDate)}</strong>
            </div>
          </div>
        </div>
        <div className="countdown-card">
          <span>Countdown</span>
          <strong>{formatCountdown(activeProject.overview.completionDate, todaySnapshot)}</strong>
          <small>Target completion: {formatDate(activeProject.overview.completionDate)}</small>
        </div>
      </section>

      <section className="content-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Projects</p>
            <h3>{viewer?.role === "master_admin" ? "Create and switch projects" : "Your accessible projects"}</h3>
          </div>
          {canDeleteSelectedProject ? (
            <button
              className="ghost-button"
              disabled={isPending || !activeProject.overview.id}
              onClick={() => handleProjectDelete(activeProject.overview.id, activeProject.overview.name || "Untitled project")}
              type="button"
            >
              Delete selected project
            </button>
          ) : null}
        </div>

        {viewer?.role === "master_admin" || !viewer ? (
          <form className="project-form-grid" onSubmit={handleProjectCreate}>
            <label className="field">
              <span>Project name</span>
              <input name="name" placeholder="Example: Orchard Road refurbishment" required />
            </label>
            <label className="field">
              <span>Location</span>
              <input name="location" placeholder="Site address or unit" />
            </label>
            <label className="field">
              <span>Client</span>
              <input name="clientName" placeholder="Client name" />
            </label>
            <label className="field">
              <span>Lead contractor summary</span>
              <input name="contractorName" placeholder="Shown on dashboard header" />
            </label>
            <label className="field">
              <span>Handover date</span>
              <input name="handoverDate" type="date" />
            </label>
            <label className="field">
              <span>Completion date</span>
              <input name="completionDate" type="date" />
            </label>
            <label className="field field-full">
              <span>Project details</span>
              <textarea name="details" rows={4} placeholder="Scope, constraints, landlord conditions, authority notes..." />
            </label>
            <button className="primary-button" disabled={isPending || !isConfigured} type="submit">
              {isPending ? "Saving..." : "Create project"}
            </button>
          </form>
        ) : null}

        <div className="project-chip-row">
          {projects.map((project) => (
            <button
              className={`project-chip ${project.overview.id === activeProject.overview.id ? "active" : ""}`}
              key={project.overview.id}
              onClick={() => setActiveProjectId(project.overview.id)}
              type="button"
            >
              {project.overview.name}
            </button>
          ))}
        </div>
      </section>

      {!isConfigured ? (
        <p className="form-message">Demo mode is active. Add Supabase credentials to enable live CRUD and uploads.</p>
      ) : null}
      {feedback ? <p className="form-message">{feedback}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}

      <section className="content-card notification-panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">Notifications</p>
            <h3>Recent project changes</h3>
          </div>
          <span className="pill">{activeProject.notifications.length} updates</span>
        </div>
        {activeProject.notifications.length ? (
          <div className="notification-list">
            {activeProject.notifications.slice(0, 6).map((notification) => (
              <article className="notification-item" key={notification.id}>
                <div>
                  <strong>{notification.title}</strong>
                  {notification.details ? <p className="muted-copy">{notification.details}</p> : null}
                  <span>{notification.actorEmail || "System"} - {notification.section}</span>
                </div>
                <time dateTime={notification.createdAt}>{formatDateTime(notification.createdAt)}</time>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted-copy">No project changes have been logged yet.</p>
        )}
      </section>

      {isSuspended ? (
        <section className="content-card">
          <div className="section-header">
            <div>
              <p className="eyebrow">Access Paused</p>
              <h3>Your account is currently suspended</h3>
            </div>
          </div>
          <p className="muted-copy">
            Login is still active, but project records and module access are blocked until your access is reactivated.
          </p>
        </section>
      ) : null}

      {!isSuspended ? <div className="dashboard-grid">
        <aside className="dashboard-sidebar panel-surface">
          <div>
            <p className="eyebrow">Modules</p>
            <h3>Project menu</h3>
          </div>
          <span className="pill">{getRoleLabel(activeProject.access.assignedRole, viewer?.email)}</span>
          <div className="sidebar-active-panel">
            <p className="eyebrow">Now Viewing</p>
            <strong>{activePanel?.label ?? "No panel selected"}</strong>
          </div>
          <div className="nav-stack">
            {panelEntries.map((entry) => (
              <button
                className={cn("nav-button", activePanel?.key === entry.key && "active")}
                key={entry.key}
                onClick={() => handlePanelSelect(entry.key, entry.href)}
                type="button"
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div className="sidebar-cta">
            {activeProject.overview.id ? (
              <Link className="secondary-button" href={`/api/projects/${activeProject.overview.id}/reports/dilapidation`}>
                Download survey PDF
              </Link>
            ) : null}
          </div>
        </aside>

        <main className="dashboard-main">
          {moduleAccess.overview && activePanel?.key === "overview" ? (
            <section className="content-card dashboard-module-card" id="overview">
            <div className="section-header">
              <div>
                <p className="eyebrow">Overview</p>
                <h3>Project summary and timeline</h3>
              </div>
            </div>
            <div className="stats-grid">
              <StatCard label="Milestones" value={String(activeProject.milestones.length)} />
              <StatCard label="Daily Reports" value={String(activeProject.dailyReports.length)} />
              <StatCard label="Survey Items" value={String(activeProject.surveyItems.length)} />
              <StatCard label="Approved Value" value={formatCurrency(approvedTotal)} />
            </div>
            <div className="section-stack top-gap">
              <DisclosureCard
                className="panel-surface"
                eyebrow="Edit"
                meta={
                  <>
                    <span className="pill">{activeProject.overview.location || "No location"}</span>
                    <span className="pill">{formatDate(activeProject.overview.completionDate)}</span>
                  </>
                }
                title="Project details"
              >
                <form className="project-form-grid" onSubmit={handleOverviewUpdate}>
                  <label className="field">
                    <span>Project name</span>
                    <input defaultValue={activeProject.overview.name} key={`${activeProject.overview.id}-name`} name="name" required />
                  </label>
                  <label className="field">
                    <span>Location</span>
                    <input defaultValue={activeProject.overview.location} key={`${activeProject.overview.id}-location`} name="location" />
                  </label>
                  <label className="field">
                    <span>Client</span>
                    <input defaultValue={activeProject.overview.clientName} key={`${activeProject.overview.id}-client`} name="clientName" />
                  </label>
                  <label className="field">
                    <span>Lead contractor summary</span>
                    <input
                      defaultValue={activeProject.overview.contractorName}
                      key={`${activeProject.overview.id}-contractor`}
                      name="contractorName"
                    />
                  </label>
                  <label className="field">
                    <span>Handover date</span>
                    <input
                      defaultValue={activeProject.overview.handoverDate ?? ""}
                      key={`${activeProject.overview.id}-handover`}
                      name="handoverDate"
                      type="date"
                    />
                  </label>
                  <label className="field">
                    <span>Completion date</span>
                    <input
                      defaultValue={activeProject.overview.completionDate ?? ""}
                      key={`${activeProject.overview.id}-completion`}
                      name="completionDate"
                      type="date"
                    />
                  </label>
                  <label className="field field-full">
                    <span>Project details</span>
                    <textarea
                      defaultValue={activeProject.overview.details}
                      key={`${activeProject.overview.id}-details`}
                      name="details"
                      rows={4}
                    />
                  </label>
                  <button className="primary-button" disabled={isPending || !isConfigured || !activeProject.overview.id} type="submit">
                    {isPending ? "Saving..." : "Save overview"}
                  </button>
                </form>
              </DisclosureCard>

              <DisclosureCard
                className="panel-surface"
                eyebrow={canManageOverviewTeams ? "Team Setup" : "Team"}
                meta={
                  <>
                    <span className="pill">{activeProject.projectContractors.length} saved</span>
                    <span className="pill">{canManageOverviewTeams ? "Editable" : "Read only"}</span>
                  </>
                }
                title="Contractor information"
              >
                {canManageOverviewTeams ? (
                  <form
                    className="module-form-grid"
                    onSubmit={(event) =>
                      handleRecordCreate(event, {
                        table: "project_contractors",
                        label: "Contractor information saved.",
                        buildPayload: (formData) => {
                          const trades = readSelectedContractorTrades(formData);
                          if (!trades.length) {
                            throw new Error("Select at least one trade for the contractor entry.");
                          }

                          return {
                            company_name: String(formData.get("companyName") ?? "").trim(),
                            contractor_type: String(formData.get("contractorType") ?? "main_contractor") as ContractorPartyType,
                            trades
                          };
                        },
                        select: "id, company_name, contractor_type, trades",
                        append: (project, data) => ({
                          ...project,
                          projectContractors: sortProjectContractors([...project.projectContractors, buildProjectContractorFromRow(data)])
                        })
                      })
                    }
                  >
                    <label className="field">
                      <span>Company name</span>
                      <input name="companyName" placeholder="Northfield Projects" required />
                    </label>
                    <label className="field">
                      <span>Type</span>
                      <select name="contractorType">
                        {CONTRACTOR_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="field field-full">
                      <span>Responsible trades</span>
                      <div className="selection-grid">
                        {CONTRACTOR_TRADE_OPTIONS.map((option) => (
                          <label className="selection-card" key={option.value}>
                            <input name="trades" type="checkbox" value={option.value} />
                            <span>{option.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <button className="secondary-button" disabled={isPending || !isConfigured || !activeProject.overview.id} type="submit">
                      Add contractor company
                    </button>
                  </form>
                ) : null}
                {activeProject.projectContractors.length ? (
                  <div className="team-card-grid top-gap">
                    {sortProjectContractors(activeProject.projectContractors).map((contractor) => (
                      <article className="record-surface team-record" key={contractor.id}>
                        <div className="record-header">
                          <div>
                            <strong>{contractor.companyName}</strong>
                            <p>{formatContractorTypeLabel(contractor.contractorType)}</p>
                          </div>
                          {canManageOverviewTeams ? (
                            <button
                              className="ghost-button"
                              onClick={() =>
                                handleDelete({
                                  table: "project_contractors",
                                  recordId: contractor.id,
                                  remove: (project) => ({
                                    ...project,
                                    projectContractors: project.projectContractors.filter((item) => item.id !== contractor.id)
                                  })
                                })
                              }
                              type="button"
                            >
                              Delete
                            </button>
                          ) : null}
                        </div>
                        <div className="pill-row">
                          {contractor.trades.map((trade) => (
                            <span className="pill" key={trade}>
                              {formatContractorTradeLabel(trade)}
                            </span>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="muted-copy top-gap">
                    {canManageOverviewTeams ? "No contractor companies added yet." : "No contractor companies have been listed yet."}
                  </p>
                )}
              </DisclosureCard>

              <DisclosureCard
                className="panel-surface"
                eyebrow={canManageOverviewTeams ? "Design Team" : "Team"}
                meta={
                  <>
                    <span className="pill">{activeProject.projectConsultants.length} saved</span>
                    <span className="pill">{canManageOverviewTeams ? "Editable" : "Read only"}</span>
                  </>
                }
                title="Consultant details"
              >
                {canManageOverviewTeams ? (
                  <form
                    className="module-form-grid"
                    onSubmit={(event) =>
                      handleRecordCreate(event, {
                        table: "project_consultants",
                        label: "Consultant details saved.",
                        buildPayload: (formData) => {
                          const trades = readSelectedConsultantTrades(formData);
                          if (!trades.length) {
                            throw new Error("Select at least one trade for the consultant entry.");
                          }

                          return {
                            company_name: String(formData.get("companyName") ?? "").trim(),
                            trades
                          };
                        },
                        select: "id, company_name, trades",
                        append: (project, data) => ({
                          ...project,
                          projectConsultants: sortProjectConsultants([...project.projectConsultants, buildProjectConsultantFromRow(data)])
                        })
                      })
                    }
                  >
                    <label className="field field-full">
                      <span>Consultant company</span>
                      <input name="companyName" placeholder="Studio Form Architects" required />
                    </label>
                    <div className="field field-full">
                      <span>Trade</span>
                      <div className="selection-grid compact-selection-grid">
                        {CONSULTANT_TRADE_OPTIONS.map((option) => (
                          <label className="selection-card" key={option.value}>
                            <input name="trades" type="checkbox" value={option.value} />
                            <span>{option.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <button className="secondary-button" disabled={isPending || !isConfigured || !activeProject.overview.id} type="submit">
                      Add consultant company
                    </button>
                  </form>
                ) : null}
                {activeProject.projectConsultants.length ? (
                  <div className="team-card-grid top-gap">
                    {sortProjectConsultants(activeProject.projectConsultants).map((consultant) => (
                      <article className="record-surface team-record" key={consultant.id}>
                        <div className="record-header">
                          <div>
                            <strong>{consultant.companyName}</strong>
                            <p>Consultant</p>
                          </div>
                          {canManageOverviewTeams ? (
                            <button
                              className="ghost-button"
                              onClick={() =>
                                handleDelete({
                                  table: "project_consultants",
                                  recordId: consultant.id,
                                  remove: (project) => ({
                                    ...project,
                                    projectConsultants: project.projectConsultants.filter((item) => item.id !== consultant.id)
                                  })
                                })
                              }
                              type="button"
                            >
                              Delete
                            </button>
                          ) : null}
                        </div>
                        <div className="pill-row">
                          {consultant.trades.map((trade) => (
                            <span className="pill" key={trade}>
                              {formatConsultantTradeLabel(trade)}
                            </span>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="muted-copy top-gap">
                    {canManageOverviewTeams ? "No consultant companies added yet." : "No consultant companies have been listed yet."}
                  </p>
                )}
              </DisclosureCard>

              <DisclosureCard
                className="panel-surface"
                eyebrow="Timeline"
                meta={<span className="pill">{activeProject.milestones.length} saved</span>}
                title="Milestones"
              >
                <form className="inline-create-form" onSubmit={handleMilestoneCreate}>
                  <label className="field">
                    <span>Milestone</span>
                    <input name="title" placeholder="Authority submission" required />
                  </label>
                  <label className="field">
                    <span>Date</span>
                    <input name="dueDate" type="date" required />
                  </label>
                  <button className="secondary-button" disabled={isPending || !isConfigured || !activeProject.overview.id} type="submit">
                    Add milestone
                  </button>
                </form>

                <div className="list-grid top-gap">
                  {activeProject.milestones.length ? (
                    activeProject.milestones.map((milestone) => (
                      <article className="record-surface" key={milestone.id}>
                        <div className="record-header">
                          <div>
                            <strong>{milestone.title}</strong>
                            <p>{formatDate(milestone.dueDate)}</p>
                          </div>
                          <button
                            className="ghost-button"
                            onClick={() =>
                              handleDelete({
                                table: "milestones",
                                recordId: milestone.id,
                                remove: (project) => ({
                                  ...project,
                                  milestones: project.milestones.filter((item) => item.id !== milestone.id)
                                })
                              })
                            }
                            type="button"
                          >
                            Delete
                          </button>
                        </div>
                      </article>
                    ))
                  ) : (
                    <article className="record-surface">
                      <p className="muted-copy">No milestones added yet.</p>
                    </article>
                  )}
                </div>
              </DisclosureCard>
            </div>
            </section>
          ) : null}

          {moduleAccess.contractor_submissions && activePanel?.key === "contractor_submissions" ? (
            <section className="content-card dashboard-module-card" id="contractor-submissions">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Project Coordination</p>
                  <h3>Documents Submission</h3>
                </div>
              </div>

              <div className="section-stack top-gap">
                <section className="panel-surface">
                  <div className="section-header">
                    <div>
                      <p className="eyebrow">Contractor</p>
                      <h3>Contractor Documents</h3>
                    </div>
                  </div>
                  <DisclosureCard
                    badge={!canCreateContractorSubmissions ? <TonePill tone="pending">Review only</TonePill> : undefined}
                    className="panel-surface"
                    eyebrow="Create"
                    meta={
                      <>
                        <span className="pill">{activeProject.contractorSubmissions.length} saved</span>
                        <span className="pill">{contractorSubmissionDraftItems.length} draft item(s)</span>
                      </>
                    }
                    title="New contractor submission"
                  >
                    <form
                      className="module-form-grid"
                      onSubmit={(event) =>
                        handleRecordCreate(event, {
                          table: "contractor_submissions",
                          section: "contractor_submission",
                          buildPayload: (formData) => {
                            const items = normalizeContractorSubmissionItemsPayload();
                            const firstItem = items[0];

                            return {
                              submission_type: firstItem.submissionType,
                              submitted_date: String(formData.get("submittedDate") ?? ""),
                              description: firstItem.description,
                              quantity: firstItem.quantity,
                              unit: firstItem.unit,
                              items
                            };
                          },
                          select: CONTRACTOR_SUBMISSION_SELECT,
                          append: (project, data, attachments) => ({
                            ...project,
                            contractorSubmissions: [buildContractorSubmissionFromRow(data, attachments), ...project.contractorSubmissions]
                          }),
                          afterSuccess: resetContractorSubmissionDraftItems
                        })
                      }
                    >
                      <label className="field">
                        <span>Date of submission</span>
                        <input name="submittedDate" required type="date" />
                      </label>
                      <label className="field field-full">
                        <span>Submission items</span>
                        <div className="draft-items-stack">
                          {contractorSubmissionDraftItems.map((item, index) => (
                            <article className="record-surface draft-item-card" key={item.id}>
                              <div className="record-header">
                                <div>
                                  <strong>Item {index + 1}</strong>
                                  <p>{formatSectionLabel(item.submissionType)}</p>
                                </div>
                                <button
                                  className="ghost-button"
                                  disabled={isPending}
                                  onClick={() => removeContractorSubmissionDraftItem(item.id)}
                                  type="button"
                                >
                                  Delete item
                                </button>
                              </div>
                              <div className="draft-item-grid">
                                <label className="field">
                                  <span>Submission item</span>
                                  <select
                                    onChange={(event) =>
                                      updateContractorSubmissionDraftItem(item.id, "submissionType", event.currentTarget.value)
                                    }
                                    value={item.submissionType}
                                  >
                                    <option value="material_submission">Material Submission</option>
                                    <option value="method_statement">Method Statement</option>
                                    <option value="project_programme">Project Programme</option>
                                    <option value="rfi">Request For Information (RFI)</option>
                                  </select>
                                </label>
                                <label className="field">
                                  <span>Quantity</span>
                                  <input
                                    min="0"
                                    onChange={(event) => updateContractorSubmissionDraftItem(item.id, "quantity", event.currentTarget.value)}
                                    step="0.01"
                                    type="number"
                                    value={item.quantity}
                                  />
                                </label>
                                <label className="field">
                                  <span>Unit of measurement</span>
                                  <input
                                    onChange={(event) => updateContractorSubmissionDraftItem(item.id, "unit", event.currentTarget.value)}
                                    placeholder="pcs / m2 / set / n.a."
                                    value={item.unit}
                                  />
                                </label>
                                <label className="field field-full">
                                  <span>Description</span>
                                  <textarea
                                    onChange={(event) =>
                                      updateContractorSubmissionDraftItem(item.id, "description", event.currentTarget.value)
                                    }
                                    placeholder="Describe this submission item."
                                    rows={3}
                                    value={item.description}
                                  />
                                </label>
                              </div>
                            </article>
                          ))}
                        </div>
                      </label>
                      <div className="record-actions">
                        <button className="ghost-button" disabled={isPending} onClick={addContractorSubmissionDraftItem} type="button">
                          Add another item
                        </button>
                        <span className="muted-copy">{contractorSubmissionDraftItems.length} item(s) will be saved as one submission.</span>
                      </div>
                      <label className="field field-full">
                        <span>Attachments</span>
                        <input accept={getUploadAcceptForMode("mixed")} multiple name="attachments" type="file" />
                        <FreePilotUploadHint mode="mixed" />
                      </label>
                      <button
                        className="primary-button"
                        disabled={isPending || !isConfigured || !activeProject.overview.id || !canCreateContractorSubmissions}
                        type="submit"
                      >
                        Add contractor submission
                      </button>
                    </form>
                    {!canCreateContractorSubmissions ? (
                      <p className="muted-copy top-gap">Review only.</p>
                    ) : null}
                  </DisclosureCard>
                  <div className="list-grid top-gap">
                    {activeProject.contractorSubmissions.length ? (
                      activeProject.contractorSubmissions.map((submission) => (
                        <DisclosureCard
                          badge={<StatusPill status={getContractorSubmissionOverallStatus(submission)} label="Overall" />}
                          className="record-surface submission-card"
                          eyebrow="Saved Submission"
                          key={submission.id}
                          meta={
                            <>
                              <span className="pill">{getSafeContractorSubmissionItems(submission).length} item(s)</span>
                              <span className="pill">{getRoleLabel(submission.ownerRole, submission.ownerEmail)}</span>
                              <span className="pill">{submission.ownerEmail || "Unknown user"}</span>
                            </>
                          }
                          subtitle={formatDate(submission.submittedDate)}
                          title={getContractorSubmissionHeading(submission)}
                        >
                          <div className="submission-item-list">
                            {getSafeContractorSubmissionItems(submission).map((item, index) => (
                              <article className="submission-item" key={item.id}>
                                <div className="submission-item-header">
                                  <strong>
                                    {index + 1}. {formatSectionLabel(item.submissionType)}
                                  </strong>
                                  <span className="pill">
                                    {item.quantity === null ? "Qty not stated" : `Qty ${item.quantity}`}
                                    {item.unit ? ` ${item.unit}` : ""}
                                  </span>
                                </div>
                                <p>{item.description}</p>
                              </article>
                            ))}
                          </div>
                          <div className="submission-review-grid">
                            <article className="submission-review-card">
                              <div className="submission-review-header">
                                <div>
                                  <strong>Client approval</strong>
                                  <p className="muted-copy">
                                    {submission.clientStatus === "pending"
                                      ? "Awaiting client review."
                                      : `${getApprovalLabel(submission.clientStatus)} by ${submission.clientReviewedByEmail || "client"}${
                                          submission.clientReviewedAt ? ` on ${formatDateTime(submission.clientReviewedAt)}` : ""
                                        }`}
                                  </p>
                                </div>
                                <StatusPill status={submission.clientStatus} />
                              </div>
                              {submission.clientReviewNote ? <p className="muted-copy">Comment: {submission.clientReviewNote}</p> : null}
                              {canReviewContractorSubmissionsAsClient ? (
                                <>
                                  <label className="field">
                                    <span>Client review comment</span>
                                    <textarea
                                      onChange={(event) =>
                                        setContractorSubmissionReviewNote(submission.id, "client", event.currentTarget.value)
                                      }
                                      placeholder="Optional for approval. Required for rejection."
                                      rows={2}
                                      value={
                                        contractorSubmissionReviewNotes[getContractorSubmissionReviewKey(submission.id, "client")] ??
                                        submission.clientReviewNote
                                      }
                                    />
                                  </label>
                                  <div className="record-actions">
                                    <button
                                      className="secondary-button"
                                      disabled={isPending || !isConfigured}
                                      onClick={() => handleContractorSubmissionStatusUpdate(submission, "approved")}
                                      type="button"
                                    >
                                      Approve
                                    </button>
                                    <button
                                      className="ghost-button"
                                      disabled={isPending || !isConfigured}
                                      onClick={() => handleContractorSubmissionStatusUpdate(submission, "rejected")}
                                      type="button"
                                    >
                                      Reject
                                    </button>
                                    <button
                                      className="ghost-button"
                                      disabled={isPending || !isConfigured}
                                      onClick={() => handleContractorSubmissionStatusUpdate(submission, "pending")}
                                      type="button"
                                    >
                                      Reset to pending
                                    </button>
                                  </div>
                                </>
                              ) : null}
                            </article>
                            <article className="submission-review-card">
                              <div className="submission-review-header">
                                <div>
                                  <strong>Consultant approval</strong>
                                  <p className="muted-copy">
                                    {submission.consultantStatus === "pending"
                                      ? "Awaiting consultant review."
                                      : `${getApprovalLabel(submission.consultantStatus)} by ${
                                          submission.consultantReviewedByEmail || "consultant"
                                        }${submission.consultantReviewedAt ? ` on ${formatDateTime(submission.consultantReviewedAt)}` : ""}`}
                                  </p>
                                </div>
                                <StatusPill status={submission.consultantStatus} />
                              </div>
                              {submission.consultantReviewNote ? <p className="muted-copy">Comment: {submission.consultantReviewNote}</p> : null}
                              {canReviewContractorSubmissionsAsConsultant ? (
                                <>
                                  <label className="field">
                                    <span>Consultant review comment</span>
                                    <textarea
                                      onChange={(event) =>
                                        setContractorSubmissionReviewNote(submission.id, "consultant", event.currentTarget.value)
                                      }
                                      placeholder="Optional for approval. Required for rejection."
                                      rows={2}
                                      value={
                                        contractorSubmissionReviewNotes[getContractorSubmissionReviewKey(submission.id, "consultant")] ??
                                        submission.consultantReviewNote
                                      }
                                    />
                                  </label>
                                  <div className="record-actions">
                                    <button
                                      className="secondary-button"
                                      disabled={isPending || !isConfigured}
                                      onClick={() => handleContractorSubmissionStatusUpdate(submission, "approved")}
                                      type="button"
                                    >
                                      Approve
                                    </button>
                                    <button
                                      className="ghost-button"
                                      disabled={isPending || !isConfigured}
                                      onClick={() => handleContractorSubmissionStatusUpdate(submission, "rejected")}
                                      type="button"
                                    >
                                      Reject
                                    </button>
                                    <button
                                      className="ghost-button"
                                      disabled={isPending || !isConfigured}
                                      onClick={() => handleContractorSubmissionStatusUpdate(submission, "pending")}
                                      type="button"
                                    >
                                      Reset to pending
                                    </button>
                                  </div>
                                </>
                              ) : null}
                            </article>
                          </div>
                          <AttachmentList attachments={submission.attachments} />
                          {viewer?.role === "master_admin" || (viewer?.id && submission.ownerUserId === viewer.id) ? (
                            <>
                              <p className="muted-copy top-gap">
                                Editing this submission will reset both client and consultant reviews back to pending.
                              </p>
                              <form
                                className="module-form-grid top-gap"
                                onSubmit={(event) =>
                                  handleRecordUpdate(event, {
                                    table: "contractor_submissions",
                                    recordId: submission.id,
                                    section: "contractor_submission",
                                    label: "Contractor submission updated and review statuses reset.",
                                    buildPayload: (formData) => {
                                      const items = normalizeExistingContractorSubmissionItemsPayload(formData, submission);
                                      const firstItem = items[0];

                                      return {
                                        submitted_date: String(formData.get("submittedDate") ?? ""),
                                        submission_type: firstItem.submissionType,
                                        description: firstItem.description,
                                        quantity: firstItem.quantity,
                                        unit: firstItem.unit,
                                        items,
                                        client_status: "pending" as ApprovalStatus,
                                        client_review_note: "",
                                        client_reviewed_at: null,
                                        client_reviewed_by_user_id: null,
                                        client_reviewed_by_email: null,
                                        consultant_status: "pending" as ApprovalStatus,
                                        consultant_review_note: "",
                                        consultant_reviewed_at: null,
                                        consultant_reviewed_by_user_id: null,
                                        consultant_reviewed_by_email: null
                                      };
                                    },
                                    select: CONTRACTOR_SUBMISSION_SELECT,
                                    update: (project, data, attachments) => ({
                                      ...project,
                                      contractorSubmissions: project.contractorSubmissions.map((item) =>
                                        item.id === submission.id ? buildContractorSubmissionFromRow(data, [...item.attachments, ...attachments]) : item
                                      )
                                    })
                                  })
                                }
                              >
                                <label className="field">
                                  <span>Date of submission</span>
                                  <input defaultValue={submission.submittedDate} name="submittedDate" required type="date" />
                                </label>
                                <div className="field field-full">
                                  <span>Submission items</span>
                                  <div className="draft-items-stack">
                                    {getSafeContractorSubmissionItems(submission).map((item, index) => (
                                      <article className="record-surface draft-item-card" key={`edit-${item.id}`}>
                                        <div className="record-header">
                                          <div>
                                            <strong>Item {index + 1}</strong>
                                            <p>{formatSectionLabel(item.submissionType)}</p>
                                          </div>
                                        </div>
                                        <div className="draft-item-grid">
                                          <label className="field">
                                            <span>Submission item</span>
                                            <select defaultValue={item.submissionType} name={`submissionType:${item.id}`}>
                                              <option value="material_submission">Material Submission</option>
                                              <option value="method_statement">Method Statement</option>
                                              <option value="project_programme">Project Programme</option>
                                              <option value="rfi">Request For Information (RFI)</option>
                                            </select>
                                          </label>
                                          <label className="field">
                                            <span>Quantity</span>
                                            <input defaultValue={item.quantity ?? ""} min="0" name={`quantity:${item.id}`} step="0.01" type="number" />
                                          </label>
                                          <label className="field">
                                            <span>Unit of measurement</span>
                                            <input defaultValue={item.unit} name={`unit:${item.id}`} placeholder="pcs / m2 / set / n.a." />
                                          </label>
                                          <label className="field field-full">
                                            <span>Description</span>
                                            <textarea defaultValue={item.description} name={`description:${item.id}`} rows={3} />
                                          </label>
                                        </div>
                                      </article>
                                    ))}
                                  </div>
                                </div>
                                <label className="field field-full">
                                  <span>Add more attachments</span>
                                  <input accept={getUploadAcceptForMode("mixed")} multiple name="attachments" type="file" />
                                </label>
                                <div className="record-actions field-full">
                                  <button className="primary-button" disabled={isPending || !isConfigured} type="submit">
                                    Save changes
                                  </button>
                                  <button
                                    className="ghost-button"
                                    onClick={() =>
                                      handleDelete({
                                        table: "contractor_submissions",
                                        recordId: submission.id,
                                        section: "contractor_submission",
                                        remove: (project) => ({
                                          ...project,
                                          contractorSubmissions: project.contractorSubmissions.filter((item) => item.id !== submission.id)
                                        })
                                      })
                                    }
                                    type="button"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </form>
                            </>
                          ) : null}
                        </DisclosureCard>
                      ))
                    ) : (
                      <article className="record-surface">
                        <p className="muted-copy">No contractor submissions recorded yet.</p>
                      </article>
                    )}
                  </div>
                </section>

                <section className="panel-surface">
                  <div className="section-header">
                    <div>
                      <p className="eyebrow">Consultant</p>
                      <h3>Consultant Documents</h3>
                    </div>
                  </div>
                  <DisclosureCard
                    badge={!canCreateConsultantSubmissions ? <TonePill tone="pending">Review only</TonePill> : undefined}
                    className="panel-surface"
                    eyebrow="Create"
                    meta={
                      <>
                        <span className="pill">{activeProject.consultantSubmissions.length} saved</span>
                        <span className="pill">{consultantSubmissionDraftItems.length} draft item(s)</span>
                      </>
                    }
                    title="New consultant document"
                  >
                    <form
                      className="module-form-grid"
                      onSubmit={(event) =>
                        handleRecordCreate(event, {
                          table: "consultant_submissions",
                          section: "consultant_submission",
                          buildPayload: (formData) => {
                            const items = normalizeConsultantSubmissionItemsPayload();
                            const firstItem = items[0];

                            return {
                              submitted_date: String(formData.get("submittedDate") ?? ""),
                              document_type: firstItem.documentType,
                              description: firstItem.description,
                              items
                            };
                          },
                          select: CONSULTANT_SUBMISSION_SELECT,
                          append: (project, data, attachments) => ({
                            ...project,
                            consultantSubmissions: [buildConsultantSubmissionFromRow(data, attachments), ...project.consultantSubmissions]
                          }),
                          afterSuccess: resetConsultantSubmissionDraftItems
                        })
                      }
                    >
                      <label className="field">
                        <span>Date of submission</span>
                        <input name="submittedDate" required type="date" />
                      </label>
                      <label className="field field-full">
                        <span>Document items</span>
                        <div className="draft-items-stack">
                          {consultantSubmissionDraftItems.map((item, index) => (
                            <article className="record-surface draft-item-card" key={item.id}>
                              <div className="record-header">
                                <div>
                                  <strong>Item {index + 1}</strong>
                                  <p>{item.documentType || "Document type not set yet"}</p>
                                </div>
                                <button
                                  className="ghost-button"
                                  disabled={isPending}
                                  onClick={() => removeConsultantSubmissionDraftItem(item.id)}
                                  type="button"
                                >
                                  Delete item
                                </button>
                              </div>
                              <div className="draft-item-grid">
                                <label className="field">
                                  <span>Type of document</span>
                                  <input
                                    onChange={(event) => updateConsultantSubmissionDraftItem(item.id, "documentType", event.currentTarget.value)}
                                    placeholder="Architectural sketch / MEP memo / report"
                                    value={item.documentType}
                                  />
                                </label>
                                <label className="field field-full">
                                  <span>Description</span>
                                  <textarea
                                    onChange={(event) =>
                                      updateConsultantSubmissionDraftItem(item.id, "description", event.currentTarget.value)
                                    }
                                    placeholder="Describe this consultant document item."
                                    rows={3}
                                    value={item.description}
                                  />
                                </label>
                              </div>
                            </article>
                          ))}
                        </div>
                      </label>
                      <div className="record-actions">
                        <button className="ghost-button" disabled={isPending} onClick={addConsultantSubmissionDraftItem} type="button">
                          Add another item
                        </button>
                        <span className="muted-copy">{consultantSubmissionDraftItems.length} item(s) will be saved as one submission.</span>
                      </div>
                      <label className="field field-full">
                        <span>Attachments</span>
                        <input accept={getUploadAcceptForMode("mixed")} multiple name="attachments" type="file" />
                        <FreePilotUploadHint mode="mixed" />
                      </label>
                      <button
                        className="primary-button"
                        disabled={isPending || !isConfigured || !activeProject.overview.id || !canCreateConsultantSubmissions}
                        type="submit"
                      >
                        Add consultant document
                      </button>
                    </form>
                    {!canCreateConsultantSubmissions ? (
                      <p className="muted-copy top-gap">Review only.</p>
                    ) : null}
                  </DisclosureCard>
                  <div className="list-grid top-gap">
                    {activeProject.consultantSubmissions.length ? (
                      activeProject.consultantSubmissions.map((submission) => (
                        <DisclosureCard
                          badge={<StatusPill status={submission.status} labels={CONSULTANT_DOCUMENT_STATUS_LABELS} />}
                          className="record-surface submission-card"
                          eyebrow="Saved Submission"
                          key={submission.id}
                          meta={
                            <>
                              <span className="pill">{getSafeConsultantSubmissionItems(submission).length} item(s)</span>
                              <span className="pill">{getRoleLabel(submission.ownerRole, submission.ownerEmail)}</span>
                              <span className="pill">{submission.ownerEmail || "Unknown user"}</span>
                            </>
                          }
                          subtitle={formatDate(submission.submittedDate)}
                          title={getConsultantSubmissionHeading(submission)}
                        >
                          <div className="submission-item-list">
                            {getSafeConsultantSubmissionItems(submission).map((item, index) => (
                              <article className="submission-item" key={item.id}>
                                <div className="submission-item-header">
                                  <strong>
                                    {index + 1}. {item.documentType || "Consultant document"}
                                  </strong>
                                </div>
                                <p>{item.description}</p>
                              </article>
                            ))}
                          </div>
                          <div className="submission-review-grid">
                            <article className="submission-review-card">
                              <div className="submission-review-header">
                                <div>
                                  <strong>Client review</strong>
                                  <p className="muted-copy">
                                    {submission.status === "pending"
                                      ? "Awaiting client review."
                                      : `${getApprovalLabel(submission.status, CONSULTANT_DOCUMENT_STATUS_LABELS)} by ${
                                          submission.reviewedByEmail || "client"
                                        }${submission.reviewedAt ? ` on ${formatDateTime(submission.reviewedAt)}` : ""}`}
                                  </p>
                                </div>
                                <StatusPill status={submission.status} labels={CONSULTANT_DOCUMENT_STATUS_LABELS} />
                              </div>
                              {submission.reviewNote ? <p className="muted-copy">Comment: {submission.reviewNote}</p> : null}
                              {canReviewConsultantSubmissions ? (
                                <>
                                  <label className="field">
                                    <span>Client review comment</span>
                                    <textarea
                                      onChange={(event) => setConsultantSubmissionReviewNotes((current) => ({
                                        ...current,
                                        [submission.id]: event.currentTarget.value
                                      }))}
                                      placeholder="Optional for acceptance. Required when returning the document."
                                      rows={2}
                                      value={consultantSubmissionReviewNotes[submission.id] ?? submission.reviewNote}
                                    />
                                  </label>
                                  <div className="record-actions">
                                    <button
                                      className="secondary-button"
                                      disabled={isPending || !isConfigured}
                                      onClick={() => handleConsultantSubmissionStatusUpdate(submission, "approved")}
                                      type="button"
                                    >
                                      Accept
                                    </button>
                                    <button
                                      className="ghost-button"
                                      disabled={isPending || !isConfigured}
                                      onClick={() => handleConsultantSubmissionStatusUpdate(submission, "rejected")}
                                      type="button"
                                    >
                                      Return
                                    </button>
                                  </div>
                                </>
                              ) : null}
                            </article>
                          </div>
                          <AttachmentList attachments={submission.attachments} />
                          {viewer?.role === "master_admin" || (viewer?.id && submission.ownerUserId === viewer.id) ? (
                            <>
                              <p className="muted-copy top-gap">
                                Editing this submission will return the client review status to pending.
                              </p>
                              <form
                                className="module-form-grid top-gap"
                                onSubmit={(event) =>
                                  handleRecordUpdate(event, {
                                    table: "consultant_submissions",
                                    recordId: submission.id,
                                    section: "consultant_submission",
                                    label: "Consultant submission updated and client review reset.",
                                    buildPayload: (formData) => {
                                      const items = normalizeExistingConsultantSubmissionItemsPayload(formData, submission);
                                      const firstItem = items[0];

                                      return {
                                        submitted_date: String(formData.get("submittedDate") ?? ""),
                                        document_type: firstItem.documentType,
                                        description: firstItem.description,
                                        items,
                                        status: "pending" as ApprovalStatus,
                                        review_note: "",
                                        reviewed_at: null,
                                        reviewed_by_user_id: null,
                                        reviewed_by_email: null
                                      };
                                    },
                                    select: CONSULTANT_SUBMISSION_SELECT,
                                    update: (project, data, attachments) => ({
                                      ...project,
                                      consultantSubmissions: project.consultantSubmissions.map((item) =>
                                        item.id === submission.id ? buildConsultantSubmissionFromRow(data, [...item.attachments, ...attachments]) : item
                                      )
                                    })
                                  })
                                }
                              >
                                <label className="field">
                                  <span>Date of submission</span>
                                  <input defaultValue={submission.submittedDate} name="submittedDate" required type="date" />
                                </label>
                                <div className="field field-full">
                                  <span>Document items</span>
                                  <div className="draft-items-stack">
                                    {getSafeConsultantSubmissionItems(submission).map((item, index) => (
                                      <article className="record-surface draft-item-card" key={`edit-${item.id}`}>
                                        <div className="record-header">
                                          <div>
                                            <strong>Item {index + 1}</strong>
                                            <p>{item.documentType || "Consultant document"}</p>
                                          </div>
                                        </div>
                                        <div className="draft-item-grid">
                                          <label className="field">
                                            <span>Type of document</span>
                                            <input defaultValue={item.documentType} name={`documentType:${item.id}`} />
                                          </label>
                                          <label className="field field-full">
                                            <span>Description</span>
                                            <textarea defaultValue={item.description} name={`description:${item.id}`} rows={3} />
                                          </label>
                                        </div>
                                      </article>
                                    ))}
                                  </div>
                                </div>
                                <label className="field field-full">
                                  <span>Add more attachments</span>
                                  <input accept={getUploadAcceptForMode("mixed")} multiple name="attachments" type="file" />
                                </label>
                                <div className="record-actions field-full">
                                  <button className="primary-button" disabled={isPending || !isConfigured} type="submit">
                                    Save changes
                                  </button>
                                  <button
                                    className="ghost-button"
                                    onClick={() =>
                                      handleDelete({
                                        table: "consultant_submissions",
                                        recordId: submission.id,
                                        section: "consultant_submission",
                                        remove: (project) => ({
                                          ...project,
                                          consultantSubmissions: project.consultantSubmissions.filter((item) => item.id !== submission.id)
                                        })
                                      })
                                    }
                                    type="button"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </form>
                            </>
                          ) : null}
                        </DisclosureCard>
                      ))
                    ) : (
                      <article className="record-surface">
                        <p className="muted-copy">No consultant documents recorded yet.</p>
                      </article>
                    )}
                  </div>
                </section>
              </div>
            </section>
          ) : null}

          {moduleAccess.handover && activePanel?.key === "handover" ? (
            <section className="content-card dashboard-module-card" id="handover">
            <div className="section-header">
              <div>
                <p className="eyebrow">Client to Contractor</p>
                <h3>Pre-Handover Survey / Dilapidation</h3>
              </div>
            </div>
            <DisclosureCard
              className="panel-surface top-gap"
              eyebrow="Create"
              meta={<span className="pill">{activeProject.surveyItems.length} saved</span>}
              title="New survey item"
            >
              <form
                className="module-form-grid"
                onSubmit={(event) =>
                  handleRecordCreate(event, {
                    table: "survey_items",
                    section: "survey_item",
                    buildPayload: (formData) => ({
                      area: String(formData.get("area") ?? "").trim(),
                      item: String(formData.get("item") ?? "").trim(),
                      status: String(formData.get("status") ?? "good") as ChecklistStatus,
                      details: String(formData.get("details") ?? "").trim()
                    }),
                    select: "id, area, item, status, details",
                    append: (project, data, attachments) => ({
                      ...project,
                      surveyItems: [
                        {
                          id: String(data.id),
                          area: String(data.area),
                          item: String(data.item),
                          status: data.status as ChecklistStatus,
                          details: String(data.details ?? ""),
                          attachments
                        },
                        ...project.surveyItems
                      ]
                    })
                  })
                }
              >
                <label className="field">
                  <span>Area / location</span>
                  <input name="area" placeholder="Existing kitchen exhaust riser" required />
                </label>
                <label className="field">
                  <span>Checklist item</span>
                  <input name="item" placeholder="Wall, slab, M&E points, fixtures" required />
                </label>
                <label className="field">
                  <span>Status</span>
                  <select name="status">
                    <option value="good">Good</option>
                    <option value="minor_issue">Minor issue</option>
                    <option value="major_issue">Major issue</option>
                    <option value="missing">Missing</option>
                  </select>
                </label>
                <label className="field field-full">
                  <span>Recorded details</span>
                  <textarea name="details" rows={3} />
                </label>
                <label className="field field-full">
                  <span>Photo attachments</span>
                  <input accept={getUploadAcceptForMode("image-only")} multiple name="attachments" type="file" />
                  <FreePilotUploadHint mode="image-only" />
                </label>
                <button className="primary-button" disabled={isPending || !isConfigured || !activeProject.overview.id} type="submit">
                  Add survey item
                </button>
              </form>
            </DisclosureCard>
            <div className="list-grid top-gap">
              {activeProject.surveyItems.length ? (
                activeProject.surveyItems.map((item) => (
                  <DisclosureCard
                    badge={<span className="pill">{formatSectionLabel(item.status)}</span>}
                    className="record-surface"
                    eyebrow="Saved Survey Item"
                    key={item.id}
                    meta={<span className="pill">{item.attachments.length} attachment(s)</span>}
                    subtitle={item.item}
                    title={item.area}
                  >
                    <p className="muted-copy">{item.details || "No extra notes recorded yet."}</p>
                    <AttachmentList attachments={item.attachments} />
                    <form
                      className="module-form-grid top-gap"
                      onSubmit={(event) =>
                        handleRecordUpdate(event, {
                          table: "survey_items",
                          recordId: item.id,
                          section: "survey_item",
                          label: "Survey item updated.",
                          buildPayload: (formData) => ({
                            area: String(formData.get("area") ?? "").trim(),
                            item: String(formData.get("item") ?? "").trim(),
                            status: String(formData.get("status") ?? "good") as ChecklistStatus,
                            details: String(formData.get("details") ?? "").trim()
                          }),
                          select: "id, area, item, status, details",
                          update: (project, data, attachments) => ({
                            ...project,
                            surveyItems: project.surveyItems.map((survey) =>
                              survey.id === item.id
                                ? {
                                    id: String(data.id),
                                    area: String(data.area),
                                    item: String(data.item),
                                    status: data.status as ChecklistStatus,
                                    details: String(data.details ?? ""),
                                    attachments: [...survey.attachments, ...attachments]
                                  }
                                : survey
                            )
                          })
                        })
                      }
                    >
                      <label className="field">
                        <span>Area / location</span>
                        <input defaultValue={item.area} name="area" required />
                      </label>
                      <label className="field">
                        <span>Checklist item</span>
                        <input defaultValue={item.item} name="item" required />
                      </label>
                      <label className="field">
                        <span>Status</span>
                        <select defaultValue={item.status} name="status">
                          <option value="good">Good</option>
                          <option value="minor_issue">Minor issue</option>
                          <option value="major_issue">Major issue</option>
                          <option value="missing">Missing</option>
                        </select>
                      </label>
                      <label className="field field-full">
                        <span>Recorded details</span>
                        <textarea defaultValue={item.details} name="details" rows={3} />
                      </label>
                      <label className="field field-full">
                        <span>Add more attachments</span>
                        <input accept={getUploadAcceptForMode("image-only")} multiple name="attachments" type="file" />
                      </label>
                      <div className="record-actions field-full">
                        <button className="primary-button" disabled={isPending || !isConfigured} type="submit">
                          Save changes
                        </button>
                        <button
                          className="ghost-button"
                          onClick={() =>
                            handleDelete({
                              table: "survey_items",
                              recordId: item.id,
                              section: "survey_item",
                              remove: (project) => ({
                                ...project,
                                surveyItems: project.surveyItems.filter((survey) => survey.id !== item.id)
                              })
                            })
                          }
                          type="button"
                        >
                          Delete
                        </button>
                      </div>
                    </form>
                  </DisclosureCard>
                ))
              ) : (
                <article className="record-surface">
                  <p className="muted-copy">No survey items recorded yet.</p>
                </article>
              )}
            </div>
            </section>
          ) : null}

          {moduleAccess.daily_reports && activePanel?.key === "daily_reports" ? (
            <section className="content-card dashboard-module-card" id="daily">
            <div className="section-header">
              <div>
                <p className="eyebrow">Contractor Records</p>
                <h3>Daily Reports</h3>
              </div>
            </div>
            <DisclosureCard
              className="panel-surface top-gap"
              eyebrow="Create"
              meta={<span className="pill">{activeProject.dailyReports.length} saved</span>}
              title="New daily report"
            >
              <form
                className="module-form-grid"
                onSubmit={(event) =>
                  handleRecordCreate(event, {
                    table: "daily_reports",
                    section: "daily_report",
                    buildPayload: (formData) => ({
                      report_date: String(formData.get("reportDate") ?? ""),
                      location: String(formData.get("location") ?? "").trim(),
                      work_done: String(formData.get("workDone") ?? "").trim(),
                      manpower_by_trade: String(formData.get("manpowerByTrade") ?? "").trim()
                    }),
                    select: "id, report_date, location, work_done, manpower_by_trade",
                    append: (project, data, attachments) => ({
                      ...project,
                      dailyReports: [
                        {
                          id: String(data.id),
                          reportDate: String(data.report_date),
                          location: String(data.location),
                          workDone: String(data.work_done ?? ""),
                          manpowerByTrade: String(data.manpower_by_trade ?? ""),
                          attachments
                        },
                        ...project.dailyReports
                      ]
                    })
                  })
                }
              >
                <label className="field">
                  <span>Date</span>
                  <input name="reportDate" type="date" required />
                </label>
                <label className="field">
                  <span>Project / location</span>
                  <input name="location" placeholder="Main site" required />
                </label>
                <label className="field field-full">
                  <span>Work completed today</span>
                  <textarea name="workDone" rows={3} />
                </label>
                <label className="field field-full">
                  <span>Manpower by trade</span>
                  <textarea name="manpowerByTrade" rows={3} placeholder="Carpentry: 4, Electrical: 2" />
                </label>
                <label className="field field-full">
                  <span>Photo attachments</span>
                  <input accept={getUploadAcceptForMode("image-only")} multiple name="attachments" type="file" />
                  <FreePilotUploadHint mode="image-only" />
                </label>
                <button className="primary-button" disabled={isPending || !isConfigured || !activeProject.overview.id} type="submit">
                  Add daily report
                </button>
              </form>
            </DisclosureCard>
            <div className="list-grid top-gap">
              {activeProject.dailyReports.length ? (
                activeProject.dailyReports.map((report) => (
                  <DisclosureCard
                    className="record-surface"
                    eyebrow="Saved Report"
                    key={report.id}
                    meta={<span className="pill">{report.attachments.length} attachment(s)</span>}
                    subtitle={report.location}
                    title={formatDate(report.reportDate)}
                  >
                    <p>{report.workDone || "No work details recorded yet."}</p>
                    <p className="muted-copy">{report.manpowerByTrade || "No manpower breakdown recorded yet."}</p>
                    <AttachmentList attachments={report.attachments} />
                    <form
                      className="module-form-grid top-gap"
                      onSubmit={(event) =>
                        handleRecordUpdate(event, {
                          table: "daily_reports",
                          recordId: report.id,
                          section: "daily_report",
                          label: "Daily report updated.",
                          buildPayload: (formData) => ({
                            report_date: String(formData.get("reportDate") ?? ""),
                            location: String(formData.get("location") ?? "").trim(),
                            work_done: String(formData.get("workDone") ?? "").trim(),
                            manpower_by_trade: String(formData.get("manpowerByTrade") ?? "").trim()
                          }),
                          select: "id, report_date, location, work_done, manpower_by_trade",
                          update: (project, data, attachments) => ({
                            ...project,
                            dailyReports: project.dailyReports.map((item) =>
                              item.id === report.id
                                ? {
                                    id: String(data.id),
                                    reportDate: String(data.report_date),
                                    location: String(data.location),
                                    workDone: String(data.work_done ?? ""),
                                    manpowerByTrade: String(data.manpower_by_trade ?? ""),
                                    attachments: [...item.attachments, ...attachments]
                                  }
                                : item
                            )
                          })
                        })
                      }
                    >
                      <label className="field">
                        <span>Date</span>
                        <input defaultValue={report.reportDate} name="reportDate" required type="date" />
                      </label>
                      <label className="field">
                        <span>Project / location</span>
                        <input defaultValue={report.location} name="location" required />
                      </label>
                      <label className="field field-full">
                        <span>Work completed today</span>
                        <textarea defaultValue={report.workDone} name="workDone" rows={3} />
                      </label>
                      <label className="field field-full">
                        <span>Manpower by trade</span>
                        <textarea defaultValue={report.manpowerByTrade} name="manpowerByTrade" rows={3} />
                      </label>
                      <label className="field field-full">
                        <span>Add more attachments</span>
                        <input accept={getUploadAcceptForMode("image-only")} multiple name="attachments" type="file" />
                      </label>
                      <div className="record-actions field-full">
                        <button className="primary-button" disabled={isPending || !isConfigured} type="submit">
                          Save changes
                        </button>
                        <button
                          className="ghost-button"
                          onClick={() =>
                            handleDelete({
                              table: "daily_reports",
                              recordId: report.id,
                              section: "daily_report",
                              remove: (project) => ({
                                ...project,
                                dailyReports: project.dailyReports.filter((item) => item.id !== report.id)
                              })
                            })
                          }
                          type="button"
                        >
                          Delete
                        </button>
                      </div>
                    </form>
                  </DisclosureCard>
                ))
              ) : (
                <article className="record-surface">
                  <p className="muted-copy">No daily reports recorded yet.</p>
                </article>
              )}
            </div>
            </section>
          ) : null}

          {moduleAccess.weekly_reports && activePanel?.key === "weekly_reports" ? (
            <section className="content-card dashboard-module-card" id="weekly">
            <div className="section-header">
              <div>
                <p className="eyebrow">Programme Summary</p>
                <h3>Weekly Reports</h3>
              </div>
            </div>
            <DisclosureCard
              className="panel-surface top-gap"
              eyebrow="Create"
              meta={<span className="pill">{activeProject.weeklyReports.length} saved</span>}
              title="New weekly report"
            >
              <form
                className="module-form-grid"
                onSubmit={(event) =>
                  handleRecordCreate(event, {
                    table: "weekly_reports",
                    section: "weekly_report",
                    buildPayload: (formData) => ({
                      week_ending: String(formData.get("weekEnding") ?? ""),
                      summary: String(formData.get("summary") ?? "").trim()
                    }),
                    select: "id, week_ending, summary",
                    append: (project, data, attachments) => ({
                      ...project,
                      weeklyReports: [
                        {
                          id: String(data.id),
                          weekEnding: String(data.week_ending),
                          summary: String(data.summary ?? ""),
                          attachments
                        },
                        ...project.weeklyReports
                      ]
                    })
                  })
                }
              >
                <label className="field">
                  <span>Week ending</span>
                  <input name="weekEnding" type="date" required />
                </label>
                <label className="field field-full">
                  <span>Summary</span>
                  <textarea name="summary" rows={3} />
                </label>
                <label className="field field-full">
                  <span>Attachments</span>
                  <input accept={getUploadAcceptForMode("mixed")} multiple name="attachments" type="file" />
                  <FreePilotUploadHint mode="mixed" />
                </label>
                <button className="primary-button" disabled={isPending || !isConfigured || !activeProject.overview.id} type="submit">
                  Add weekly report
                </button>
              </form>
            </DisclosureCard>
            <div className="list-grid top-gap">
              {activeProject.weeklyReports.length ? (
                activeProject.weeklyReports.map((report) => (
                  <DisclosureCard
                    className="record-surface"
                    eyebrow="Saved Report"
                    key={report.id}
                    meta={<span className="pill">{report.attachments.length} attachment(s)</span>}
                    subtitle="Weekly summary"
                    title={`Week ending ${formatDate(report.weekEnding)}`}
                  >
                    <p>{report.summary || "No summary recorded yet."}</p>
                    <AttachmentList attachments={report.attachments} />
                    <form
                      className="module-form-grid top-gap"
                      onSubmit={(event) =>
                        handleRecordUpdate(event, {
                          table: "weekly_reports",
                          recordId: report.id,
                          section: "weekly_report",
                          label: "Weekly report updated.",
                          buildPayload: (formData) => ({
                            week_ending: String(formData.get("weekEnding") ?? ""),
                            summary: String(formData.get("summary") ?? "").trim()
                          }),
                          select: "id, week_ending, summary",
                          update: (project, data, attachments) => ({
                            ...project,
                            weeklyReports: project.weeklyReports.map((item) =>
                              item.id === report.id
                                ? {
                                    id: String(data.id),
                                    weekEnding: String(data.week_ending),
                                    summary: String(data.summary ?? ""),
                                    attachments: [...item.attachments, ...attachments]
                                  }
                                : item
                            )
                          })
                        })
                      }
                    >
                      <label className="field">
                        <span>Week ending</span>
                        <input defaultValue={report.weekEnding} name="weekEnding" required type="date" />
                      </label>
                      <label className="field field-full">
                        <span>Summary</span>
                        <textarea defaultValue={report.summary} name="summary" rows={3} />
                      </label>
                      <label className="field field-full">
                        <span>Add more attachments</span>
                        <input accept={getUploadAcceptForMode("mixed")} multiple name="attachments" type="file" />
                      </label>
                      <div className="record-actions field-full">
                        <button className="primary-button" disabled={isPending || !isConfigured} type="submit">
                          Save changes
                        </button>
                        <button
                          className="ghost-button"
                          onClick={() =>
                            handleDelete({
                              table: "weekly_reports",
                              recordId: report.id,
                              section: "weekly_report",
                              remove: (project) => ({
                                ...project,
                                weeklyReports: project.weeklyReports.filter((item) => item.id !== report.id)
                              })
                            })
                          }
                          type="button"
                        >
                          Delete
                        </button>
                      </div>
                    </form>
                  </DisclosureCard>
                ))
              ) : (
                <article className="record-surface">
                  <p className="muted-copy">No weekly reports recorded yet.</p>
                </article>
              )}
            </div>
            </section>
          ) : null}

          {moduleAccess.financials && activePanel?.key === "financials" ? (
            <section className="content-card dashboard-module-card" id="financials">
            <div className="section-header">
              <div>
                <p className="eyebrow">Commercial Control</p>
                <h3>Financial Register</h3>
              </div>
            </div>
            <div className="stats-grid compact">
              <StatCard label="Total Visible" value={formatCurrency(overallTotal)} />
              <StatCard label="Awaiting Client" value={formatCurrency(awaitingReviewTotal)} />
              <StatCard label="Approved / Paid" value={formatCurrency(approvedTotal)} />
            </div>
            {canCreateFinancialRecords ? (
              <DisclosureCard
                className="panel-surface"
                eyebrow="Create"
                meta={
                  <>
                    <span className="pill">{activeProject.financialRecords.length} saved</span>
                  </>
                }
                title="New financial submission"
              >
                <form
                  className="module-form-grid"
                  onSubmit={(event) =>
                    handleRecordCreate(event, {
                      table: "financial_records",
                      section: "financial_record",
                      buildPayload: (formData) => ({
                        document_type: String(formData.get("documentType") ?? "quotation"),
                        reference_number: String(formData.get("referenceNumber") ?? "").trim(),
                        amount: Number(formData.get("amount") ?? 0),
                        status: "pending" as FinancialStatus,
                        notes: String(formData.get("notes") ?? "").trim(),
                        owner_user_id: viewer?.id ?? "",
                        owner_email: viewer?.email ?? "",
                        owner_role: viewer?.role === "master_admin" ? "master_admin" : currentProjectRole
                      }),
                      select:
                        "id, document_type, reference_number, amount, status, notes, owner_user_id, owner_email, owner_role, submitted_at, reviewed_at, reviewed_by_user_id, reviewed_by_email, review_note",
                      append: (project, data, attachments) => ({
                        ...project,
                        financialRecords: [buildFinancialRecordFromRow(data, attachments), ...project.financialRecords]
                      })
                    })
                  }
                >
                  <label className="field">
                    <span>Document type</span>
                    <select name="documentType">
                      <option value="quotation">Quotation</option>
                      <option value="invoice">Invoice</option>
                      <option value="variation_order">Variation order</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Reference no.</span>
                    <input name="referenceNumber" />
                  </label>
                  <label className="field">
                    <span>Amount</span>
                    <input min="0" name="amount" step="0.01" type="number" />
                  </label>
                  <label className="field field-full">
                    <span>Notes</span>
                    <textarea name="notes" rows={3} placeholder="Scope notes, breakdown remarks, or commercial clarifications..." />
                  </label>
                  <label className="field field-full">
                    <span>Attachments</span>
                    <input accept={getUploadAcceptForMode("mixed")} multiple name="attachments" type="file" />
                    <FreePilotUploadHint mode="mixed" />
                  </label>
                  <button className="primary-button" disabled={isPending || !isConfigured || !activeProject.overview.id} type="submit">
                    Save financial draft
                  </button>
                </form>
              </DisclosureCard>
            ) : (
              <div className="panel-surface top-gap">
                <p className="muted-copy">Review only.</p>
              </div>
            )}
            <div className="list-grid top-gap">
              {activeProject.financialRecords.length ? (
                activeProject.financialRecords.map((record) => (
                  <DisclosureCard
                    badge={<FinancialStatusPill status={record.status} />}
                    className="record-surface"
                    eyebrow="Saved Record"
                    key={record.id}
                    meta={
                      <>
                        <span className="pill">{formatCurrency(record.amount)}</span>
                        <span className="pill">{getRoleLabel(record.ownerRole, record.ownerEmail)}</span>
                        <span className="pill">{record.ownerEmail || "Unknown user"}</span>
                      </>
                    }
                    subtitle={record.referenceNumber || "No reference number"}
                    title={formatSectionLabel(record.documentType)}
                  >
                    {(() => {
                      const viewerId = viewer?.id ?? "";
                      const isOwnSubmission = Boolean(viewerId) && record.ownerUserId === viewerId;
                      const canDeleteSubmission = viewer?.role === "master_admin" || (isOwnSubmission && (record.status === "pending" || record.status === "rejected"));
                      const canSubmitSubmission = isOwnSubmission && (record.status === "pending" || record.status === "rejected");
                      const canApproveSubmission = canReviewVisibleFinancials && record.status === "submitted";
                      const canMarkPaid = canReviewVisibleFinancials && record.status === "approved";
                      const reviewDraft = financialReviewNotes[record.id] ?? "";

                      return (
                        <>
                          <div className="record-actions">
                            {canSubmitSubmission ? (
                              <button
                                className="secondary-button"
                                disabled={isPending || !isConfigured}
                                onClick={() => handleFinancialStatusUpdate(record, "submitted")}
                                type="button"
                              >
                                {record.status === "rejected" ? "Resubmit" : "Submit"}
                              </button>
                            ) : null}
                            {canMarkPaid ? (
                              <button
                                className="ghost-button"
                                disabled={isPending || !isConfigured}
                                onClick={() => handleFinancialStatusUpdate(record, "paid")}
                                type="button"
                              >
                                Mark paid
                              </button>
                            ) : null}
                            {canDeleteSubmission ? (
                              <button
                                className="ghost-button"
                                onClick={() =>
                                  handleDelete({
                                    table: "financial_records",
                                    recordId: record.id,
                                    section: "financial_record",
                                    remove: (project) => ({
                                      ...project,
                                      financialRecords: project.financialRecords.filter((item) => item.id !== record.id)
                                    })
                                  })
                                }
                                type="button"
                              >
                                Delete
                              </button>
                            ) : null}
                          </div>
                          <p>{formatCurrency(record.amount)}</p>
                          <p className="muted-copy">{record.notes}</p>
                          <p className="muted-copy">
                            Submitted by {getRoleLabel(record.ownerRole, record.ownerEmail)}{record.ownerEmail ? ` · ${record.ownerEmail}` : ""}
                          </p>
                          <p className="muted-copy">Submitted: {formatDateTime(record.submittedAt)}</p>
                          {record.reviewedAt ? (
                            <p className="muted-copy">
                              Last client decision: {formatDateTime(record.reviewedAt)}
                              {record.reviewedByEmail ? ` · ${record.reviewedByEmail}` : ""}
                            </p>
                          ) : null}
                          {record.reviewNote ? <p className="muted-copy">Review note: {record.reviewNote}</p> : null}
                          <AttachmentList attachments={record.attachments} />
                          {canDeleteSubmission ? (
                            <form
                              className="module-form-grid top-gap"
                              onSubmit={(event) =>
                                handleRecordUpdate(event, {
                                  table: "financial_records",
                                  recordId: record.id,
                                  section: "financial_record",
                                  label: "Financial record updated.",
                                  buildPayload: (formData) => ({
                                    document_type: String(formData.get("documentType") ?? record.documentType),
                                    reference_number: String(formData.get("referenceNumber") ?? "").trim(),
                                    amount: Number(formData.get("amount") ?? 0),
                                    notes: String(formData.get("notes") ?? "").trim()
                                  }),
                                  select:
                                    "id, document_type, reference_number, amount, status, notes, owner_user_id, owner_email, owner_role, submitted_at, reviewed_at, reviewed_by_user_id, reviewed_by_email, review_note",
                                  update: (project, data, attachments) => ({
                                    ...project,
                                    financialRecords: project.financialRecords.map((item) =>
                                      item.id === record.id ? buildFinancialRecordFromRow(data, [...item.attachments, ...attachments]) : item
                                    )
                                  })
                                })
                              }
                            >
                              <label className="field">
                                <span>Document type</span>
                                <select defaultValue={record.documentType} name="documentType">
                                  <option value="quotation">Quotation</option>
                                  <option value="invoice">Invoice</option>
                                  <option value="variation_order">Variation order</option>
                                </select>
                              </label>
                              <label className="field">
                                <span>Reference no.</span>
                                <input defaultValue={record.referenceNumber} name="referenceNumber" />
                              </label>
                              <label className="field">
                                <span>Amount</span>
                                <input defaultValue={record.amount} min="0" name="amount" step="0.01" type="number" />
                              </label>
                              <label className="field field-full">
                                <span>Notes</span>
                                <textarea defaultValue={record.notes} name="notes" rows={3} />
                              </label>
                              <label className="field field-full">
                                <span>Add more attachments</span>
                                <input accept={getUploadAcceptForMode("mixed")} multiple name="attachments" type="file" />
                              </label>
                              <div className="record-actions field-full">
                                <button className="primary-button" disabled={isPending || !isConfigured} type="submit">
                                  Save changes
                                </button>
                                <button
                                  className="ghost-button"
                                  onClick={() =>
                                    handleDelete({
                                      table: "financial_records",
                                      recordId: record.id,
                                      section: "financial_record",
                                      remove: (project) => ({
                                        ...project,
                                        financialRecords: project.financialRecords.filter((item) => item.id !== record.id)
                                      })
                                    })
                                  }
                                  type="button"
                                >
                                  Delete
                                </button>
                              </div>
                            </form>
                          ) : null}
                          {canApproveSubmission ? (
                            <div className="top-gap">
                              <label className="field">
                                <span>Client decision note</span>
                                <textarea
                                  onChange={(event) => setFinancialReviewNote(record.id, event.target.value)}
                                  placeholder="Optional for approval. Required for rejection."
                                  rows={2}
                                  value={reviewDraft}
                                />
                              </label>
                              <div className="record-actions top-gap">
                                <button
                                  className="primary-button"
                                  disabled={isPending || !isConfigured}
                                  onClick={() => handleFinancialStatusUpdate(record, "approved")}
                                  type="button"
                                >
                                  Approve
                                </button>
                                <button
                                  className="ghost-button"
                                  disabled={isPending || !isConfigured}
                                  onClick={() => handleFinancialStatusUpdate(record, "rejected")}
                                  type="button"
                                >
                                  Reject
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </>
                      );
                    })()}
                  </DisclosureCard>
                ))
              ) : (
                <article className="record-surface">
                  <p className="muted-copy">No financial records recorded yet.</p>
                </article>
              )}
            </div>
            </section>
          ) : null}

          {moduleAccess.completion && activePanel?.key === "completion" ? (
            <section className="content-card dashboard-module-card" id="completion">
            <div className="section-header">
              <div>
                <p className="eyebrow">Close-Out</p>
                <h3>Completion Checklist</h3>
              </div>
            </div>
            <DisclosureCard
              className="panel-surface top-gap"
              eyebrow="Create"
              meta={
                <>
                  <span className="pill">{activeProject.completionChecklist.length} saved</span>
                  <span className="pill">{completionDraftItems.length} draft item(s)</span>
                </>
              }
              title="New completion checklist batch"
            >
              <form className="module-form-grid" onSubmit={handleCompletionBatchCreate}>
                <label className="field field-full">
                  <span>Checklist items</span>
                  <div className="draft-items-stack">
                    {completionDraftItems.map((draft, index) => (
                      <article className="record-surface draft-item-card" key={draft.id}>
                        <div className="record-header">
                          <div>
                            <strong>Item {index + 1}</strong>
                            <p>{draft.item || "Checklist item not set yet"}</p>
                          </div>
                          <button
                            className="ghost-button"
                            disabled={isPending}
                            onClick={() => removeCompletionDraftItem(draft.id)}
                            type="button"
                          >
                            Delete item
                          </button>
                        </div>
                        <div className="draft-item-grid">
                          <label className="field">
                            <span>Checklist item</span>
                            <input
                              onChange={(event) => updateCompletionDraftItem(draft.id, "item", event.currentTarget.value)}
                              value={draft.item}
                            />
                          </label>
                          <label className="field">
                            <span>Status</span>
                            <select
                              onChange={(event) => updateCompletionDraftItem(draft.id, "status", event.currentTarget.value)}
                              value={draft.status}
                            >
                              <option value="open">Open</option>
                              <option value="ready">Ready</option>
                              <option value="completed">Completed</option>
                            </select>
                          </label>
                          <label className="field field-full">
                            <span>Details</span>
                            <input
                              onChange={(event) => updateCompletionDraftItem(draft.id, "details", event.currentTarget.value)}
                              value={draft.details}
                            />
                          </label>
                        </div>
                      </article>
                    ))}
                  </div>
                </label>
                <div className="record-actions">
                  <button className="ghost-button" disabled={isPending} onClick={addCompletionDraftItem} type="button">
                    Add another item
                  </button>
                  <span className="muted-copy">{completionDraftItems.length} checklist item(s) will be added together.</span>
                </div>
                <button className="secondary-button" disabled={isPending || !isConfigured || !activeProject.overview.id} type="submit">
                  Add checklist batch
                </button>
              </form>
            </DisclosureCard>
            <div className="list-grid top-gap">
              {activeProject.completionChecklist.length ? (
                activeProject.completionChecklist.map((item) => (
                  <DisclosureCard
                    badge={<CompletionStatusPill status={item.status} />}
                    className="record-surface"
                    eyebrow="Saved Item"
                    key={item.id}
                    subtitle={item.details || "No extra notes recorded yet."}
                    title={item.item}
                  >
                    <form
                      className="module-form-grid"
                      onSubmit={(event) =>
                        handleRecordUpdate(event, {
                          table: "completion_checklist_items",
                          recordId: item.id,
                          label: "Completion item updated.",
                          buildPayload: (formData) => ({
                            item: String(formData.get("item") ?? "").trim(),
                            status: String(formData.get("status") ?? "open") as CompletionStatus,
                            details: String(formData.get("details") ?? "").trim()
                          }),
                          select: "id, item, status, details",
                          update: (project, data) => ({
                            ...project,
                            completionChecklist: project.completionChecklist.map((entry) =>
                              entry.id === item.id
                                ? {
                                    id: String(data.id),
                                    item: String(data.item),
                                    status: data.status as CompletionStatus,
                                    details: String(data.details ?? "")
                                  }
                                : entry
                            )
                          })
                        })
                      }
                    >
                      <label className="field">
                        <span>Checklist item</span>
                        <input defaultValue={item.item} name="item" required />
                      </label>
                      <label className="field">
                        <span>Status</span>
                        <select defaultValue={item.status} name="status">
                          <option value="open">Open</option>
                          <option value="ready">Ready</option>
                          <option value="completed">Completed</option>
                        </select>
                      </label>
                      <label className="field field-full">
                        <span>Details</span>
                        <textarea defaultValue={item.details} name="details" rows={3} />
                      </label>
                      <div className="record-actions field-full">
                        <button className="primary-button" disabled={isPending || !isConfigured} type="submit">
                          Save changes
                        </button>
                        <button
                          className="ghost-button"
                          onClick={() =>
                            handleDelete({
                              table: "completion_checklist_items",
                              recordId: item.id,
                              remove: (project) => ({
                                ...project,
                                completionChecklist: project.completionChecklist.filter((entry) => entry.id !== item.id)
                              })
                            })
                          }
                          type="button"
                        >
                          Delete
                        </button>
                      </div>
                    </form>
                  </DisclosureCard>
                ))
              ) : (
                <article className="record-surface">
                  <p className="muted-copy">No completion checklist items recorded yet.</p>
                </article>
              )}
            </div>
            </section>
          ) : null}

          {moduleAccess.defects && activePanel?.key === "defects" ? (
            <section className="content-card dashboard-module-card" id="defects">
            <div className="section-header">
              <div>
                <p className="eyebrow">Snagging</p>
                <h3>Defect Register</h3>
              </div>
            </div>
            <DisclosureCard
              className="panel-surface top-gap"
              eyebrow="Tools"
              meta={
                <>
                  <span className="pill">{activeProject.defectZones.length} saved zones</span>
                  <span className="pill">Excel import available</span>
                </>
              }
              title="Import and zone tools"
            >
              <div className="admin-assignment-footer">
                <p className="muted-copy">Template: Zone, Defect Title, Status, Details, Photo.</p>
                <button className="ghost-button" onClick={handleDefectTemplateDownload} type="button">
                  Download Excel template
                </button>
              </div>
              <form className="module-form-grid top-gap" onSubmit={handleDefectImport}>
                <label className="field field-full">
                  <span>Import defect register from Excel</span>
                  <input accept={FREE_PILOT_EXCEL_IMPORT_ACCEPT} name="defectImport" type="file" />
                </label>
                <button className="primary-button" disabled={isPending || !isConfigured || !activeProject.overview.id} type="submit">
                  Import defect list
                </button>
              </form>
              <form className="inline-create-form top-gap" onSubmit={handleDefectZoneCreate}>
                <label className="field">
                  <span>Saved zone</span>
                  <input name="zoneName" placeholder="Pantry / Front-of-house / Unit A" required />
                </label>
                <div className="field field-full">
                  <span>Zone library</span>
                  <div className="attachment-list">
                    {activeProject.defectZones.length ? (
                      activeProject.defectZones.map((zone) => (
                        <span className="pill" key={zone.id}>
                          {zone.name}
                        </span>
                      ))
                    ) : (
                      <span className="pill">No saved zones yet</span>
                    )}
                  </div>
                </div>
                <button className="secondary-button" disabled={isPending || !isConfigured || !activeProject.overview.id} type="submit">
                  Save zone
                </button>
              </form>
              <div className="attachment-list top-gap">
                {activeProject.defectZones.map((zone) => (
                  <button
                    className="ghost-button"
                    key={`delete-${zone.id}`}
                    onClick={() =>
                      handleDelete({
                        table: "defect_zones",
                        recordId: zone.id,
                        remove: (project) => ({
                          ...project,
                          defectZones: project.defectZones.filter((item) => item.id !== zone.id)
                        })
                      })
                    }
                    type="button"
                  >
                    Remove {zone.name}
                  </button>
                ))}
              </div>
            </DisclosureCard>
            <DisclosureCard
              className="panel-surface top-gap"
              eyebrow="Create"
              meta={
                <>
                  <span className="pill">{activeProject.defects.length} saved</span>
                  <span className="pill">{defectDraftItems.length} draft item(s)</span>
                </>
              }
              title="New defect batch"
            >
              <form className="module-form-grid" onSubmit={handleDefectBatchCreate}>
                <label className="field field-full">
                  <span>Defect items</span>
                  <div className="draft-items-stack">
                    {defectDraftItems.map((draft, index) => (
                      <article className="record-surface draft-item-card" key={draft.id}>
                        <div className="record-header">
                          <div>
                            <strong>Defect {index + 1}</strong>
                            <p>{draft.title || "Defect title not set yet"}</p>
                          </div>
                          <button
                            className="ghost-button"
                            disabled={isPending}
                            onClick={() => removeDefectDraftItem(draft.id)}
                            type="button"
                          >
                            Delete item
                          </button>
                        </div>
                        <div className="draft-item-grid">
                          <label className="field">
                            <span>Zone</span>
                            <input
                              list={`defect-zones-${activeProject.overview.id || "default"}`}
                              onChange={(event) => updateDefectDraftItem(draft.id, "zone", event.currentTarget.value)}
                              placeholder="Select or type a zone"
                              value={draft.zone}
                            />
                          </label>
                          <label className="field">
                            <span>Defect title</span>
                            <input
                              onChange={(event) => updateDefectDraftItem(draft.id, "title", event.currentTarget.value)}
                              value={draft.title}
                            />
                          </label>
                          <label className="field">
                            <span>Status</span>
                            <select
                              onChange={(event) => updateDefectDraftItem(draft.id, "status", event.currentTarget.value)}
                              value={draft.status}
                            >
                              <option value="open">Open</option>
                              <option value="in_progress">In progress</option>
                              <option value="closed">Closed</option>
                            </select>
                          </label>
                          <label className="field field-full">
                            <span>Details</span>
                            <textarea
                              onChange={(event) => updateDefectDraftItem(draft.id, "details", event.currentTarget.value)}
                              rows={3}
                              value={draft.details}
                            />
                          </label>
                          <label className="field field-full">
                            <span>Photo attachments</span>
                            <input
                              accept={getUploadAcceptForMode("image-only")}
                              multiple
                              onChange={(event) =>
                                updateDefectDraftAttachments(draft.id, Array.from(event.currentTarget.files ?? []))
                              }
                              type="file"
                            />
                            <FreePilotUploadHint mode="image-only" />
                          </label>
                          <div className="field field-full">
                            <span>Selected attachments</span>
                            <div className="attachment-list">
                              {draft.attachments.length ? (
                                draft.attachments.map((file) => (
                                  <span className="pill" key={`${draft.id}-${file.name}-${file.size}`}>
                                    {file.name}
                                  </span>
                                ))
                              ) : (
                                <span className="pill">No attachments selected</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                  <datalist id={`defect-zones-${activeProject.overview.id || "default"}`}>
                    {defectZoneNames.map((zoneName) => (
                      <option key={zoneName} value={zoneName} />
                    ))}
                  </datalist>
                </label>
                <div className="record-actions">
                  <button className="ghost-button" disabled={isPending} onClick={addDefectDraftItem} type="button">
                    Add another item
                  </button>
                  <span className="muted-copy">{defectDraftItems.length} defect item(s) will be added together.</span>
                </div>
                <button className="primary-button" disabled={isPending || !isConfigured || !activeProject.overview.id} type="submit">
                  Add defect batch
                </button>
              </form>
            </DisclosureCard>
            <div className="list-grid top-gap">
              {activeProject.defects.length ? (
                activeProject.defects.map((defect) => (
                  <DisclosureCard
                    badge={<DefectStatusPill status={defect.status} />}
                    className="record-surface"
                    eyebrow="Saved Defect"
                    key={defect.id}
                    meta={
                      <>
                        {defect.zone ? <span className="pill">{defect.zone}</span> : null}
                        <span className="pill">{defect.attachments.length} attachment(s)</span>
                      </>
                    }
                    subtitle={defect.details || "No extra notes recorded yet."}
                    title={defect.title}
                  >
                    <AttachmentList attachments={defect.attachments} />
                    <form
                      className="module-form-grid top-gap"
                      onSubmit={(event) =>
                        handleRecordUpdate(event, {
                          table: "defects",
                          recordId: defect.id,
                          section: "defect",
                          label: "Defect updated.",
                          buildPayload: async (formData) => {
                            const zone = normalizeZoneName(String(formData.get("zone") ?? ""));
                            if (!zone) {
                              throw new Error("A defect zone is required.");
                            }

                            await syncDefectZones(activeProject.overview.id, [zone]);

                            return {
                              zone,
                              title: String(formData.get("title") ?? "").trim(),
                              status: String(formData.get("status") ?? "open") as DefectStatus,
                              details: String(formData.get("details") ?? "").trim()
                            };
                          },
                          select: "id, zone, title, status, details",
                          update: (project, data, attachments) => ({
                            ...project,
                            defects: project.defects.map((item) =>
                              item.id === defect.id
                                ? {
                                    id: String(data.id),
                                    zone: String(data.zone ?? ""),
                                    title: String(data.title ?? ""),
                                    status: data.status as DefectStatus,
                                    details: String(data.details ?? ""),
                                    attachments: [...item.attachments, ...attachments]
                                  }
                                : item
                            )
                          })
                        })
                      }
                    >
                      <label className="field">
                        <span>Zone</span>
                        <input
                          defaultValue={defect.zone}
                          list={`defect-zones-${activeProject.overview.id || "default"}`}
                          name="zone"
                          placeholder="Select or type a zone"
                          required
                        />
                      </label>
                      <label className="field">
                        <span>Defect title</span>
                        <input defaultValue={defect.title} name="title" required />
                      </label>
                      <label className="field">
                        <span>Status</span>
                        <select defaultValue={defect.status} name="status">
                          <option value="open">Open</option>
                          <option value="in_progress">In progress</option>
                          <option value="closed">Closed</option>
                        </select>
                      </label>
                      <label className="field field-full">
                        <span>Details</span>
                        <textarea defaultValue={defect.details} name="details" rows={3} />
                      </label>
                      <label className="field field-full">
                        <span>Add more attachments</span>
                        <input accept={getUploadAcceptForMode("image-only")} multiple name="attachments" type="file" />
                      </label>
                      <div className="record-actions field-full">
                        <button className="primary-button" disabled={isPending || !isConfigured} type="submit">
                          Save changes
                        </button>
                        <button
                          className="ghost-button"
                          onClick={() =>
                            handleDelete({
                              table: "defects",
                              recordId: defect.id,
                              section: "defect",
                              remove: (project) => ({
                                ...project,
                                defects: project.defects.filter((item) => item.id !== defect.id)
                              })
                            })
                          }
                          type="button"
                        >
                          Delete
                        </button>
                      </div>
                    </form>
                  </DisclosureCard>
                ))
              ) : (
                <article className="record-surface">
                  <p className="muted-copy">No defects recorded yet.</p>
                </article>
              )}
            </div>
            </section>
          ) : null}

          {viewer?.role === "master_admin" && activeProject.overview.id && activePanel?.key === "access_control" ? (
            <section className="content-card dashboard-module-card" id="access-control">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Access Control</p>
                  <h3>Assign project roles and module access</h3>
                </div>
              </div>
              <form className="membership-form-grid" onSubmit={handleMembershipSave}>
                <label className="field field-full">
                  <span>User email</span>
                  <input name="email" placeholder="contractor@example.com" required type="email" />
                </label>
                <label className="field">
                  <span>Role</span>
                  <select name="role" defaultValue="contractor">
                    <option value="client">Client</option>
                    <option value="contractor">Main Contractor</option>
                    <option value="subcontractor">Sub Contractor</option>
                    <option value="consultant">Consultant</option>
                  </select>
                </label>
                <div className="permission-box field-full">
                  <span>Module access</span>
                  <div className="permission-grid">
                    {MODULE_KEYS.map((moduleKey) => (
                      <label className="permission-item" key={moduleKey}>
                        <input defaultChecked={moduleKey === "overview"} name={moduleKey} type="checkbox" />
                        <span>{formatSectionLabel(moduleKey)}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <button className="primary-button" disabled={isPending || !isConfigured} type="submit">
                  Save access
                </button>
              </form>

              <div className="list-grid top-gap">
                {activeProject.members.length ? (
                  activeProject.members.map((member) => (
                    <article className="record-surface" key={member.id}>
                      <div className="record-header">
                        <div>
                          <strong>{member.email}</strong>
                          <p>{getRoleLabel(member.role, member.email)}</p>
                        </div>
                        <button className="ghost-button" onClick={() => handleMembershipDelete(member.id, member.userId)} type="button">
                          Remove access
                        </button>
                      </div>
                      <div className="attachment-list">
                        {MODULE_KEYS.filter((moduleKey) => member.modules[moduleKey]).map((moduleKey) => (
                          <span className="pill" key={moduleKey}>
                            {formatSectionLabel(moduleKey)}
                          </span>
                        ))}
                      </div>
                    </article>
                  ))
                ) : (
                  <article className="record-surface">
                    <p className="muted-copy">No additional users assigned to this project yet.</p>
                  </article>
                )}
              </div>
            </section>
          ) : null}
        </main>
      </div> : null}
    </>
  );
}
