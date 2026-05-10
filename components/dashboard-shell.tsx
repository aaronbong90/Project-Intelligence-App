"use client";

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import type { FormEvent, ReactNode } from "react";
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
import {
  getAiObservationFollowUpSuggestion,
  getDefectFollowUpSuggestion,
  normalizeAiComparisonValue,
  normalizeAiProgressStatus,
  SMART_CAMERA_MODES,
  type AiObservationConversionDraft,
  type AiSiteAnalysisResult
} from "@/lib/ai/site-intelligence";
import {
  attachAiSiteObservationImage,
  linkAiSiteObservationToRecord,
  updateAiSiteObservationStatus
} from "@/lib/services/ai-site-observations";
import { useAiSiteIntelligenceState, type AiDailyReportDraft } from "@/hooks/use-ai-site-intelligence";
import { SmartCameraModeSelector } from "@/components/ai-site-intelligence/smart-camera-mode-selector";
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
  DrawingType,
  FinancialStatus,
  ModuleKey,
  ModulePermissions,
  ProjectSetupPhase,
  ProjectSetupPriority,
  ProjectSetupStatus,
  ProjectMember,
  ProjectBundle,
  ProjectNotification,
  RecordSectionType,
  RectificationAssistant,
  UserRole
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

const OVERVIEW_MANAGED_TABLES = new Set(["project_contractors", "project_consultants", "milestones"]);

const CONSULTANT_DOCUMENT_STATUS_LABELS: Partial<Record<ApprovalStatus, string>> = {
  approved: "Accepted",
  rejected: "Returned"
};

const DRAWING_UPLOAD_ACCEPT = "image/*,.pdf";

const DRAWING_TYPE_OPTIONS: Array<{ value: DrawingType; label: string }> = [
  { value: "design_drawing", label: "Design Drawing" },
  { value: "tender_drawing", label: "Tender Drawing" },
  { value: "shop_drawing", label: "Shop Drawing" },
  { value: "as_built_drawing", label: "As Built Drawing" }
];

type ProjectSetupPanelKey =
  | "project_setup_site_survey"
  | "project_setup_due_diligence"
  | "project_setup_design"
  | "project_setup_tender"
  | "project_setup_award";

type ProjectSetupPhaseEntry = {
  key: ProjectSetupPanelKey;
  phase: ProjectSetupPhase;
  label: string;
  href: string;
  focus: string;
  categories: string[];
  guide: string[];
  deliverables: string[];
};

const PROJECT_SETUP_PHASES: ProjectSetupPhaseEntry[] = [
  {
    key: "project_setup_site_survey",
    phase: "site_survey",
    label: "Site Survey",
    href: "#site-survey",
    focus: "Capture existing site facts, base drawings, photos, restrictions, and survey gaps before design starts.",
    categories: ["Existing drawings", "Measured survey", "Site photos", "Landlord rules", "Utility constraints"],
    guide: ["Confirm received drawings and photos.", "Record missing site information.", "Flag landlord or building restrictions early."],
    deliverables: ["Site information register", "Photo and video notes", "Missing-information tracker"]
  },
  {
    key: "project_setup_due_diligence",
    phase: "due_diligence",
    label: "Due Diligence",
    href: "#due-diligence",
    focus: "Screen compliance, authority, landlord, service capacity, and permit risks before committing scope or budget.",
    categories: ["Compliance", "Authority", "Landlord", "Services capacity", "Risk item"],
    guide: ["Check authority pathway.", "Review base-building service limits.", "Capture unresolved compliance assumptions."],
    deliverables: ["Due-diligence matrix", "Authority tracker", "Risk and assumptions register"]
  },
  {
    key: "project_setup_design",
    phase: "design",
    label: "Design",
    href: "#design",
    focus: "Move from brief to test-fit, design options, consultant issue, and drawing coordination.",
    categories: ["Brief", "Test fit", "Design option", "Consultant issue", "Design risk"],
    guide: ["Confirm business brief and occupancy needs.", "Track test-fit options and constraints.", "Capture consultant comments before tender."],
    deliverables: ["Project brief", "Preliminary design checklist", "Design issue register"]
  },
  {
    key: "project_setup_tender",
    phase: "tender",
    label: "Tender",
    href: "#tender",
    focus: "Build the tender pack, track bidders, compare scope gaps, and prepare clarification actions.",
    categories: ["RFP package", "BQ", "Scope gap", "Clarification", "Bid comparison"],
    guide: ["Check drawing and scope completeness.", "Log dangerous exclusions.", "Normalize bidders before recommendation."],
    deliverables: ["Tender register", "Clarification tracker", "Bid comparison table"]
  },
  {
    key: "project_setup_award",
    phase: "award",
    label: "Award",
    href: "#award",
    focus: "Close negotiation, issue recommendation, prepare LOA package, and capture handover-to-construction actions.",
    categories: ["Recommendation", "Negotiation", "LOA", "Contract", "Handover action"],
    guide: ["Confirm final scope and exclusions.", "Record award recommendation basis.", "Prepare construction handover actions."],
    deliverables: ["Award recommendation", "LOA tracker", "Construction handover checklist"]
  }
];

const PROJECT_SETUP_STATUS_OPTIONS: Array<{ value: ProjectSetupStatus; label: string }> = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "ready", label: "Ready" },
  { value: "closed", label: "Closed" }
];

const PROJECT_SETUP_PRIORITY_OPTIONS: Array<{ value: ProjectSetupPriority; label: string }> = [
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" }
];

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

type AiReportType = "weekly_summary" | "defects_report" | "progress_report";

const AI_REPORT_OPTIONS: Array<{ value: AiReportType; label: string }> = [
  { value: "weekly_summary", label: "Weekly summary" },
  { value: "defects_report", label: "Defects report" },
  { value: "progress_report", label: "Progress report" }
];

type AiInsightGroup = {
  key: string;
  label: string;
  count: number;
  aiObservationCount: number;
  defectCount: number;
  recurringCount: number;
  openDefectCount: number;
  examples: string[];
};

type RiskLevel = "low" | "medium" | "high";

type RiskScore = {
  key: string;
  label: string;
  riskScore: number;
  riskLevel: RiskLevel;
  riskSummary: string;
  recurringIssuesCount: number;
  openDefects: number;
  worseningProgressCount: number;
  delayedProgressCount: number;
};

type RiskSignalInput = {
  key?: string;
  label: string;
  recurringIssuesCount: number;
  openDefects: number;
  worseningProgressCount: number;
  delayedProgressCount: number;
};

type DrawingHeatmapLink = ProjectBundle["drawingLinks"][number];
type DrawingHeatmapObservation = ProjectBundle["aiSiteObservations"][number];
type DrawingHeatmapDefect = ProjectBundle["defects"][number];
type DrawingHeatmapTone = "defect" | "recurring" | "improved" | "delayed" | "worsened" | "unchanged" | "unknown";

function createDraftId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getDrawingPointKey(link: DrawingHeatmapLink) {
  if (link.xCoordinate === null || link.yCoordinate === null) {
    return "unmarked";
  }

  return `${Math.round(link.xCoordinate * 100)}:${Math.round(link.yCoordinate * 100)}`;
}

function getDrawingHeatmapTone({
  defect,
  defectCount,
  observation
}: {
  defect?: DrawingHeatmapDefect;
  defectCount: number;
  observation?: DrawingHeatmapObservation;
}): DrawingHeatmapTone {
  if (defectCount > 0 || defect) {
    return "defect";
  }

  if (observation?.isRecurringIssue) {
    return "recurring";
  }

  if (observation?.progressStatus === "improved") {
    return "improved";
  }

  if (observation?.progressStatus === "delayed") {
    return "delayed";
  }

  if (observation?.progressStatus === "worsened") {
    return "worsened";
  }

  if (observation?.progressStatus === "unchanged") {
    return "unchanged";
  }

  return "unknown";
}

function getDrawingHeatmapLabel({
  defect,
  defectCount,
  observation
}: {
  defect?: DrawingHeatmapDefect;
  defectCount: number;
  observation?: DrawingHeatmapObservation;
}) {
  if (defectCount > 1) {
    return String(defectCount);
  }

  if (defect) {
    return "D";
  }

  if (observation?.isRecurringIssue) {
    return "R";
  }

  if (observation?.progressStatus === "improved") {
    return "I";
  }

  if (observation?.progressStatus === "delayed") {
    return "L";
  }

  if (observation?.progressStatus === "worsened") {
    return "W";
  }

  if (observation?.progressStatus === "unchanged") {
    return "U";
  }

  return "A";
}

function normalizeAssistantLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function assistantLinesToText(value: string[]) {
  return value.join("\n");
}

function inferAssistantTrade(input: { trade?: string; text: string }) {
  const trade = input.trade?.trim();
  if (trade) return trade;

  const text = normalizeAiComparisonValue(input.text);
  if (text.includes("paint") || text.includes("finishing") || text.includes("plaster")) return "Painting / Architectural";
  if (text.includes("leak") || text.includes("pipe") || text.includes("water") || text.includes("plumbing")) return "Plumbing / Waterproofing";
  if (text.includes("power") || text.includes("light") || text.includes("cable") || text.includes("electrical")) return "Electrical";
  if (text.includes("fire") || text.includes("sprinkler")) return "Fire Protection";
  return "Main contractor / relevant trade";
}

function buildRectificationAssistantDraft(input: {
  location?: string;
  trade?: string;
  title?: string;
  detectedType?: string;
  summary?: string;
  details?: string;
}): RectificationAssistant {
  const text = normalizeAiComparisonValue(`${input.detectedType ?? ""} ${input.title ?? ""} ${input.summary ?? ""} ${input.details ?? ""}`);
  const responsibleTrade = inferAssistantTrade({ trade: input.trade, text });

  if (text.includes("leak") || text.includes("water") || text.includes("moisture") || text.includes("stain")) {
    return {
      rootCause: "Likely water ingress, pipework leak, sealant failure, or incomplete waterproofing. Confirm source before covering finishes.",
      responsibleTrade,
      rectificationSteps: [
        "Isolate and inspect the affected area before starting repair.",
        "Trace the moisture source through nearby pipework, joints, penetrations, and waterproofing edges.",
        "Repair the confirmed source, then dry and clean the affected substrate.",
        "Reinstate finishes only after the area remains dry after inspection."
      ],
      closureChecklist: [
        "Leak source identified and photographed.",
        "Repair completed by responsible trade.",
        "Area dry after re-check.",
        "Final finish inspected and accepted."
      ]
    };
  }

  if (text.includes("crack") || text.includes("gap") || text.includes("joint")) {
    return {
      rootCause: "Likely substrate movement, poor joint treatment, shrinkage, or incomplete backing preparation.",
      responsibleTrade,
      rectificationSteps: [
        "Open and inspect the crack or gap to confirm whether movement is active.",
        "Prepare the substrate and remove loose material.",
        "Apply suitable backing, filler, sealant, or joint treatment based on the surface condition.",
        "Sand, finish, and protect the repaired area before final inspection."
      ],
      closureChecklist: [
        "Cause of crack or gap checked.",
        "Substrate prepared before repair.",
        "Repair material is suitable for the surface.",
        "Finished surface is aligned, clean, and ready for handover."
      ]
    };
  }

  if (text.includes("paint") || text.includes("finishing") || text.includes("uneven") || text.includes("scratch")) {
    return {
      rootCause: "Likely poor surface preparation, insufficient protection, touch-up mismatch, or incomplete finishing inspection.",
      responsibleTrade,
      rectificationSteps: [
        "Mark the affected finish area and protect adjacent completed works.",
        "Prepare the surface by cleaning, sanding, patching, or priming where required.",
        "Apply matching finish in accordance with approved material and method.",
        "Inspect under normal lighting before removing protection."
      ],
      closureChecklist: [
        "Affected area clearly marked.",
        "Adjacent finishes protected.",
        "Touch-up blends with surrounding surface.",
        "No visible stain, scratch, or uneven finish remains."
      ]
    };
  }

  return {
    rootCause: "Potential workmanship, coordination, protection, or incomplete work issue. Confirm the exact cause during site review.",
    responsibleTrade,
    rectificationSteps: [
      "Verify the issue location and compare against approved drawings or specification.",
      "Assign the responsible trade and agree the rectification method.",
      "Complete rectification with photo evidence.",
      "Request review before closing the item."
    ],
    closureChecklist: [
      "Issue verified on site.",
      "Responsible trade confirmed.",
      "Rectification completed with evidence.",
      "Client or consultant review completed."
    ]
  };
}

function mergeRectificationAssistant(saved: RectificationAssistant, draft: RectificationAssistant): RectificationAssistant {
  return {
    rootCause: saved.rootCause || draft.rootCause,
    responsibleTrade: saved.responsibleTrade || draft.responsibleTrade,
    rectificationSteps: saved.rectificationSteps.length ? saved.rectificationSteps : draft.rectificationSteps,
    closureChecklist: saved.closureChecklist.length ? saved.closureChecklist : draft.closureChecklist
  };
}

function createInsightGroup(key: string, label: string): AiInsightGroup {
  return {
    key,
    label,
    count: 0,
    aiObservationCount: 0,
    defectCount: 0,
    recurringCount: 0,
    openDefectCount: 0,
    examples: []
  };
}

function getInsightIdentity(value: string | null | undefined, fallback: string) {
  const label = value?.trim() || fallback;
  const key = normalizeAiComparisonValue(label) || normalizeAiComparisonValue(fallback);
  return { key, label };
}

function addInsightGroupEntry(
  map: Map<string, AiInsightGroup>,
  identity: { key: string; label: string },
  options: {
    source: "ai" | "defect";
    example?: string;
    recurringCount?: number;
    isOpenDefect?: boolean;
  }
) {
  const current = map.get(identity.key) ?? createInsightGroup(identity.key, identity.label);
  current.count += 1;

  if (options.source === "ai") {
    current.aiObservationCount += 1;
  } else {
    current.defectCount += 1;
  }

  current.recurringCount += options.recurringCount ?? 0;
  if (options.isOpenDefect) current.openDefectCount += 1;

  const example = options.example?.trim();
  if (example && !current.examples.includes(example) && current.examples.length < 3) {
    current.examples.push(example);
  }

  map.set(identity.key, current);
}

function sortInsightGroups(groups: AiInsightGroup[]) {
  return [...groups].sort(
    (a, b) =>
      b.recurringCount - a.recurringCount ||
      b.count - a.count ||
      b.openDefectCount - a.openDefectCount ||
      a.label.localeCompare(b.label)
  );
}

function getRiskLevel(riskScore: number): RiskLevel {
  if (riskScore >= 70) {
    return "high";
  }

  if (riskScore >= 35) {
    return "medium";
  }

  return "low";
}

function buildRiskSummary(input: RiskSignalInput, riskLevel: RiskLevel) {
  const signals: string[] = [];

  if (input.recurringIssuesCount) {
    signals.push(`${input.recurringIssuesCount} recurring issue(s)`);
  }

  if (input.openDefects) {
    signals.push(`${input.openDefects} open defect(s)`);
  }

  if (input.worseningProgressCount) {
    signals.push(`${input.worseningProgressCount} worsening progress comparison(s)`);
  }

  if (input.delayedProgressCount) {
    signals.push(`${input.delayedProgressCount} delayed progress comparison(s)`);
  }

  if (!signals.length) {
    return `${formatSectionLabel(riskLevel)} risk: no active recurring issue, open defect, or worsening progress signal.`;
  }

  return `${formatSectionLabel(riskLevel)} risk: ${signals.join(", ")}.`;
}

function calculateRiskScore(input: RiskSignalInput): RiskScore {
  const rawScore =
    input.recurringIssuesCount * 18 +
    input.openDefects * 12 +
    input.worseningProgressCount * 20 +
    input.delayedProgressCount * 10;
  const riskScore = Math.min(100, rawScore);
  const riskLevel = getRiskLevel(riskScore);

  return {
    key: input.key ?? normalizeAiComparisonValue(input.label),
    label: input.label,
    riskScore,
    riskLevel,
    riskSummary: buildRiskSummary(input, riskLevel),
    recurringIssuesCount: input.recurringIssuesCount,
    openDefects: input.openDefects,
    worseningProgressCount: input.worseningProgressCount,
    delayedProgressCount: input.delayedProgressCount
  };
}

function sortRiskScores(scores: RiskScore[]) {
  return [...scores].sort(
    (a, b) =>
      b.riskScore - a.riskScore ||
      b.openDefects - a.openDefects ||
      b.recurringIssuesCount - a.recurringIssuesCount ||
      a.label.localeCompare(b.label)
  );
}

function getAiReportTypeLabel(type: AiReportType) {
  return AI_REPORT_OPTIONS.find((option) => option.value === type)?.label ?? "AI report";
}

function normalizeReportLine(value: string) {
  return value.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "").trimEnd();
}

function wrapPdfTextLine(input: string, maxCharacters: number) {
  const line = normalizeReportLine(input);
  if (!line) return [""];

  const words = line.split(/\s+/);
  const wrapped: string[] = [];
  let current = "";

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxCharacters && current) {
      wrapped.push(current);
      current = word;
    } else {
      current = next;
    }
  });

  if (current) wrapped.push(current);
  return wrapped;
}

function buildPdfSafeFilename(projectName: string, reportType: AiReportType) {
  return `${sanitizeFilename(projectName || "project")}-${sanitizeFilename(reportType)}.pdf`;
}

function normalizeOptionalCoordinate(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  const coordinate = Number(text);
  if (!Number.isFinite(coordinate) || coordinate < 0 || coordinate > 1) {
    throw new Error("Drawing coordinates must be between 0 and 1.");
  }

  return coordinate;
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
    projectSetupRecords: [],
    contractorSubmissions: [],
    consultantSubmissions: [],
    surveyItems: [],
    dailyReports: [],
    weeklyReports: [],
    financialRecords: [],
    completionChecklist: [],
    defectZones: [],
    defects: [],
    aiSiteObservations: [],
    drawingSheets: [],
    drawingLinks: [],
    notifications: []
  };
}

function getUploadModeForSection(sectionType: RecordSectionType): FreePilotUploadMode {
  if (
    sectionType === "contractor_submission" ||
    sectionType === "consultant_submission" ||
    sectionType === "project_setup_record" ||
    sectionType === "weekly_report" ||
    sectionType === "financial_record"
  ) {
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

function isImageAttachment(attachment: AttachmentRecord) {
  return (
    attachment.mimeType.startsWith("image/") ||
    /\.(avif|gif|jpe?g|png|webp)$/i.test(attachment.name)
  );
}

function AttachmentList({ attachments }: { attachments: AttachmentRecord[] }) {
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const imageAttachments = attachments.filter((attachment) => isImageAttachment(attachment) && attachment.publicUrl);
  const fileAttachments = attachments.filter((attachment) => !isImageAttachment(attachment) || !attachment.publicUrl);

  useEffect(() => {
    if (!isGalleryOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsGalleryOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isGalleryOpen]);

  if (!attachments.length) {
    return <span className="pill">0 attachments</span>;
  }

  return (
    <>
      <div className="attachment-list">
        {imageAttachments.length ? (
          <button className="attachment-link attachment-button" onClick={() => setIsGalleryOpen(true)} type="button">
            View photos ({imageAttachments.length})
          </button>
        ) : null}
        {fileAttachments.map((attachment) => (
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
      {isGalleryOpen ? (
        <div className="photo-gallery-backdrop" onClick={() => setIsGalleryOpen(false)} role="presentation">
          <section
            aria-label="Attached photos"
            aria-modal="true"
            className="photo-gallery-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="photo-gallery-header">
              <div>
                <p className="eyebrow">Attachments</p>
                <h3>Photos ({imageAttachments.length})</h3>
              </div>
              <button className="ghost-button" onClick={() => setIsGalleryOpen(false)} type="button">
                Close
              </button>
            </div>
            <div className="photo-gallery-grid">
              {imageAttachments.map((attachment, index) => (
                <figure className="photo-gallery-item" key={attachment.id}>
                  <img alt={attachment.name || `Attachment photo ${index + 1}`} src={attachment.publicUrl ?? ""} />
                  <figcaption>
                    <span>{attachment.name}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </>
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

function normalizeProjectSetupPhase(value: unknown): ProjectSetupPhase {
  if (value === "due_diligence" || value === "design" || value === "tender" || value === "award" || value === "site_survey") {
    return value;
  }

  return "site_survey";
}

function normalizeProjectSetupStatus(value: unknown): ProjectSetupStatus {
  if (value === "in_progress" || value === "blocked" || value === "ready" || value === "closed" || value === "not_started") {
    return value;
  }

  return "not_started";
}

function normalizeProjectSetupPriority(value: unknown): ProjectSetupPriority {
  if (value === "high" || value === "urgent" || value === "normal") {
    return value;
  }

  return "normal";
}

function buildProjectSetupRecordFromRow(
  data: Record<string, unknown>,
  attachments: AttachmentRecord[] = []
): ProjectBundle["projectSetupRecords"][number] {
  return {
    id: String(data.id),
    phase: normalizeProjectSetupPhase(data.phase),
    category: String(data.category ?? ""),
    title: String(data.title ?? ""),
    owner: String(data.owner ?? ""),
    status: normalizeProjectSetupStatus(data.status),
    priority: normalizeProjectSetupPriority(data.priority),
    dueDate: typeof data.due_date === "string" && data.due_date ? data.due_date : null,
    notes: String(data.notes ?? ""),
    attachments,
    createdAt: String(data.created_at ?? "")
  };
}

function sortProjectSetupRecords(records: ProjectBundle["projectSetupRecords"]) {
  return [...records].sort((left, right) => {
    const leftDate = left.dueDate || "9999-12-31";
    const rightDate = right.dueDate || "9999-12-31";
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    return left.title.localeCompare(right.title);
  });
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

function formatContractorTypeShortLabel(value: ContractorPartyType) {
  return value === "main_contractor" ? "Main" : "Sub";
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

function formatTitleLabel(value: string) {
  return formatSectionLabel(value)
    .split(" ")
    .map((word) => {
      if (!word) return word;
      if (word.toLowerCase() === "rfi") return "RFI";
      return `${word[0].toUpperCase()}${word.slice(1)}`;
    })
    .join(" ");
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

function getContractorSubmissionOwnerRole(
  submission: ProjectBundle["contractorSubmissions"][number],
  members: ProjectMember[]
) {
  const memberRole = members.find((member) => member.email.toLowerCase() === submission.ownerEmail.toLowerCase())?.role;
  if (memberRole && memberRole !== "consultant") {
    return memberRole;
  }

  return submission.ownerRole === "consultant" ? "contractor" : submission.ownerRole;
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

function ProjectSetupStatusPill({ status }: { status: ProjectSetupStatus }) {
  const tone = status === "blocked" ? "rejected" : status === "ready" || status === "closed" ? "approved" : "pending";
  const label = PROJECT_SETUP_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? formatSectionLabel(status);
  return <TonePill tone={tone}>{label}</TonePill>;
}

function RiskLevelPill({ level }: { level: RiskLevel }) {
  return <span className={cn("pill", "risk-level-pill", `risk-level-${level}`)}>{formatSectionLabel(level)}</span>;
}

function FollowUpNotice({ followUpDate, followUpReason }: { followUpDate: string | null; followUpReason: string }) {
  return (
    <div className="follow-up-notice top-gap">
      <div className="record-header">
        <div>
          <p className="eyebrow">Follow-up required</p>
          <strong>{followUpDate ? formatDate(followUpDate) : "Date to confirm"}</strong>
        </div>
        <span className="pill">Suggested</span>
      </div>
      <p className="muted-copy">{followUpReason || "Review this item and confirm the next action."}</p>
    </div>
  );
}

type ExportCellValue = string | number | boolean | null;
type ExportRow = Record<string, ExportCellValue>;
type ExportSheet = {
  name: string;
  rows: ExportRow[];
};
type ExportFormat = "csv" | "pdf";
type ContractorSubmissionStatusFilter = ApprovalStatus | "all";
type ProjectSetupStatusFilter = ProjectSetupStatus | "all";
type SurveyStatusFilter = ChecklistStatus | "all";
type FinancialStatusFilter = FinancialStatus | "all";
type FinancialTypeFilter = ProjectBundle["financialRecords"][number]["documentType"] | "all";
type CompletionStatusFilter = CompletionStatus | "all";
type DefectStatusFilter = DefectStatus | "all";
type DrawingTypeFilter = DrawingType | "all";
type UserRoleFilter = UserRole | "all";
type AiInsightRiskFilter = RiskLevel | "all";

const MODULE_EXPORT_LABELS: Record<ModuleKey, string> = {
  overview: "Overview",
  contractor_submissions: "Documents Submission",
  handover: "Pre-Handover Survey",
  daily_reports: "Daily Reports",
  weekly_reports: "Weekly Reports",
  financials: "Financial Register",
  completion: "Completion Checklist",
  defects: "Defect Register",
  site_intelligence: "AI Site Intelligence"
};

const CONTRACTOR_SUBMISSION_STATUS_FILTERS: Array<{ value: ContractorSubmissionStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" }
];

const SURVEY_STATUS_FILTERS: Array<{ value: SurveyStatusFilter; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "good", label: "Good" },
  { value: "minor_issue", label: "Minor issue" },
  { value: "major_issue", label: "Major issue" },
  { value: "missing", label: "Missing" }
];

const FINANCIAL_STATUS_FILTERS: Array<{ value: FinancialStatusFilter; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "paid", label: "Paid" }
];

const FINANCIAL_TYPE_FILTERS: Array<{ value: FinancialTypeFilter; label: string }> = [
  { value: "all", label: "All types" },
  { value: "quotation", label: "Quotation" },
  { value: "invoice", label: "Invoice" },
  { value: "variation_order", label: "Variation order" }
];

const COMPLETION_STATUS_FILTERS: Array<{ value: CompletionStatusFilter; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "ready", label: "Ready" },
  { value: "completed", label: "Completed" }
];

const DEFECT_STATUS_FILTERS: Array<{ value: DefectStatusFilter; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "closed", label: "Closed" }
];

const USER_ROLE_FILTERS: Array<{ value: UserRoleFilter; label: string }> = [
  { value: "all", label: "All roles" },
  { value: "client", label: "Client" },
  { value: "contractor", label: "Main Contractor" },
  { value: "subcontractor", label: "Sub Contractor" },
  { value: "consultant", label: "Consultant" },
  { value: "master_admin", label: "Master Admin" }
];

function isMissingDrawingTypeColumnError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string };
  return (
    record.code === "42703" ||
    (typeof record.message === "string" &&
      record.message.includes("drawing_type") &&
      (record.message.includes("does not exist") || record.message.includes("schema cache") || record.message.includes("Could not find")))
  );
}

function isIsoDateInRange(value: string, from: string, to: string) {
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
}

function isProjectSetupPanelKey(key: DashboardPanelKey): key is ProjectSetupPanelKey {
  return PROJECT_SETUP_PHASES.some((phase) => phase.key === key);
}

function getProjectSetupCreateKey(phase: ProjectSetupPhase) {
  return `project-setup-${phase}`;
}

function getProjectSetupPhaseLabel(phase: ProjectSetupPhase) {
  return PROJECT_SETUP_PHASES.find((entry) => entry.phase === phase)?.label ?? formatSectionLabel(phase);
}

function getProjectSetupPriorityLabel(priority: ProjectSetupPriority) {
  return PROJECT_SETUP_PRIORITY_OPTIONS.find((option) => option.value === priority)?.label ?? formatSectionLabel(priority);
}

function getDrawingTypeLabel(value: DrawingType) {
  return DRAWING_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? formatSectionLabel(value);
}

function buildAttachmentNames(attachments: AttachmentRecord[]) {
  return attachments.map((attachment) => attachment.name).filter(Boolean).join(", ");
}

function buildAttachmentLinks(attachments: AttachmentRecord[]) {
  return attachments
    .map((attachment) => attachment.publicUrl)
    .filter((url): url is string => Boolean(url))
    .join("\n");
}

function buildExportFilename(project: ProjectBundle, moduleKey: ModuleKey, extension = "xlsx") {
  const projectName = sanitizeFilename(project.overview.name || "project");
  const moduleName = sanitizeFilename(MODULE_EXPORT_LABELS[moduleKey].toLowerCase().replaceAll(" ", "-"));
  return `${projectName}-${moduleName}.${extension}`;
}

function buildSheetName(name: string) {
  return name.replace(/[\][*?/\\:]/g, " ").slice(0, 31).trim() || "Export";
}

function buildContractorSubmissionTitle(submission: ProjectBundle["contractorSubmissions"][number]) {
  const firstItem = getSafeContractorSubmissionItems(submission)[0];
  return formatTitleLabel(firstItem?.submissionType || "contractor_submission");
}

function buildContractorSubmissionExportRows(
  submissions: ProjectBundle["contractorSubmissions"],
  project: ProjectBundle
): ExportRow[] {
  return submissions.flatMap((submission) => {
    const submissionItems = getSafeContractorSubmissionItems(submission);
    const exportItems = submissionItems.length ? submissionItems : [null];

    return exportItems.map((item) => ({
      "Submitted Date": submission.submittedDate,
      Owner: submission.ownerEmail,
      Role: getRoleLabel(getContractorSubmissionOwnerRole(submission, project.members), submission.ownerEmail),
      "Submission Type": item ? formatSectionLabel(item.submissionType) : buildContractorSubmissionTitle(submission),
      Description: item?.description ?? "No description recorded.",
      Quantity: item?.quantity ?? null,
      Unit: item?.unit ?? "",
      "Overall Status": getApprovalLabel(getContractorSubmissionOverallStatus(submission)),
      "Client Status": getApprovalLabel(submission.clientStatus),
      "Client Reviewed At": submission.clientReviewedAt,
      "Client Reviewed By": submission.clientReviewedByEmail,
      "Client Review Note": submission.clientReviewNote,
      "Consultant Status": getApprovalLabel(submission.consultantStatus),
      "Consultant Reviewed At": submission.consultantReviewedAt,
      "Consultant Reviewed By": submission.consultantReviewedByEmail,
      "Consultant Review Note": submission.consultantReviewNote,
      Attachments: buildAttachmentNames(submission.attachments),
      "Attachment Links": buildAttachmentLinks(submission.attachments)
    }));
  });
}

function buildProjectSetupExportRows(records: ProjectBundle["projectSetupRecords"]): ExportRow[] {
  return records.map((record) => ({
    Phase: getProjectSetupPhaseLabel(record.phase),
    Category: record.category,
    Item: record.title,
    Owner: record.owner,
    Status: PROJECT_SETUP_STATUS_OPTIONS.find((option) => option.value === record.status)?.label ?? formatSectionLabel(record.status),
    Priority: getProjectSetupPriorityLabel(record.priority),
    "Due Date": record.dueDate,
    Notes: record.notes,
    Attachments: buildAttachmentNames(record.attachments),
    "Attachment Links": buildAttachmentLinks(record.attachments)
  }));
}

function escapeCsvCell(value: ExportCellValue) {
  const text = value === null || value === undefined ? "" : String(value);
  if (!/[",\n\r]/.test(text)) {
    return text;
  }

  return `"${text.replaceAll("\"", "\"\"")}"`;
}

function buildCsvContent(rows: ExportRow[]) {
  const columnNames = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const header = columnNames.map(escapeCsvCell).join(",");
  const body = rows.map((row) => columnNames.map((columnName) => escapeCsvCell(row[columnName] ?? null)).join(","));
  return [header, ...body].join("\n");
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function normalizePdfText(value: string | number | null | undefined) {
  return String(value ?? "").replace(/[^\x20-\x7E\n]/g, " ").replace(/\s+\n/g, "\n").trim();
}

function wrapPdfText(value: string, maxCharacters: number) {
  const lines: string[] = [];

  normalizePdfText(value)
    .split("\n")
    .forEach((paragraph) => {
      const words = paragraph.split(/\s+/).filter(Boolean);
      let line = "";

      words.forEach((word) => {
        const nextLine = line ? `${line} ${word}` : word;
        if (nextLine.length > maxCharacters && line) {
          lines.push(line);
          line = word;
        } else {
          line = nextLine;
        }
      });

      if (line) {
        lines.push(line);
      }
    });

  return lines.length ? lines : [""];
}

async function buildContractorSubmissionPdfBlob(project: ProjectBundle, submissions: ProjectBundle["contractorSubmissions"]) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const document = await PDFDocument.create();
  const regularFont = await document.embedFont(StandardFonts.Helvetica);
  const boldFont = await document.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = [595.28, 841.89];
  const margin = 42;
  const lineHeight = 13;
  let page = document.addPage(pageSize);
  let y = pageSize[1] - margin;

  const addPage = () => {
    page = document.addPage(pageSize);
    y = pageSize[1] - margin;
  };

  const drawLines = (text: string, options?: { bold?: boolean; size?: number; color?: ReturnType<typeof rgb>; indent?: number }) => {
    const fontSize = options?.size ?? 9;
    const indent = options?.indent ?? 0;
    const maxCharacters = Math.max(34, Math.floor((pageSize[0] - margin * 2 - indent) / (fontSize * 0.52)));
    const lines = wrapPdfText(text, maxCharacters);

    lines.forEach((line) => {
      if (y < margin + lineHeight) {
        addPage();
      }

      page.drawText(line, {
        x: margin + indent,
        y,
        size: fontSize,
        font: options?.bold ? boldFont : regularFont,
        color: options?.color ?? rgb(0.1, 0.14, 0.2)
      });
      y -= lineHeight;
    });
  };

  drawLines(`${project.overview.name || "Project"} - Contractor Documents`, { bold: true, size: 15 });
  drawLines(`Exported ${formatDateTime(new Date().toISOString())}`, { size: 9, color: rgb(0.38, 0.43, 0.5) });
  y -= 8;

  submissions.forEach((submission, index) => {
    const submissionItems = getSafeContractorSubmissionItems(submission);
    const ownerRole = getContractorSubmissionOwnerRole(submission, project.members);

    if (y < 120) {
      addPage();
    }

    drawLines(`${index + 1}. ${buildContractorSubmissionTitle(submission)} - ${formatDate(submission.submittedDate)}`, {
      bold: true,
      size: 11
    });
    drawLines(`Status: ${getApprovalLabel(getContractorSubmissionOverallStatus(submission))}`, { indent: 12 });
    drawLines(`Submitted by: ${getRoleLabel(ownerRole, submission.ownerEmail)} (${submission.ownerEmail || "Unknown user"})`, { indent: 12 });
    drawLines(`Client: ${getApprovalLabel(submission.clientStatus)} | Consultant: ${getApprovalLabel(submission.consultantStatus)}`, {
      indent: 12
    });
    drawLines(`Attachments: ${submission.attachments.length ? buildAttachmentNames(submission.attachments) : "None"}`, { indent: 12 });

    submissionItems.forEach((item, itemIndex) => {
      drawLines(`${itemIndex + 1}) ${formatTitleLabel(item.submissionType)}`, { bold: true, indent: 18 });
      drawLines(item.description || "No description recorded.", { indent: 24 });
      if (item.quantity !== null || item.unit) {
        drawLines(`Quantity: ${item.quantity ?? "Not stated"}${item.unit ? ` ${item.unit}` : ""}`, { indent: 24 });
      }
    });

    y -= 8;
  });

  const bytes = await document.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

function buildModuleExportSheets(project: ProjectBundle, moduleKey: ModuleKey): ExportSheet[] {
  if (moduleKey === "overview") {
    return [
      {
        name: "Project Summary",
        rows: [
          { Field: "Project Name", Value: project.overview.name },
          { Field: "Location", Value: project.overview.location },
          { Field: "Client", Value: project.overview.clientName },
          { Field: "Lead Contractor", Value: project.overview.contractorName },
          { Field: "Handover Date", Value: project.overview.handoverDate },
          { Field: "Completion Date", Value: project.overview.completionDate },
          { Field: "Details", Value: project.overview.details }
        ]
      },
      {
        name: "Contractors",
        rows: project.projectContractors.map((contractor) => ({
          Company: contractor.companyName,
          Type: formatContractorTypeLabel(contractor.contractorType),
          Trades: contractor.trades.map(formatContractorTradeLabel).join(", ")
        }))
      },
      {
        name: "Consultants",
        rows: project.projectConsultants.map((consultant) => ({
          Company: consultant.companyName,
          Trades: consultant.trades.map(formatConsultantTradeLabel).join(", ")
        }))
      },
      {
        name: "Milestones",
        rows: project.milestones.map((milestone) => ({
          Title: milestone.title,
          "Due Date": milestone.dueDate
        }))
      }
    ];
  }

  if (moduleKey === "contractor_submissions") {
    return [
      {
        name: "Contractor Documents",
        rows: buildContractorSubmissionExportRows(project.contractorSubmissions, project)
      },
      {
        name: "Consultant Documents",
        rows: project.consultantSubmissions.flatMap((submission) =>
          getSafeConsultantSubmissionItems(submission).map((item) => ({
            "Submitted Date": submission.submittedDate,
            Owner: submission.ownerEmail,
            Role: getRoleLabel(submission.ownerRole, submission.ownerEmail),
            "Document Type": item.documentType,
            Description: item.description,
            Status: getApprovalLabel(submission.status, CONSULTANT_DOCUMENT_STATUS_LABELS),
            "Reviewed At": submission.reviewedAt,
            "Reviewed By": submission.reviewedByEmail,
            "Review Note": submission.reviewNote,
            Attachments: buildAttachmentNames(submission.attachments),
            "Attachment Links": buildAttachmentLinks(submission.attachments)
          }))
        )
      }
    ];
  }

  if (moduleKey === "handover") {
    return [
      {
        name: "Survey Items",
        rows: project.surveyItems.map((item) => ({
          Area: item.area,
          Item: item.item,
          Status: formatSectionLabel(item.status),
          Details: item.details,
          Attachments: buildAttachmentNames(item.attachments),
          "Attachment Links": buildAttachmentLinks(item.attachments)
        }))
      }
    ];
  }

  if (moduleKey === "daily_reports") {
    return [
      {
        name: "Daily Reports",
        rows: project.dailyReports.map((report) => ({
          Date: report.reportDate,
          Location: report.location,
          "Work Done": report.workDone,
          "Manpower By Trade": report.manpowerByTrade,
          Attachments: buildAttachmentNames(report.attachments),
          "Attachment Links": buildAttachmentLinks(report.attachments)
        }))
      }
    ];
  }

  if (moduleKey === "weekly_reports") {
    return [
      {
        name: "Weekly Reports",
        rows: project.weeklyReports.map((report) => ({
          "Week Ending": report.weekEnding,
          Summary: report.summary,
          Attachments: buildAttachmentNames(report.attachments),
          "Attachment Links": buildAttachmentLinks(report.attachments)
        }))
      }
    ];
  }

  if (moduleKey === "financials") {
    return [
      {
        name: "Financial Register",
        rows: project.financialRecords.map((record) => ({
          "Document Type": formatSectionLabel(record.documentType),
          Reference: record.referenceNumber,
          Amount: record.amount,
          Status: formatSectionLabel(record.status),
          Notes: record.notes,
          Owner: record.ownerEmail,
          "Owner Role": getRoleLabel(record.ownerRole, record.ownerEmail),
          "Submitted At": record.submittedAt,
          "Reviewed At": record.reviewedAt,
          "Reviewed By": record.reviewedByEmail,
          "Review Note": record.reviewNote,
          Attachments: buildAttachmentNames(record.attachments),
          "Attachment Links": buildAttachmentLinks(record.attachments)
        }))
      }
    ];
  }

  if (moduleKey === "completion") {
    return [
      {
        name: "Completion Checklist",
        rows: project.completionChecklist.map((item) => ({
          Item: item.item,
          Status: formatSectionLabel(item.status),
          Details: item.details
        }))
      }
    ];
  }

  return [
    {
      name: "Defect Register",
      rows: project.defects.map((defect) => ({
        Zone: defect.zone,
        Title: defect.title,
        Status: formatSectionLabel(defect.status),
        Details: defect.details,
        "Follow-up Date": defect.followUpDate,
        "Follow-up Reason": defect.followUpReason,
        Attachments: buildAttachmentNames(defect.attachments),
        "Attachment Links": buildAttachmentLinks(defect.attachments)
      }))
    },
    {
      name: "Defect Zones",
      rows: project.defectZones.map((zone) => ({
        Zone: zone.name
      }))
    }
  ];
}

function ExportButton({
  moduleKey,
  disabled,
  onExport
}: {
  moduleKey: ModuleKey;
  disabled?: boolean;
  onExport: (moduleKey: ModuleKey) => void;
}) {
  return (
    <button className="ghost-button module-export-button" disabled={disabled} onClick={() => onExport(moduleKey)} type="button">
      <span aria-hidden="true" className="nav-symbol nav-symbol-theme">
        {"\u21e9"}
      </span>
      Export
    </button>
  );
}

function ModuleAiButton({
  isOpen,
  moduleName,
  onClick
}: {
  isOpen: boolean;
  moduleName: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-expanded={isOpen}
      aria-label={`${isOpen ? "Close" : "Open"} AI assistant for ${moduleName}`}
      className={cn("icon-action-button", "ai-assist-button", isOpen && "is-open")}
      onClick={onClick}
      type="button"
    >
      <span aria-hidden="true">AI</span>
    </button>
  );
}

function FilterIconButton({
  isOpen,
  moduleName,
  onClick
}: {
  isOpen: boolean;
  moduleName: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-expanded={isOpen}
      aria-label={`${isOpen ? "Close" : "Open"} ${moduleName} filters`}
      className={cn("icon-action-button", "filter-action-button", isOpen && "is-open")}
      onClick={onClick}
      type="button"
    >
      <span className="filter-action-symbol" aria-hidden="true" />
    </button>
  );
}

function ModuleHeaderActions({ children }: { children: ReactNode }) {
  return <div className="module-header-actions">{children}</div>;
}

function CreateToggleButton({
  isOpen,
  onClick
}: {
  isOpen: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-expanded={isOpen}
      className={cn("secondary-button create-toggle-button", isOpen && "is-open")}
      onClick={onClick}
      type="button"
    >
      {isOpen ? "Close" : "+ Create"}
    </button>
  );
}

function CreatePanel({
  title,
  meta,
  eyebrow = "Create",
  children
}: {
  title: string;
  meta?: ReactNode;
  eyebrow?: string;
  children: ReactNode;
}) {
  return (
    <div className="panel-surface module-create-panel top-gap">
      <div className="module-create-panel-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h4>{title}</h4>
        </div>
        {meta ? <div className="disclosure-meta">{meta}</div> : null}
      </div>
      {children}
    </div>
  );
}

function ModuleAiAssistantPanel({
  error,
  isLoading,
  moduleName,
  onSubmit,
  result
}: {
  error?: string | null;
  isLoading?: boolean;
  moduleName: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  result?: string | null;
}) {
  return (
    <div className="panel-surface module-ai-panel top-gap">
      <div className="module-ai-panel-header">
        <div>
          <p className="eyebrow">AI assistant</p>
          <h4>{moduleName}</h4>
        </div>
        <span className="pill">Prompt + files</span>
      </div>
      <form className="module-form-grid" onSubmit={onSubmit}>
        <label className="field field-full">
          <span>Prompt</span>
          <textarea
            name="aiPrompt"
            placeholder="Ask AI to draft, check, summarize, compare, or prepare the next record."
            required
            rows={4}
          />
        </label>
        <label className="field">
          <span>Reference files</span>
          <input accept={getUploadAcceptForMode("mixed")} multiple name="aiFiles" type="file" />
        </label>
        <label className="field">
          <span>Output type</span>
          <select defaultValue="draft" name="aiOutputType">
            <option value="draft">Draft response</option>
            <option value="summary">Summary</option>
            <option value="checklist">Checklist</option>
            <option value="record">Record-ready text</option>
          </select>
        </label>
        <button className="secondary-button" disabled={isLoading} type="submit">
          {isLoading ? "Preparing..." : "Ask AI"}
        </button>
      </form>
      {error ? <p className="form-error top-gap">{error}</p> : null}
      {result ? (
        <div className="module-ai-result top-gap">
          <p className="eyebrow">AI draft</p>
          <p>{result}</p>
        </div>
      ) : null}
    </div>
  );
}

function RectificationAssistantForm({
  assistant,
  disabled,
  onSubmit
}: {
  assistant: RectificationAssistant;
  disabled?: boolean;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="rectification-assistant module-form-grid top-gap" onSubmit={onSubmit}>
      <div className="field field-full">
        <span>AI Rectification Assistant</span>
        <p className="field-hint">Draft guidance only. Edit the root cause, trade, steps, and closure checks before saving.</p>
      </div>
      <label className="field field-full">
        <span>Likely root cause</span>
        <textarea defaultValue={assistant.rootCause} name="rootCause" rows={3} />
      </label>
      <label className="field">
        <span>Responsible trade</span>
        <input defaultValue={assistant.responsibleTrade} name="responsibleTrade" />
      </label>
      <label className="field field-full">
        <span>Rectification steps</span>
        <textarea defaultValue={assistantLinesToText(assistant.rectificationSteps)} name="rectificationSteps" rows={5} />
      </label>
      <label className="field field-full">
        <span>Closure checklist</span>
        <textarea defaultValue={assistantLinesToText(assistant.closureChecklist)} name="closureChecklist" rows={4} />
      </label>
      <div className="record-actions field-full">
        <button className="secondary-button" disabled={disabled} type="submit">
          Save assistant
        </button>
      </div>
    </form>
  );
}

function InsightListCard({
  eyebrow,
  title,
  emptyLabel,
  groups
}: {
  eyebrow: string;
  title: string;
  emptyLabel: string;
  groups: AiInsightGroup[];
}) {
  return (
    <article className="record-surface insight-list-card">
      <div className="record-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <strong>{title}</strong>
        </div>
        <span className="pill">{groups.length} groups</span>
      </div>
      {groups.length ? (
        <div className="insight-list">
          {groups.map((group) => (
            <div className="insight-list-row" key={group.key}>
              <div>
                <strong>{group.label}</strong>
                <p className="muted-copy">
                  {group.aiObservationCount} AI observation(s) · {group.defectCount} defect(s)
                </p>
                {group.examples[0] ? <p className="muted-copy">{group.examples[0]}</p> : null}
              </div>
              <div className="attachment-list insight-list-meta">
                <span className="pill">{group.count} total</span>
                {group.recurringCount ? <span className="pill recurring-issue-badge">{group.recurringCount} recurring</span> : null}
                {group.openDefectCount ? <span className="pill">{group.openDefectCount} open defect(s)</span> : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted-copy top-gap">{emptyLabel}</p>
      )}
    </article>
  );
}

function DrawingLinkPanel({
  drawingSheets,
  drawingLinks,
  disabled,
  onSubmit
}: {
  drawingSheets: ProjectBundle["drawingSheets"];
  drawingLinks: ProjectBundle["drawingLinks"];
  disabled?: boolean;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const drawingSheetsById = new Map(drawingSheets.map((drawing) => [drawing.id, drawing]));

  return (
    <div className="drawing-link-panel top-gap">
      <div className="record-header">
        <div>
          <p className="eyebrow">Drawing Link</p>
          <strong>Linked drawings</strong>
        </div>
        <span className="pill">{drawingLinks.length} linked</span>
      </div>
      {drawingLinks.length ? (
        <div className="drawing-link-list">
          {drawingLinks.map((link) => {
            const drawing = drawingSheetsById.get(link.drawingSheetId);

            return (
              <article className="drawing-link-item" key={link.id}>
                <div>
                  <strong>{drawing?.title || drawing?.sheetNumber || "Drawing sheet"}</strong>
                  <p className="muted-copy">
                    {[drawing?.sheetNumber, drawing?.revision, drawing?.discipline].filter(Boolean).join(" · ") || "Drawing details not set"}
                  </p>
                  {link.markupLabel ? <p className="muted-copy">Marker: {link.markupLabel}</p> : null}
                  {link.notes ? <p className="muted-copy">{link.notes}</p> : null}
                </div>
                <div className="attachment-list drawing-link-meta">
                  {link.xCoordinate !== null && link.yCoordinate !== null ? (
                    <span className="pill">
                      X {link.xCoordinate.toFixed(3)} / Y {link.yCoordinate.toFixed(3)}
                    </span>
                  ) : (
                    <span className="pill">No marker</span>
                  )}
                  {drawing?.filePublicUrl ? (
                    <a className="attachment-link" href={drawing.filePublicUrl} rel="noreferrer" target="_blank">
                      Open drawing
                    </a>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="muted-copy top-gap">No drawing linked yet.</p>
      )}

      {drawingSheets.length ? (
        <form className="module-form-grid top-gap" onSubmit={onSubmit}>
          <label className="field field-full">
            <span>Drawing sheet</span>
            <select name="drawingSheetId" required>
              <option value="">Select drawing</option>
              {drawingSheets.map((drawing) => (
                <option key={drawing.id} value={drawing.id}>
                  {[drawing.sheetNumber, drawing.title, drawing.revision].filter(Boolean).join(" - ") || "Untitled drawing"}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>X coordinate</span>
            <input max="1" min="0" name="xCoordinate" placeholder="0.000 to 1.000" step="0.001" type="number" />
          </label>
          <label className="field">
            <span>Y coordinate</span>
            <input max="1" min="0" name="yCoordinate" placeholder="0.000 to 1.000" step="0.001" type="number" />
          </label>
          <label className="field">
            <span>Marker label</span>
            <input name="markupLabel" placeholder="Lobby ceiling / Grid A3" />
          </label>
          <label className="field field-full">
            <span>Note</span>
            <textarea name="notes" placeholder="Approximate drawing location or context" rows={3} />
          </label>
          <div className="record-actions field-full">
            <button className="secondary-button" disabled={disabled} type="submit">
              Link drawing
            </button>
          </div>
        </form>
      ) : (
        <p className="field-hint top-gap">Upload drawing sheets in the Drawing Register before linking records.</p>
      )}
    </div>
  );
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
  const isCreateCard = eyebrow?.toLowerCase() === "create";

  return (
    <details className={cn("disclosure-card", isCreateCard && "disclosure-card-create", className)}>
      <summary className="disclosure-summary">
        <span className="disclosure-copy">
          {eyebrow && !isCreateCard ? <span className="eyebrow disclosure-eyebrow">{eyebrow}</span> : null}
          <strong>{title}</strong>
          {subtitle ? <span className="muted-copy disclosure-subtitle">{subtitle}</span> : null}
          {meta && !isCreateCard ? <span className="disclosure-meta">{meta}</span> : null}
        </span>
        <span className="disclosure-summary-side">
          {badge}
          <span className="pill disclosure-toggle-pill" aria-hidden="true">
            <span className="disclosure-closed-label">{isCreateCard ? "+ Create" : "Open"}</span>
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

type DashboardPanelKey = ModuleKey | ProjectSetupPanelKey | "drawing_register" | "ai_insights" | "access_control";
type DashboardSectorKey = "project_setup" | "project_delivery";
type DashboardPanelEntry = {
  key: DashboardPanelKey;
  label: string;
  href: string;
  sector: DashboardSectorKey;
};

const DASHBOARD_SECTOR_OPTIONS: Array<{ key: DashboardSectorKey; label: string }> = [
  { key: "project_setup", label: "Project Setup" },
  { key: "project_delivery", label: "Project Delivery" }
];

function getDashboardSectorLabel(sector: DashboardSectorKey) {
  return DASHBOARD_SECTOR_OPTIONS.find((option) => option.key === sector)?.label ?? "Dashboard";
}

type OverviewEditTarget =
  | { kind: "contractor"; id: string }
  | { kind: "consultant"; id: string }
  | { kind: "milestone"; id: string }
  | null;

export function DashboardShell({ initialProjects, isConfigured, todaySnapshot, viewer }: Props) {
  const [projects, setProjects] = useState<ProjectBundle[]>(initialProjects);
  const [activeProjectId, setActiveProjectId] = useState<string>(initialProjects[0]?.overview.id ?? "");
  const [activePanelKey, setActivePanelKey] = useState<DashboardPanelKey>("overview");
  const [activeDashboardSector, setActiveDashboardSector] = useState<DashboardSectorKey>("project_delivery");
  const [financialReviewNotes, setFinancialReviewNotes] = useState<Record<string, string>>({});
  const [contractorSubmissionReviewNotes, setContractorSubmissionReviewNotes] = useState<Record<string, string>>({});
  const [contractorSubmissionReviewErrors, setContractorSubmissionReviewErrors] = useState<Record<string, string>>({});
  const [consultantSubmissionReviewNotes, setConsultantSubmissionReviewNotes] = useState<Record<string, string>>({});
  const [selectedContractorSubmissionId, setSelectedContractorSubmissionId] = useState<string | null>(null);
  const [selectedDailyReportId, setSelectedDailyReportId] = useState<string | null>(null);
  const [editingDailyReportId, setEditingDailyReportId] = useState<string | null>(null);
  const [openCreatePanelKey, setOpenCreatePanelKey] = useState<string | null>(null);
  const [overviewEditTarget, setOverviewEditTarget] = useState<OverviewEditTarget>(null);
  const [overviewActionMenuKey, setOverviewActionMenuKey] = useState<string | null>(null);
  const [isMobileModuleListOpen, setIsMobileModuleListOpen] = useState(false);
  const [isMobileCreateMenuOpen, setIsMobileCreateMenuOpen] = useState(false);
  const [openAiAssistantKey, setOpenAiAssistantKey] = useState<DashboardPanelKey | null>(null);
  const [openFilterPanelKey, setOpenFilterPanelKey] = useState<DashboardPanelKey | null>(null);
  const [moduleAiLoadingKey, setModuleAiLoadingKey] = useState<DashboardPanelKey | null>(null);
  const [moduleAiResults, setModuleAiResults] = useState<Partial<Record<DashboardPanelKey, string>>>({});
  const [moduleAiErrors, setModuleAiErrors] = useState<Partial<Record<DashboardPanelKey, string>>>({});
  const [contractorSubmissionStatusFilter, setContractorSubmissionStatusFilter] =
    useState<ContractorSubmissionStatusFilter>("all");
  const [contractorSubmissionDateFrom, setContractorSubmissionDateFrom] = useState("");
  const [contractorSubmissionDateTo, setContractorSubmissionDateTo] = useState("");
  const [projectSetupStatusFilter, setProjectSetupStatusFilter] = useState<ProjectSetupStatusFilter>("all");
  const [projectSetupDateFrom, setProjectSetupDateFrom] = useState("");
  const [projectSetupDateTo, setProjectSetupDateTo] = useState("");
  const [projectSetupSearchFilter, setProjectSetupSearchFilter] = useState("");
  const [selectedProjectSetupRecordId, setSelectedProjectSetupRecordId] = useState<string | null>(null);
  const [editingProjectSetupRecordId, setEditingProjectSetupRecordId] = useState<string | null>(null);
  const [surveyStatusFilter, setSurveyStatusFilter] = useState<SurveyStatusFilter>("all");
  const [dailyReportDateFrom, setDailyReportDateFrom] = useState("");
  const [dailyReportDateTo, setDailyReportDateTo] = useState("");
  const [dailyReportLocationFilter, setDailyReportLocationFilter] = useState("");
  const [weeklyReportDateFrom, setWeeklyReportDateFrom] = useState("");
  const [weeklyReportDateTo, setWeeklyReportDateTo] = useState("");
  const [financialStatusFilter, setFinancialStatusFilter] = useState<FinancialStatusFilter>("all");
  const [financialTypeFilter, setFinancialTypeFilter] = useState<FinancialTypeFilter>("all");
  const [completionStatusFilter, setCompletionStatusFilter] = useState<CompletionStatusFilter>("all");
  const [defectStatusFilter, setDefectStatusFilter] = useState<DefectStatusFilter>("all");
  const [defectZoneFilter, setDefectZoneFilter] = useState("");
  const [drawingTypeFilter, setDrawingTypeFilter] = useState<DrawingTypeFilter>("all");
  const [drawingSearchFilter, setDrawingSearchFilter] = useState("");
  const [aiInsightRiskFilter, setAiInsightRiskFilter] = useState<AiInsightRiskFilter>("all");
  const [memberRoleFilter, setMemberRoleFilter] = useState<UserRoleFilter>("all");
  const [isContractorDocumentExportMode, setIsContractorDocumentExportMode] = useState(false);
  const [selectedContractorDocumentIds, setSelectedContractorDocumentIds] = useState<string[]>([]);
  const [contractorSubmissionDraftItems, setContractorSubmissionDraftItems] = useState<ContractorSubmissionDraftItem[]>([
    createEmptyContractorSubmissionDraftItem()
  ]);
  const [consultantSubmissionDraftItems, setConsultantSubmissionDraftItems] = useState<ConsultantSubmissionDraftItem[]>([
    createEmptyConsultantSubmissionDraftItem()
  ]);
  const [completionDraftItems, setCompletionDraftItems] = useState<CompletionDraftItem[]>([createEmptyCompletionDraftItem()]);
  const [defectDraftItems, setDefectDraftItems] = useState<DefectDraftItem[]>([createEmptyDefectDraftItem()]);
  const aiSiteState = useAiSiteIntelligenceState();
  const {
    aiSiteAnalysisResult,
    setAiSiteAnalysisResult,
    aiSiteAnalysisError,
    setAiSiteAnalysisError,
    isAiSiteAnalyzing,
    setIsAiSiteAnalyzing,
    aiSiteLocation,
    setAiSiteLocation,
    aiSiteTrade,
    setAiSiteTrade,
    smartCameraMode,
    setSmartCameraMode,
    aiPreviousObservationId,
    setAiPreviousObservationId,
    aiDailyReportDraft,
    setAiDailyReportDraft,
    aiDailyReportError,
    setAiDailyReportError,
    aiDailyReportSuccess,
    setAiDailyReportSuccess,
    isAiDailyReportSaving,
    setIsAiDailyReportSaving,
    aiObservationFilter,
    setAiObservationFilter,
    aiObservationConversionDraft,
    setAiObservationConversionDraft,
    aiObservationActionKey,
    setAiObservationActionKey,
    aiObservationQueueError,
    setAiObservationQueueError,
    aiObservationQueueSuccess,
    setAiObservationQueueSuccess,
    resetAiAnalysisState,
    resetAiQueueMessages
  } = aiSiteState;
  const [drawingSummaryActionId, setDrawingSummaryActionId] = useState<string | null>(null);
  const [heatmapDrawingId, setHeatmapDrawingId] = useState<string | null>(null);
  const [activeHeatmapLinkId, setActiveHeatmapLinkId] = useState<string | null>(null);
  const [aiReportType, setAiReportType] = useState<AiReportType>("weekly_summary");
  const [aiReportDraft, setAiReportDraft] = useState("");
  const [aiReportError, setAiReportError] = useState<string | null>(null);
  const [isAiReportExporting, setIsAiReportExporting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const activeProject = useMemo(
    () => projects.find((project) => project.overview.id === activeProjectId) ?? projects[0] ?? emptyProject(),
    [activeProjectId, projects]
  );

  const toggleCreatePanel = (key: string) => {
    setOpenAiAssistantKey(null);
    setOpenFilterPanelKey(null);
    setOverviewEditTarget(null);
    setOverviewActionMenuKey(null);
    setOpenCreatePanelKey((current) => (current === key ? null : key));
  };

  useEffect(() => {
    setOpenCreatePanelKey(null);
    setIsMobileModuleListOpen(false);
    setIsMobileCreateMenuOpen(false);
    setOpenAiAssistantKey(null);
    setOpenFilterPanelKey(null);
    setModuleAiLoadingKey(null);
    setIsContractorDocumentExportMode(false);
    setSelectedContractorDocumentIds([]);
    setOverviewEditTarget(null);
    setOverviewActionMenuKey(null);
    setSelectedProjectSetupRecordId(null);
    setEditingProjectSetupRecordId(null);
  }, [activePanelKey, activeProjectId]);

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
  const contractorSubmissionStatusCounts = useMemo(() => {
    const dateFilteredSubmissions = activeProject.contractorSubmissions.filter((submission) => {
      if (contractorSubmissionDateFrom && submission.submittedDate < contractorSubmissionDateFrom) {
        return false;
      }

      if (contractorSubmissionDateTo && submission.submittedDate > contractorSubmissionDateTo) {
        return false;
      }

      return true;
    });
    const counts: Record<ContractorSubmissionStatusFilter, number> = {
      all: dateFilteredSubmissions.length,
      pending: 0,
      approved: 0,
      rejected: 0
    };

    dateFilteredSubmissions.forEach((submission) => {
      counts[getContractorSubmissionOverallStatus(submission)] += 1;
    });

    return counts;
  }, [activeProject.contractorSubmissions, contractorSubmissionDateFrom, contractorSubmissionDateTo]);
  const visibleContractorSubmissions = useMemo(() => {
    const dateFilteredSubmissions = activeProject.contractorSubmissions.filter((submission) => {
      if (contractorSubmissionDateFrom && submission.submittedDate < contractorSubmissionDateFrom) {
        return false;
      }

      if (contractorSubmissionDateTo && submission.submittedDate > contractorSubmissionDateTo) {
        return false;
      }

      return true;
    });

    if (contractorSubmissionStatusFilter === "all") {
      return dateFilteredSubmissions;
    }

    return dateFilteredSubmissions.filter(
      (submission) => getContractorSubmissionOverallStatus(submission) === contractorSubmissionStatusFilter
    );
  }, [activeProject.contractorSubmissions, contractorSubmissionDateFrom, contractorSubmissionDateTo, contractorSubmissionStatusFilter]);
  const visibleContractorSubmissionIdSet = useMemo(
    () => new Set(visibleContractorSubmissions.map((submission) => submission.id)),
    [visibleContractorSubmissions]
  );
  const selectedVisibleContractorDocumentIds = selectedContractorDocumentIds.filter((id) =>
    visibleContractorSubmissionIdSet.has(id)
  );
  const allVisibleContractorDocumentsSelected =
    visibleContractorSubmissions.length > 0 && selectedVisibleContractorDocumentIds.length === visibleContractorSubmissions.length;
  function getVisibleProjectSetupRecords(phase: ProjectSetupPhase) {
    const query = projectSetupSearchFilter.trim().toLowerCase();

    return sortProjectSetupRecords(
      activeProject.projectSetupRecords.filter((record) => {
        if (record.phase !== phase) return false;
        if (projectSetupStatusFilter !== "all" && record.status !== projectSetupStatusFilter) return false;
        if (projectSetupDateFrom && (!record.dueDate || record.dueDate < projectSetupDateFrom)) return false;
        if (projectSetupDateTo && (!record.dueDate || record.dueDate > projectSetupDateTo)) return false;

        if (query) {
          const haystack = [record.title, record.category, record.owner, record.notes].join(" ").toLowerCase();
          if (!haystack.includes(query)) return false;
        }

        return true;
      })
    );
  }
  const visibleSurveyItems = useMemo(() => {
    if (surveyStatusFilter === "all") {
      return activeProject.surveyItems;
    }

    return activeProject.surveyItems.filter((item) => item.status === surveyStatusFilter);
  }, [activeProject.surveyItems, surveyStatusFilter]);
  const visibleDailyReports = useMemo(() => {
    const locationQuery = dailyReportLocationFilter.trim().toLowerCase();

    return activeProject.dailyReports.filter((report) => {
      if (!isIsoDateInRange(report.reportDate, dailyReportDateFrom, dailyReportDateTo)) {
        return false;
      }

      if (locationQuery && !report.location.toLowerCase().includes(locationQuery)) {
        return false;
      }

      return true;
    });
  }, [activeProject.dailyReports, dailyReportDateFrom, dailyReportDateTo, dailyReportLocationFilter]);
  const visibleWeeklyReports = useMemo(
    () =>
      activeProject.weeklyReports.filter((report) =>
        isIsoDateInRange(report.weekEnding, weeklyReportDateFrom, weeklyReportDateTo)
      ),
    [activeProject.weeklyReports, weeklyReportDateFrom, weeklyReportDateTo]
  );
  const visibleFinancialRecords = useMemo(
    () =>
      activeProject.financialRecords.filter((record) => {
        if (financialStatusFilter !== "all" && record.status !== financialStatusFilter) {
          return false;
        }

        if (financialTypeFilter !== "all" && record.documentType !== financialTypeFilter) {
          return false;
        }

        return true;
      }),
    [activeProject.financialRecords, financialStatusFilter, financialTypeFilter]
  );
  const visibleCompletionChecklist = useMemo(() => {
    if (completionStatusFilter === "all") {
      return activeProject.completionChecklist;
    }

    return activeProject.completionChecklist.filter((item) => item.status === completionStatusFilter);
  }, [activeProject.completionChecklist, completionStatusFilter]);
  const visibleDefects = useMemo(() => {
    const zoneQuery = defectZoneFilter.trim().toLowerCase();

    return activeProject.defects.filter((defect) => {
      if (defectStatusFilter !== "all" && defect.status !== defectStatusFilter) {
        return false;
      }

      if (zoneQuery && !defect.zone.toLowerCase().includes(zoneQuery)) {
        return false;
      }

      return true;
    });
  }, [activeProject.defects, defectStatusFilter, defectZoneFilter]);
  const visibleDrawingSheets = useMemo(() => {
    const drawingQuery = drawingSearchFilter.trim().toLowerCase();

    return activeProject.drawingSheets.filter((drawing) => {
      if (drawingTypeFilter !== "all" && drawing.drawingType !== drawingTypeFilter) {
        return false;
      }

      if (!drawingQuery) {
        return true;
      }

      return [drawing.title, drawing.sheetNumber, drawing.revision, drawing.discipline]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(drawingQuery));
    });
  }, [activeProject.drawingSheets, drawingSearchFilter, drawingTypeFilter]);
  const visibleMembers = useMemo(() => {
    if (memberRoleFilter === "all") {
      return activeProject.members;
    }

    return activeProject.members.filter((member) => member.role === memberRoleFilter);
  }, [activeProject.members, memberRoleFilter]);

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
  const visibleOverallTotal = visibleFinancialRecords.reduce((sum, record) => sum + record.amount, 0);
  const visibleAwaitingReviewTotal = visibleFinancialRecords
    .filter((record) => record.status === "submitted")
    .reduce((sum, record) => sum + record.amount, 0);
  const visibleApprovedTotal = visibleFinancialRecords
    .filter((record) => record.status === "approved" || record.status === "paid")
    .reduce((sum, record) => sum + record.amount, 0);
  const defectZoneNames = Array.from(
    new Set(
      [...activeProject.defectZones.map((zone) => zone.name), ...activeProject.defects.map((defect) => defect.zone).filter(Boolean)].sort((a, b) =>
        a.localeCompare(b)
      )
    )
  );
  const drawingLinksByRecord = useMemo(() => {
    return activeProject.drawingLinks.reduce<Record<string, ProjectBundle["drawingLinks"]>>((accumulator, link) => {
      const key = `${link.recordType}:${link.recordId}`;
      if (!accumulator[key]) {
        accumulator[key] = [];
      }
      accumulator[key].push(link);
      return accumulator;
    }, {});
  }, [activeProject.drawingLinks]);
  const defectsById = useMemo(() => new Map(activeProject.defects.map((defect) => [defect.id, defect])), [activeProject.defects]);
  const aiSiteObservationsById = useMemo(
    () => new Map(activeProject.aiSiteObservations.map((observation) => [observation.id, observation])),
    [activeProject.aiSiteObservations]
  );
  const heatmapDrawing = useMemo(
    () => activeProject.drawingSheets.find((drawing) => drawing.id === heatmapDrawingId) ?? null,
    [activeProject.drawingSheets, heatmapDrawingId]
  );
  const heatmapLinks = useMemo(() => {
    if (!heatmapDrawingId) {
      return [];
    }

    return activeProject.drawingLinks.filter(
      (link) =>
        link.drawingSheetId === heatmapDrawingId &&
        link.xCoordinate !== null &&
        link.yCoordinate !== null &&
        (link.recordType === "ai_site_observation" || link.recordType === "defect")
    );
  }, [activeProject.drawingLinks, heatmapDrawingId]);
  const heatmapDefectCountByPoint = useMemo(() => {
    const counts = new Map<string, number>();

    heatmapLinks.forEach((link) => {
      if (link.recordType !== "defect") {
        return;
      }

      const pointKey = getDrawingPointKey(link);
      counts.set(pointKey, (counts.get(pointKey) ?? 0) + 1);
    });

    return counts;
  }, [heatmapLinks]);
  const activeHeatmapLink = useMemo(
    () => heatmapLinks.find((link) => link.id === activeHeatmapLinkId) ?? null,
    [activeHeatmapLinkId, heatmapLinks]
  );
  const activeHeatmapObservation =
    activeHeatmapLink?.recordType === "ai_site_observation" ? aiSiteObservationsById.get(activeHeatmapLink.recordId) ?? null : null;
  const activeHeatmapDefect = activeHeatmapLink?.recordType === "defect" ? defectsById.get(activeHeatmapLink.recordId) ?? null : null;
  const heatmapDrawingFileUrl = heatmapDrawing?.filePublicUrl ?? null;
  const isHeatmapDrawingPdf = Boolean(
    heatmapDrawing &&
      (heatmapDrawing.filePath.toLowerCase().endsWith(".pdf") ||
        heatmapDrawingFileUrl
          ?.toLowerCase()
          .split("?")[0]
          ?.endsWith(".pdf"))
  );
  const selectedSmartCameraMode = SMART_CAMERA_MODES.find((mode) => mode.key === smartCameraMode) ?? SMART_CAMERA_MODES[0];
  const matchingAiPreviousObservations = useMemo(() => {
    const locationKey = normalizeAiComparisonValue(aiSiteLocation);
    const tradeKey = normalizeAiComparisonValue(aiSiteTrade);

    if (!locationKey || !tradeKey) {
      return [];
    }

    return activeProject.aiSiteObservations
      .filter(
        (observation) =>
          observation.imagePath &&
          normalizeAiComparisonValue(observation.location) === locationKey &&
          normalizeAiComparisonValue(observation.trade) === tradeKey
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [activeProject.aiSiteObservations, aiSiteLocation, aiSiteTrade]);
  const aiObservationGroups = useMemo(() => {
    const sorted = [...activeProject.aiSiteObservations].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const pending = sorted.filter((observation) => observation.status === "pending" || observation.status === "reviewed");
    const approved = sorted.filter((observation) => observation.status === "approved" || observation.status === "converted");
    const dismissed = sorted.filter((observation) => observation.status === "dismissed");

    return { pending, approved, dismissed, all: sorted };
  }, [activeProject.aiSiteObservations]);
  const aiProjectInsights = useMemo(() => {
    const issueMap = new Map<string, AiInsightGroup>();
    const tradeMap = new Map<string, AiInsightGroup>();
    const locationMap = new Map<string, AiInsightGroup>();
    const zoneRiskMap = new Map<string, RiskSignalInput>();
    const progressTrend = {
      improved: 0,
      unchanged: 0,
      delayed: 0,
      worsened: 0,
      unknown: 0
    };
    let recurringObservationCount = 0;
    let openDefectCount = 0;
    let worseningProgressCount = 0;
    let delayedProgressCount = 0;

    const getZoneRisk = (identity: { key: string; label: string }) => {
      const existing = zoneRiskMap.get(identity.key);
      if (existing) {
        return existing;
      }

      const riskInput: RiskSignalInput = {
        key: identity.key,
        label: identity.label,
        recurringIssuesCount: 0,
        openDefects: 0,
        worseningProgressCount: 0,
        delayedProgressCount: 0
      };
      zoneRiskMap.set(identity.key, riskInput);
      return riskInput;
    };

    activeProject.aiSiteObservations.forEach((observation) => {
      const recurringCount = observation.isRecurringIssue ? Math.max(observation.recurrenceCount, 1) : 0;
      if (observation.isRecurringIssue) recurringObservationCount += 1;
      progressTrend[observation.progressStatus] += 1;
      if (observation.progressStatus === "worsened") worseningProgressCount += 1;
      if (observation.progressStatus === "delayed") delayedProgressCount += 1;

      const issueLabel = formatSectionLabel(observation.detectedType || "site_observation");
      const trade = observation.trade || observation.rectification.responsibleTrade || "Unassigned trade";
      const location = observation.location || "Unassigned location";
      const example = observation.aiSummary || observation.recurrenceSummary || observation.progressDeltaSummary;
      const locationIdentity = getInsightIdentity(location, "Unassigned location");
      const zoneRisk = getZoneRisk(locationIdentity);
      zoneRisk.recurringIssuesCount += recurringCount;
      if (observation.progressStatus === "worsened") zoneRisk.worseningProgressCount += 1;
      if (observation.progressStatus === "delayed") zoneRisk.delayedProgressCount += 1;

      addInsightGroupEntry(issueMap, getInsightIdentity(issueLabel, "Site observation"), {
        source: "ai",
        example,
        recurringCount
      });
      addInsightGroupEntry(tradeMap, getInsightIdentity(trade, "Unassigned trade"), {
        source: "ai",
        example,
        recurringCount
      });
      addInsightGroupEntry(locationMap, locationIdentity, {
        source: "ai",
        example,
        recurringCount
      });
    });

    activeProject.defects.forEach((defect) => {
      const isOpenDefect = defect.status !== "closed";
      if (isOpenDefect) openDefectCount += 1;

      const issue = defect.title || "Defect";
      const trade = defect.rectification.responsibleTrade || "Unassigned trade";
      const location = defect.zone || "Unassigned location";
      const example = defect.details || defect.rectification.rootCause || defect.title;
      const locationIdentity = getInsightIdentity(location, "Unassigned location");

      if (isOpenDefect) {
        getZoneRisk(locationIdentity).openDefects += 1;
      }

      addInsightGroupEntry(issueMap, getInsightIdentity(issue, "Defect"), {
        source: "defect",
        example,
        isOpenDefect
      });
      addInsightGroupEntry(tradeMap, getInsightIdentity(trade, "Unassigned trade"), {
        source: "defect",
        example,
        isOpenDefect
      });
      addInsightGroupEntry(locationMap, locationIdentity, {
        source: "defect",
        example,
        isOpenDefect
      });
    });

    const issueGroups = sortInsightGroups(Array.from(issueMap.values()));
    const tradeGroups = sortInsightGroups(Array.from(tradeMap.values()));
    const locationGroups = sortInsightGroups(Array.from(locationMap.values()));
    const topRecurringIssues = issueGroups.filter((group) => group.recurringCount > 0 || group.count > 1).slice(0, 5);
    const projectRisk = calculateRiskScore({
      key: activeProject.overview.id || "project",
      label: activeProject.overview.name || "Project",
      recurringIssuesCount: recurringObservationCount,
      openDefects: openDefectCount,
      worseningProgressCount,
      delayedProgressCount
    });
    const zoneRisks = sortRiskScores(Array.from(zoneRiskMap.values()).map((riskInput) => calculateRiskScore(riskInput)));

    return {
      totalSignals: activeProject.aiSiteObservations.length + activeProject.defects.length,
      aiObservationCount: activeProject.aiSiteObservations.length,
      defectCount: activeProject.defects.length,
      recurringObservationCount,
      recurringGroupCount: topRecurringIssues.length,
      openDefectCount,
      worseningProgressCount,
      delayedProgressCount,
      projectRisk,
      zoneRisks,
      progressTrend,
      topRecurringIssues,
      tradeGroups: tradeGroups.slice(0, 6),
      locationGroups: locationGroups.slice(0, 6)
    };
  }, [activeProject.aiSiteObservations, activeProject.defects]);
  const visibleZoneRisks = useMemo(() => {
    if (aiInsightRiskFilter === "all") {
      return aiProjectInsights.zoneRisks;
    }

    return aiProjectInsights.zoneRisks.filter((risk) => risk.riskLevel === aiInsightRiskFilter);
  }, [aiInsightRiskFilter, aiProjectInsights.zoneRisks]);
  const visibleAiObservationGroups =
    aiObservationFilter === "all"
      ? [
          { key: "pending" as const, title: "Draft / pending review", observations: aiObservationGroups.pending },
          { key: "approved" as const, title: "Approved", observations: aiObservationGroups.approved },
          { key: "dismissed" as const, title: "Dismissed", observations: aiObservationGroups.dismissed }
        ]
      : [
          {
            key: aiObservationFilter,
            title:
              aiObservationFilter === "pending"
                ? "Draft / pending review"
                : aiObservationFilter === "approved"
                  ? "Approved"
                  : "Dismissed",
            observations: aiObservationGroups[aiObservationFilter]
          }
        ];
  const visibleModuleEntries = [
    { key: "overview", label: "Overview", href: "#overview" },
    { key: "contractor_submissions", label: "Documents Submission", href: "#contractor-submissions" },
    { key: "handover", label: "Pre-Handover Survey", href: "#handover" },
    { key: "daily_reports", label: "Daily Reports", href: "#daily" },
    { key: "weekly_reports", label: "Weekly Reports", href: "#weekly" },
    { key: "financials", label: "Financials", href: "#financials" },
    { key: "completion", label: "Completion", href: "#completion" },
    { key: "defects", label: "Defects", href: "#defects" },
    { key: "site_intelligence", label: "AI Site Intelligence", href: "#site-intelligence" }
  ] satisfies Array<{ key: ModuleKey; label: string; href: string }>;

  const enabledModuleEntries = visibleModuleEntries.filter((entry) => moduleAccess[entry.key]);
  const overviewPanelEntry = enabledModuleEntries.find((entry) => entry.key === "overview");
  const deliveryModuleEntries = enabledModuleEntries.filter((entry) => entry.key !== "overview");
  const projectSetupPanelEntries =
    moduleAccess.overview && activeProject.overview.id
      ? PROJECT_SETUP_PHASES.map((phase) => ({
          key: phase.key,
          label: phase.label,
          href: phase.href,
          sector: "project_setup" as const
        }))
      : [];
  const drawingPanelEntries = activeProject.overview.id
    ? ([{ key: "drawing_register", label: "Drawing Register", href: "#drawing-register" }] satisfies Array<{
        key: Extract<DashboardPanelKey, "drawing_register">;
        label: string;
        href: string;
      }>)
    : [];
  const insightPanelEntries = moduleAccess.site_intelligence
    ? ([{ key: "ai_insights", label: "AI Insights", href: "#ai-insights" }] satisfies Array<{
        key: Extract<DashboardPanelKey, "ai_insights">;
        label: string;
        href: string;
      }>)
    : [];
  const projectDeliveryPanelEntries = [
    ...(overviewPanelEntry ? [{ ...overviewPanelEntry, sector: "project_delivery" as const }] : []),
    ...deliveryModuleEntries.map((entry) => ({ ...entry, sector: "project_delivery" as const })),
    ...drawingPanelEntries.map((entry) => ({ ...entry, sector: "project_delivery" as const })),
    ...insightPanelEntries.map((entry) => ({ ...entry, sector: "project_delivery" as const }))
  ] satisfies DashboardPanelEntry[];
  const basePanelEntries = [...projectDeliveryPanelEntries, ...projectSetupPanelEntries] satisfies DashboardPanelEntry[];
  const panelEntries = (
    viewer?.role === "master_admin" && activeProject.overview.id
      ? [...basePanelEntries, { key: "access_control", label: "Access Control", href: "#access-control", sector: "project_delivery" as const }]
      : basePanelEntries
  ) satisfies DashboardPanelEntry[];
  const availableDashboardSectors = DASHBOARD_SECTOR_OPTIONS.filter((option) =>
    panelEntries.some((entry) => entry.sector === option.key)
  );
  const resolvedDashboardSector = availableDashboardSectors.some((option) => option.key === activeDashboardSector)
    ? activeDashboardSector
    : availableDashboardSectors[0]?.key ?? "project_delivery";
  const sectorPanelEntries = panelEntries.filter((entry) => entry.sector === resolvedDashboardSector);
  const activePanel = panelEntries.find((entry) => entry.key === activePanelKey) ?? panelEntries[0] ?? null;
  const activeProjectSetupPhase = PROJECT_SETUP_PHASES.find((phase) => phase.key === activePanel?.key) ?? null;
  const activeExportModuleKey =
    activePanel && MODULE_KEYS.includes(activePanel.key as ModuleKey) ? (activePanel.key as ModuleKey) : null;
  const canExportActivePanel = Boolean(activeProject.overview.id && (activeExportModuleKey || activeProjectSetupPhase));
  const isOverviewCreatePanelOpen = Boolean(openCreatePanelKey?.startsWith("overview-"));
  const overviewEditingContractor =
    overviewEditTarget?.kind === "contractor"
      ? activeProject.projectContractors.find((contractor) => contractor.id === overviewEditTarget.id) ?? null
      : null;
  const overviewEditingConsultant =
    overviewEditTarget?.kind === "consultant"
      ? activeProject.projectConsultants.find((consultant) => consultant.id === overviewEditTarget.id) ?? null
      : null;
  const overviewEditingMilestone =
    overviewEditTarget?.kind === "milestone"
      ? activeProject.milestones.find((milestone) => milestone.id === overviewEditTarget.id) ?? null
      : null;
  const mobileCreateActions = [
    ...(activePanelKey === "overview" && canManageOverviewTeams
      ? [
          { key: "overview-details", label: "Project details" },
          { key: "overview-contractor", label: "Contractor" },
          { key: "overview-consultant", label: "Consultant" },
          { key: "overview-milestone", label: "Milestone" }
        ]
      : []),
    ...(activePanelKey === "contractor_submissions"
      ? [
          { key: "contractor-documents", label: "Contractor document", disabled: !canCreateContractorSubmissions },
          { key: "consultant-documents", label: "Consultant document", disabled: !canCreateConsultantSubmissions }
        ]
      : []),
    ...(activeProjectSetupPhase
      ? [{ key: getProjectSetupCreateKey(activeProjectSetupPhase.phase), label: `${activeProjectSetupPhase.label} item` }]
      : []),
    ...(activePanelKey === "handover" ? [{ key: "handover", label: "Survey item" }] : []),
    ...(activePanelKey === "daily_reports" ? [{ key: "daily-reports", label: "Daily report" }] : []),
    ...(activePanelKey === "weekly_reports" ? [{ key: "weekly-reports", label: "Weekly report" }] : []),
    ...(activePanelKey === "financials" && canCreateFinancialRecords ? [{ key: "financials", label: "Financial submission" }] : []),
    ...(activePanelKey === "completion" ? [{ key: "completion", label: "Checklist batch" }] : []),
    ...(activePanelKey === "defects" ? [{ key: "defects", label: "Defect batch" }] : []),
    ...(activePanelKey === "drawing_register" ? [{ key: "drawing-register", label: "Drawing sheet" }] : []),
    ...(activePanelKey === "access_control" && viewer?.role === "master_admin" ? [{ key: "access-control", label: "Project access" }] : [])
  ];
  const availableMobileCreateActions = mobileCreateActions.filter((action) => !action.disabled);
  const hasOpenMobileCreatePanel = availableMobileCreateActions.some((action) => action.key === openCreatePanelKey);

  useEffect(() => {
    if (activePanelKey !== activePanel?.key) {
      setActivePanelKey(activePanel?.key ?? "overview");
    }
  }, [activePanel?.key, activePanelKey]);

  useEffect(() => {
    if (activePanel?.sector && activePanel.sector !== activeDashboardSector) {
      setActiveDashboardSector(activePanel.sector);
    }
  }, [activeDashboardSector, activePanel?.sector]);

  useEffect(() => {
    if (!activeProject.overview.id || typeof window === "undefined") {
      return;
    }

    const prefix = `projectaxis:smart-camera:${activeProject.overview.id}`;
    const lastLocation = window.localStorage.getItem(`${prefix}:location`) ?? "";
    const lastTrade = window.localStorage.getItem(`${prefix}:trade`) ?? "";
    const lastMode = window.localStorage.getItem(`${prefix}:mode`);

    setAiSiteLocation(lastLocation);
    setAiSiteTrade(lastTrade);

    if (lastMode === "defect" || lastMode === "progress" || lastMode === "inspection") {
      setSmartCameraMode(lastMode);
    } else {
      setSmartCameraMode("defect");
    }
  }, [activeProject.overview.id]);

  useEffect(() => {
    if (
      aiPreviousObservationId !== "auto" &&
      aiPreviousObservationId !== "none" &&
      !matchingAiPreviousObservations.some((observation) => observation.id === aiPreviousObservationId)
    ) {
      setAiPreviousObservationId("auto");
    }
  }, [aiPreviousObservationId, matchingAiPreviousObservations]);

  useEffect(() => {
    function syncPanelFromHash() {
      const hashEntry = panelEntries.find((entry) => entry.href === window.location.hash);
      if (hashEntry && hashEntry.key !== activePanelKey) {
        setActivePanelKey(hashEntry.key);
      }
    }

    syncPanelFromHash();
    window.addEventListener("hashchange", syncPanelFromHash);

    return () => {
      window.removeEventListener("hashchange", syncPanelFromHash);
    };
  }, [activePanelKey, panelEntries]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("projectaxis:notifications", {
        detail: {
          notifications: activeProject.notifications
        }
      })
    );
  }, [activeProject.notifications]);

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

  function handleDashboardSectorSelect(sector: DashboardSectorKey) {
    setActiveDashboardSector(sector);
    setIsMobileModuleListOpen(false);
    setIsMobileCreateMenuOpen(false);

    if (activePanel?.sector === sector) {
      return;
    }

    const nextEntry = panelEntries.find((entry) => entry.sector === sector);
    if (nextEntry) {
      handlePanelSelect(nextEntry.key, nextEntry.href);
    }
  }

  function handleMobilePanelSelect(key: DashboardPanelKey, href: string) {
    setIsMobileModuleListOpen(false);
    setIsMobileCreateMenuOpen(false);
    handlePanelSelect(key, href);
  }

  function handleMobileCreateToggle() {
    if (!availableMobileCreateActions.length) {
      return;
    }

    setIsMobileModuleListOpen(false);
    setOpenAiAssistantKey(null);
    setOpenFilterPanelKey(null);
    setOverviewActionMenuKey(null);

    if (hasOpenMobileCreatePanel) {
      setOpenCreatePanelKey(null);
      setIsMobileCreateMenuOpen(false);
      return;
    }

    if (availableMobileCreateActions.length === 1) {
      setOpenCreatePanelKey(availableMobileCreateActions[0].key);
      setIsMobileCreateMenuOpen(false);
      return;
    }

    setIsMobileCreateMenuOpen((current) => !current);
  }

  function handleMobileCreateActionSelect(key: string) {
    setOpenAiAssistantKey(null);
    setOpenFilterPanelKey(null);
    setOverviewEditTarget(null);
    setOverviewActionMenuKey(null);
    setOpenCreatePanelKey(key);
    setIsMobileCreateMenuOpen(false);
    setIsMobileModuleListOpen(false);
  }

  function toggleModuleAiAssistant(key: DashboardPanelKey) {
    setOpenCreatePanelKey(null);
    setOverviewEditTarget(null);
    setOverviewActionMenuKey(null);
    setOpenFilterPanelKey(null);
    setIsMobileCreateMenuOpen(false);
    setIsMobileModuleListOpen(false);
    setOpenAiAssistantKey((current) => (current === key ? null : key));
  }

  function toggleModuleFilter(key: DashboardPanelKey) {
    setOpenCreatePanelKey(null);
    setOverviewEditTarget(null);
    setOverviewActionMenuKey(null);
    setOpenAiAssistantKey(null);
    setIsMobileCreateMenuOpen(false);
    setIsMobileModuleListOpen(false);
    setOpenFilterPanelKey((current) => (current === key ? null : key));
  }

  function toggleOverviewCreatePanel() {
    setOpenAiAssistantKey(null);
    setOpenFilterPanelKey(null);
    setIsMobileCreateMenuOpen(false);
    setIsMobileModuleListOpen(false);
    setOverviewEditTarget(null);
    setOverviewActionMenuKey(null);
    setOpenCreatePanelKey((current) => (current?.startsWith("overview-") ? null : "overview-details"));
  }

  function openOverviewEditPanel(target: Exclude<OverviewEditTarget, null>) {
    setOpenAiAssistantKey(null);
    setOpenFilterPanelKey(null);
    setIsMobileCreateMenuOpen(false);
    setIsMobileModuleListOpen(false);
    setOverviewActionMenuKey(null);
    setOverviewEditTarget(target);
    setOpenCreatePanelKey(`overview-${target.kind}`);
  }

  function closeOverviewEditPanel() {
    setOpenCreatePanelKey(null);
    setOverviewEditTarget(null);
    setOverviewActionMenuKey(null);
    setIsMobileCreateMenuOpen(false);
  }

  async function handleModuleAiAssistantSubmit(event: FormEvent<HTMLFormElement>, moduleName: string, key: DashboardPanelKey) {
    event.preventDefault();
    resetMessages();

    const formData = new FormData(event.currentTarget);
    const prompt = String(formData.get("aiPrompt") ?? "").trim();
    const files = formData.getAll("aiFiles").filter((value): value is File => value instanceof File && value.size > 0);

    if (!prompt) {
      setModuleAiErrors((current) => ({ ...current, [key]: "Enter a prompt before asking AI." }));
      return;
    }

    formData.set("moduleName", moduleName);
    setModuleAiLoadingKey(key);
    setModuleAiErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });

    try {
      const response = await fetch("/api/ai/module-assistant", {
        method: "POST",
        body: formData
      });
      const payload = (await response.json()) as { result?: string; error?: string; mode?: "demo" | "live" };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to run the module AI assistant.");
      }

      setModuleAiResults((current) => ({ ...current, [key]: payload.result ?? "" }));
      setFeedback(`${moduleName} AI draft prepared${payload.mode === "demo" ? " in demo mode" : ""}.`);
    } catch (caughtError) {
      setModuleAiErrors((current) => ({
        ...current,
        [key]: caughtError instanceof Error ? caughtError.message : "Unable to run the module AI assistant."
      }));
    } finally {
      setModuleAiLoadingKey((current) => (current === key ? null : current));
    }
  }

  function getModuleAiPanelProps(key: DashboardPanelKey, moduleName: string) {
    return {
      error: moduleAiErrors[key] ?? null,
      isLoading: moduleAiLoadingKey === key,
      moduleName,
      onSubmit: (event: FormEvent<HTMLFormElement>) => handleModuleAiAssistantSubmit(event, moduleName, key),
      result: moduleAiResults[key] ?? null
    };
  }

  function handleContractorSubmissionStatusFilterChange(filter: ContractorSubmissionStatusFilter) {
    setContractorSubmissionStatusFilter(filter);
    setSelectedContractorDocumentIds([]);
  }

  function clearContractorSubmissionFilters() {
    setContractorSubmissionStatusFilter("all");
    setContractorSubmissionDateFrom("");
    setContractorSubmissionDateTo("");
    setSelectedContractorDocumentIds([]);
  }

  function renderModuleFilterPanel(key: DashboardPanelKey, moduleName: string) {
    const renderShell = (shownLabel: string, onClear: () => void, children: ReactNode) => (
      <div className="filter-panel compact-filter-panel top-gap" aria-label={`${moduleName} filters`}>
        <div className="filter-panel-header">
          <div>
            <p className="eyebrow">Filter</p>
            <strong>{shownLabel}</strong>
          </div>
          <button className="ghost-button compact-clear-button" onClick={onClear} type="button">
            Clear
          </button>
        </div>
        {children}
      </div>
    );

    if (isProjectSetupPanelKey(key)) {
      const phase = PROJECT_SETUP_PHASES.find((entry) => entry.key === key);
      if (!phase) return null;

      return renderShell(
        `${getVisibleProjectSetupRecords(phase.phase).length} shown`,
        () => {
          setProjectSetupStatusFilter("all");
          setProjectSetupDateFrom("");
          setProjectSetupDateTo("");
          setProjectSetupSearchFilter("");
        },
        <div className="filter-panel-grid">
          <label className="field">
            <span>Status</span>
            <select
              onChange={(event) => setProjectSetupStatusFilter(event.currentTarget.value as ProjectSetupStatusFilter)}
              value={projectSetupStatusFilter}
            >
              <option value="all">All statuses</option>
              {PROJECT_SETUP_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>From due</span>
            <input onChange={(event) => setProjectSetupDateFrom(event.currentTarget.value)} type="date" value={projectSetupDateFrom} />
          </label>
          <label className="field">
            <span>To due</span>
            <input onChange={(event) => setProjectSetupDateTo(event.currentTarget.value)} type="date" value={projectSetupDateTo} />
          </label>
          <label className="field field-full">
            <span>Search</span>
            <input
              onChange={(event) => setProjectSetupSearchFilter(event.currentTarget.value)}
              placeholder="Item, category, owner, notes"
              value={projectSetupSearchFilter}
            />
          </label>
        </div>
      );
    }

    if (key === "contractor_submissions") {
      return renderShell(
        `${visibleContractorSubmissions.length} shown`,
        clearContractorSubmissionFilters,
        <>
          <div className="filter-toggle-group" role="group" aria-label="Status filter">
            {CONTRACTOR_SUBMISSION_STATUS_FILTERS.map((filter) => (
              <button
                className={cn("filter-toggle-button", contractorSubmissionStatusFilter === filter.value && "is-active")}
                key={filter.value}
                onClick={() => handleContractorSubmissionStatusFilterChange(filter.value)}
                type="button"
              >
                <span>{filter.label}</span>
                <span>{contractorSubmissionStatusCounts[filter.value]}</span>
              </button>
            ))}
          </div>
          <div className="filter-panel-grid">
            <label className="field">
              <span>From date</span>
              <input
                onChange={(event) => {
                  setContractorSubmissionDateFrom(event.currentTarget.value);
                  setSelectedContractorDocumentIds([]);
                }}
                type="date"
                value={contractorSubmissionDateFrom}
              />
            </label>
            <label className="field">
              <span>To date</span>
              <input
                onChange={(event) => {
                  setContractorSubmissionDateTo(event.currentTarget.value);
                  setSelectedContractorDocumentIds([]);
                }}
                type="date"
                value={contractorSubmissionDateTo}
              />
            </label>
          </div>
        </>
      );
    }

    if (key === "handover") {
      return renderShell(
        `${visibleSurveyItems.length} shown`,
        () => setSurveyStatusFilter("all"),
        <label className="field">
          <span>Status</span>
          <select onChange={(event) => setSurveyStatusFilter(event.currentTarget.value as SurveyStatusFilter)} value={surveyStatusFilter}>
            {SURVEY_STATUS_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (key === "daily_reports") {
      return renderShell(
        `${visibleDailyReports.length} shown`,
        () => {
          setDailyReportDateFrom("");
          setDailyReportDateTo("");
          setDailyReportLocationFilter("");
        },
        <div className="filter-panel-grid">
          <label className="field">
            <span>From date</span>
            <input onChange={(event) => setDailyReportDateFrom(event.currentTarget.value)} type="date" value={dailyReportDateFrom} />
          </label>
          <label className="field">
            <span>To date</span>
            <input onChange={(event) => setDailyReportDateTo(event.currentTarget.value)} type="date" value={dailyReportDateTo} />
          </label>
          <label className="field field-full">
            <span>Location</span>
            <input
              onChange={(event) => setDailyReportLocationFilter(event.currentTarget.value)}
              placeholder="Search location"
              value={dailyReportLocationFilter}
            />
          </label>
        </div>
      );
    }

    if (key === "weekly_reports") {
      return renderShell(
        `${visibleWeeklyReports.length} shown`,
        () => {
          setWeeklyReportDateFrom("");
          setWeeklyReportDateTo("");
        },
        <div className="filter-panel-grid">
          <label className="field">
            <span>From week</span>
            <input onChange={(event) => setWeeklyReportDateFrom(event.currentTarget.value)} type="date" value={weeklyReportDateFrom} />
          </label>
          <label className="field">
            <span>To week</span>
            <input onChange={(event) => setWeeklyReportDateTo(event.currentTarget.value)} type="date" value={weeklyReportDateTo} />
          </label>
        </div>
      );
    }

    if (key === "financials") {
      return renderShell(
        `${visibleFinancialRecords.length} shown`,
        () => {
          setFinancialStatusFilter("all");
          setFinancialTypeFilter("all");
        },
        <div className="filter-panel-grid">
          <label className="field">
            <span>Status</span>
            <select
              onChange={(event) => setFinancialStatusFilter(event.currentTarget.value as FinancialStatusFilter)}
              value={financialStatusFilter}
            >
              {FINANCIAL_STATUS_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Type</span>
            <select onChange={(event) => setFinancialTypeFilter(event.currentTarget.value as FinancialTypeFilter)} value={financialTypeFilter}>
              {FINANCIAL_TYPE_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      );
    }

    if (key === "completion") {
      return renderShell(
        `${visibleCompletionChecklist.length} shown`,
        () => setCompletionStatusFilter("all"),
        <label className="field">
          <span>Status</span>
          <select
            onChange={(event) => setCompletionStatusFilter(event.currentTarget.value as CompletionStatusFilter)}
            value={completionStatusFilter}
          >
            {COMPLETION_STATUS_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (key === "defects") {
      return renderShell(
        `${visibleDefects.length} shown`,
        () => {
          setDefectStatusFilter("all");
          setDefectZoneFilter("");
        },
        <div className="filter-panel-grid">
          <label className="field">
            <span>Status</span>
            <select onChange={(event) => setDefectStatusFilter(event.currentTarget.value as DefectStatusFilter)} value={defectStatusFilter}>
              {DEFECT_STATUS_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Zone</span>
            <input
              list={`defect-zones-${activeProject.overview.id || "default"}`}
              onChange={(event) => setDefectZoneFilter(event.currentTarget.value)}
              placeholder="Search zone"
              value={defectZoneFilter}
            />
          </label>
        </div>
      );
    }

    if (key === "drawing_register") {
      return renderShell(
        `${visibleDrawingSheets.length} shown`,
        () => {
          setDrawingTypeFilter("all");
          setDrawingSearchFilter("");
        },
        <div className="filter-panel-grid">
          <label className="field">
            <span>Drawing type</span>
            <select onChange={(event) => setDrawingTypeFilter(event.currentTarget.value as DrawingTypeFilter)} value={drawingTypeFilter}>
              <option value="all">All drawing types</option>
              {DRAWING_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Search</span>
            <input
              onChange={(event) => setDrawingSearchFilter(event.currentTarget.value)}
              placeholder="Title, sheet, discipline"
              value={drawingSearchFilter}
            />
          </label>
        </div>
      );
    }

    if (key === "site_intelligence") {
      const observationCount =
        aiObservationFilter === "all" ? aiObservationGroups.all.length : aiObservationGroups[aiObservationFilter].length;

      return renderShell(
        `${observationCount} shown`,
        () => setAiObservationFilter("all"),
        <label className="field">
          <span>Observation status</span>
          <select onChange={(event) => setAiObservationFilter(event.currentTarget.value as typeof aiObservationFilter)} value={aiObservationFilter}>
            <option value="all">All observations</option>
            <option value="pending">To review</option>
            <option value="approved">Saved</option>
            <option value="dismissed">Ignored</option>
          </select>
        </label>
      );
    }

    if (key === "ai_insights") {
      return renderShell(
        `${visibleZoneRisks.length} zone(s)`,
        () => setAiInsightRiskFilter("all"),
        <label className="field">
          <span>Risk level</span>
          <select onChange={(event) => setAiInsightRiskFilter(event.currentTarget.value as AiInsightRiskFilter)} value={aiInsightRiskFilter}>
            <option value="all">All risk levels</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
      );
    }

    if (key === "access_control") {
      return renderShell(
        `${visibleMembers.length} shown`,
        () => setMemberRoleFilter("all"),
        <label className="field">
          <span>Role</span>
          <select onChange={(event) => setMemberRoleFilter(event.currentTarget.value as UserRoleFilter)} value={memberRoleFilter}>
            {USER_ROLE_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </label>
      );
    }

    return null;
  }

  function toggleContractorDocumentSelection(submissionId: string) {
    setSelectedContractorDocumentIds((current) =>
      current.includes(submissionId) ? current.filter((id) => id !== submissionId) : [...current, submissionId]
    );
  }

  function toggleVisibleContractorDocumentSelection() {
    const visibleIds = visibleContractorSubmissions.map((submission) => submission.id);

    setSelectedContractorDocumentIds((current) => {
      if (allVisibleContractorDocumentsSelected) {
        return current.filter((id) => !visibleContractorSubmissionIdSet.has(id));
      }

      return Array.from(new Set([...current, ...visibleIds]));
    });
  }

  function handleMobileExport() {
    if (!canExportActivePanel) {
      return;
    }

    if (activePanelKey === "contractor_submissions") {
      setIsMobileModuleListOpen(false);
      setIsMobileCreateMenuOpen(false);
      setOpenCreatePanelKey(null);
      setIsContractorDocumentExportMode((current) => !current);
      return;
    }

    if (activeProjectSetupPhase) {
      handleProjectSetupExport(activeProjectSetupPhase);
      return;
    }

    if (activeExportModuleKey) {
      void handleModuleExport(activeExportModuleKey);
    }
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

  async function sendContractorSubmissionRejectionEmail(input: {
    submission: ProjectBundle["contractorSubmissions"][number];
    reviewerRole: "client" | "consultant";
    reviewNote: string;
  }) {
    if (!isConfigured || !input.submission.ownerEmail) return false;

    try {
      const response = await fetch("/api/notifications/submission-rejected", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          projectId: activeProject.overview.id,
          submissionId: input.submission.id,
          recipientEmail: input.submission.ownerEmail,
          projectName: activeProject.overview.name,
          submissionTitle: getContractorSubmissionHeading(input.submission),
          reviewerRole: getRoleLabel(input.reviewerRole),
          reviewNote: input.reviewNote
        })
      });

      const payload = (await response.json().catch(() => ({}))) as { emailSent?: boolean; error?: string; reason?: string };

      if (!response.ok) {
        console.error("Unable to send contractor submission rejection email.", payload.error ?? response.statusText);
        return false;
      }

      if (!payload.emailSent && payload.reason) {
        console.info("Contractor submission rejection email skipped.", payload.reason);
      }

      return Boolean(payload.emailSent);
    } catch (caughtError) {
      console.error("Unable to send contractor submission rejection email.", caughtError);
      return false;
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
      return formatTitleLabel(items[0]?.submissionType ?? "material_submission");
    }

    return `${items.length || 0} Document Items`;
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
    setContractorSubmissionReviewErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
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

  function isDrawingUploadFile(file: File) {
    const name = file.name.toLowerCase();
    return file.type.startsWith("image/") || file.type === "application/pdf" || name.endsWith(".pdf");
  }

  async function handleDrawingSheetUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const rawFile = formData.get("drawingFile");

    startTransition(async () => {
      let storagePath: string | null = null;

      try {
        const user = await requireConfiguredAndUser();

        if (!activeProject.overview.id) {
          throw new Error("Select a project before uploading drawings.");
        }

        if (!(rawFile instanceof File) || rawFile.size === 0) {
          throw new Error("Choose a drawing PDF or image before uploading.");
        }

        if (!isDrawingUploadFile(rawFile)) {
          throw new Error("Drawing uploads support PDFs and image files only.");
        }

        const [file] = await prepareFreePilotFiles([rawFile], "mixed");
        if (!file || !isDrawingUploadFile(file)) {
          throw new Error("Drawing uploads support PDFs and image files only.");
        }

        const supabase = getConfiguredClient();
        const title = String(formData.get("title") ?? "").trim() || file.name.replace(/\.[^.]+$/, "");
        const drawingType = (String(formData.get("drawingType") ?? "design_drawing") as DrawingType) || "design_drawing";
        const revision = String(formData.get("revision") ?? "").trim();
        const discipline = String(formData.get("discipline") ?? "").trim();
        const sheetNumber = String(formData.get("sheetNumber") ?? "").trim();
        storagePath = `${activeProject.overview.id}/drawing_sheets/${createDraftId("drawing")}-${sanitizeFilename(file.name || "drawing")}`;

        const { error: uploadError } = await supabase.storage.from(PROJECT_FILES_BUCKET).upload(storagePath, file, {
          cacheControl: "3600",
          upsert: false
        });

        if (uploadError) {
          throw uploadError;
        }

        const drawingInsertPayload = {
          project_id: activeProject.overview.id,
          title,
          drawing_type: drawingType,
          revision,
          discipline,
          sheet_number: sheetNumber,
          file_path: storagePath,
          uploaded_by_user_id: user.id
        };
        let insertResponse = await supabase
          .from("drawing_sheets")
          .insert(drawingInsertPayload)
          .select("id, project_id, title, drawing_type, revision, discipline, sheet_number, file_path, uploaded_by_user_id, created_at")
          .single();

        if (isMissingDrawingTypeColumnError(insertResponse.error)) {
          const legacyPayload: Omit<typeof drawingInsertPayload, "drawing_type"> = {
            project_id: drawingInsertPayload.project_id,
            title: drawingInsertPayload.title,
            revision: drawingInsertPayload.revision,
            discipline: drawingInsertPayload.discipline,
            sheet_number: drawingInsertPayload.sheet_number,
            file_path: drawingInsertPayload.file_path,
            uploaded_by_user_id: drawingInsertPayload.uploaded_by_user_id
          };
          insertResponse = await supabase
            .from("drawing_sheets")
            .insert(legacyPayload)
            .select("id, project_id, title, revision, discipline, sheet_number, file_path, uploaded_by_user_id, created_at")
            .single();
        }

        if (insertResponse.error) {
          throw insertResponse.error;
        }

        const data = insertResponse.data;
        if (!data) {
          throw new Error("Drawing sheet could not be created.");
        }

        const { data: publicUrlData } = supabase.storage.from(PROJECT_FILES_BUCKET).getPublicUrl(String(data.file_path));
        const drawingSheet: ProjectBundle["drawingSheets"][number] = {
          id: String(data.id),
          projectId: String(data.project_id),
          title: String(data.title ?? ""),
          drawingType: (typeof data.drawing_type === "string" ? data.drawing_type : drawingType) as DrawingType,
          revision: String(data.revision ?? ""),
          discipline: String(data.discipline ?? ""),
          sheetNumber: String(data.sheet_number ?? ""),
          filePath: String(data.file_path ?? ""),
          filePublicUrl: publicUrlData.publicUrl,
          aiDrawingTitle: "",
          aiDiscipline: "",
          aiLikelyZones: [],
          aiKeyNotes: [],
          aiRisks: [],
          aiSummarizedAt: null,
          uploadedByUserId: typeof data.uploaded_by_user_id === "string" ? data.uploaded_by_user_id : null,
          createdAt: String(data.created_at)
        };

        replaceProject(activeProject.overview.id, (project) => ({
          ...project,
          drawingSheets: [drawingSheet, ...project.drawingSheets.filter((item) => item.id !== drawingSheet.id)]
        }));
        form.reset();
        setFeedback("Drawing sheet uploaded.");
        await logProjectNotification({
          projectId: activeProject.overview.id,
          action: "created",
          section: "Drawing Register",
          title: `Drawing uploaded: ${drawingSheet.title || drawingSheet.sheetNumber || "Untitled drawing"}`,
          details: drawingSheet.sheetNumber
        });
      } catch (caughtError) {
        if (storagePath) {
          try {
            await getConfiguredClient().storage.from(PROJECT_FILES_BUCKET).remove([storagePath]);
          } catch {
            // Ignore cleanup failure; the original upload/save error is more useful.
          }
        }

        const message =
          caughtError instanceof Error && (caughtError.message.includes("drawing_sheets") || caughtError.message.includes("schema cache"))
            ? "Run the Drawing Register Supabase migration before uploading drawings."
            : caughtError instanceof Error
              ? caughtError.message
              : "Unable to upload the drawing sheet.";
        setError(message);
      }
    });
  }

  async function handleDrawingSummaryGenerate(drawing: ProjectBundle["drawingSheets"][number]) {
    resetMessages();
    setDrawingSummaryActionId(drawing.id);

    try {
      await requireConfiguredAndUser();
      const response = await fetch("/api/ai/drawing-summary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ drawingSheetId: drawing.id }),
        credentials: "same-origin"
      });
      const payload = (await response.json()) as {
        error?: string;
        drawingSheetId?: string;
        drawingTitle?: string;
        discipline?: string;
        likelyZones?: unknown;
        keyNotes?: unknown;
        risks?: unknown;
        summarizedAt?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to generate the drawing summary.");
      }

      const nextSummary = {
        aiDrawingTitle: String(payload.drawingTitle ?? ""),
        aiDiscipline: String(payload.discipline ?? ""),
        aiLikelyZones: Array.isArray(payload.likelyZones)
          ? payload.likelyZones.map((item) => String(item ?? "").trim()).filter(Boolean)
          : [],
        aiKeyNotes: Array.isArray(payload.keyNotes) ? payload.keyNotes.map((item) => String(item ?? "").trim()).filter(Boolean) : [],
        aiRisks: Array.isArray(payload.risks) ? payload.risks.map((item) => String(item ?? "").trim()).filter(Boolean) : [],
        aiSummarizedAt: typeof payload.summarizedAt === "string" ? payload.summarizedAt : new Date().toISOString()
      };

      replaceProject(activeProject.overview.id, (project) => ({
        ...project,
        drawingSheets: project.drawingSheets.map((item) => (item.id === drawing.id ? { ...item, ...nextSummary } : item))
      }));
      setFeedback("AI drawing summary saved.");
      await logProjectNotification({
        projectId: activeProject.overview.id,
        action: "updated",
        section: "Drawing Register",
        title: `AI drawing summary saved: ${nextSummary.aiDrawingTitle || drawing.title || drawing.sheetNumber || "Untitled drawing"}`,
        details: nextSummary.aiDiscipline
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to generate the drawing summary.");
    } finally {
      setDrawingSummaryActionId(null);
    }
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
          projectSetupRecords: [],
          contractorSubmissions: [],
          consultantSubmissions: [],
          surveyItems: [],
          dailyReports: [],
          weeklyReports: [],
          financialRecords: [],
          completionChecklist: [],
          defectZones: [],
          defects: [],
          aiSiteObservations: [],
          drawingSheets: [],
          drawingLinks: [],
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
        if (!canManageOverviewTeams) {
          throw new Error("You do not have permission to update overview details.");
        }

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
        if (!canManageOverviewTeams) {
          throw new Error("You do not have permission to add overview milestones.");
        }

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
        if (OVERVIEW_MANAGED_TABLES.has(options.table) && !canManageOverviewTeams) {
          throw new Error("You do not have permission to add overview details.");
        }

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
        if (OVERVIEW_MANAGED_TABLES.has(options.table) && !canManageOverviewTeams) {
          throw new Error("You do not have permission to update overview details.");
        }
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
        options.afterSuccess?.();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to update record.");
      }
    });
  }

  function buildOverviewContractorPayload(formData: FormData) {
    const trades = readSelectedContractorTrades(formData);
    if (!trades.length) {
      throw new Error("Select at least one trade for the contractor entry.");
    }

    return {
      company_name: String(formData.get("companyName") ?? "").trim(),
      contractor_type: String(formData.get("contractorType") ?? "main_contractor") as ContractorPartyType,
      trades
    };
  }

  function handleOverviewContractorSubmit(
    event: React.FormEvent<HTMLFormElement>,
    contractor: ProjectBundle["projectContractors"][number] | null
  ) {
    if (contractor) {
      handleRecordUpdate(event, {
        table: "project_contractors",
        recordId: contractor.id,
        label: "Contractor information updated.",
        buildPayload: buildOverviewContractorPayload,
        select: "id, company_name, contractor_type, trades",
        update: (project, data) => ({
          ...project,
          projectContractors: sortProjectContractors(
            project.projectContractors.map((item) => (item.id === contractor.id ? buildProjectContractorFromRow(data) : item))
          )
        }),
        afterSuccess: closeOverviewEditPanel
      });
      return;
    }

    handleRecordCreate(event, {
      table: "project_contractors",
      label: "Contractor information saved.",
      buildPayload: buildOverviewContractorPayload,
      select: "id, company_name, contractor_type, trades",
      append: (project, data) => ({
        ...project,
        projectContractors: sortProjectContractors([...project.projectContractors, buildProjectContractorFromRow(data)])
      })
    });
  }

  function buildOverviewConsultantPayload(formData: FormData) {
    const trades = readSelectedConsultantTrades(formData);
    if (!trades.length) {
      throw new Error("Select at least one trade for the consultant entry.");
    }

    return {
      company_name: String(formData.get("companyName") ?? "").trim(),
      trades
    };
  }

  function handleOverviewConsultantSubmit(
    event: React.FormEvent<HTMLFormElement>,
    consultant: ProjectBundle["projectConsultants"][number] | null
  ) {
    if (consultant) {
      handleRecordUpdate(event, {
        table: "project_consultants",
        recordId: consultant.id,
        label: "Consultant details updated.",
        buildPayload: buildOverviewConsultantPayload,
        select: "id, company_name, trades",
        update: (project, data) => ({
          ...project,
          projectConsultants: sortProjectConsultants(
            project.projectConsultants.map((item) => (item.id === consultant.id ? buildProjectConsultantFromRow(data) : item))
          )
        }),
        afterSuccess: closeOverviewEditPanel
      });
      return;
    }

    handleRecordCreate(event, {
      table: "project_consultants",
      label: "Consultant details saved.",
      buildPayload: buildOverviewConsultantPayload,
      select: "id, company_name, trades",
      append: (project, data) => ({
        ...project,
        projectConsultants: sortProjectConsultants([...project.projectConsultants, buildProjectConsultantFromRow(data)])
      })
    });
  }

  function handleOverviewMilestoneSubmit(event: React.FormEvent<HTMLFormElement>, milestone: ProjectBundle["milestones"][number] | null) {
    if (milestone) {
      handleRecordUpdate(event, {
        table: "milestones",
        recordId: milestone.id,
        label: "Milestone updated.",
        buildPayload: (formData) => ({
          title: String(formData.get("title") ?? "").trim(),
          due_date: String(formData.get("dueDate") ?? "")
        }),
        select: "id, title, due_date",
        update: (project, data) => ({
          ...project,
          milestones: project.milestones
            .map((item) =>
              item.id === milestone.id
                ? { id: String(data.id), title: String(data.title), dueDate: String(data.due_date) }
                : item
            )
            .sort((left, right) => left.dueDate.localeCompare(right.dueDate))
        }),
        afterSuccess: closeOverviewEditPanel
      });
      return;
    }

    handleMilestoneCreate(event);
  }

  function buildProjectSetupRecordPayload(formData: FormData, phase: ProjectSetupPhase) {
    return {
      phase,
      category: String(formData.get("category") ?? "").trim(),
      title: String(formData.get("title") ?? "").trim(),
      owner: String(formData.get("owner") ?? "").trim(),
      status: String(formData.get("status") ?? "not_started") as ProjectSetupStatus,
      priority: String(formData.get("priority") ?? "normal") as ProjectSetupPriority,
      due_date: String(formData.get("dueDate") ?? "") || null,
      notes: String(formData.get("notes") ?? "").trim()
    };
  }

  function handleProjectSetupRecordCreate(event: React.FormEvent<HTMLFormElement>, phase: ProjectSetupPhaseEntry) {
    handleRecordCreate(event, {
      table: "project_setup_records",
      section: "project_setup_record",
      label: `${phase.label} item saved.`,
      buildPayload: (formData) => buildProjectSetupRecordPayload(formData, phase.phase),
      select: "id, phase, category, title, owner, status, priority, due_date, notes, created_at",
      append: (project, data, attachments) => ({
        ...project,
        projectSetupRecords: sortProjectSetupRecords([
          ...project.projectSetupRecords,
          buildProjectSetupRecordFromRow(data, attachments)
        ])
      }),
      afterSuccess: () => setOpenCreatePanelKey(null)
    });
  }

  function handleProjectSetupRecordUpdate(
    event: React.FormEvent<HTMLFormElement>,
    record: ProjectBundle["projectSetupRecords"][number]
  ) {
    handleRecordUpdate(event, {
      table: "project_setup_records",
      recordId: record.id,
      section: "project_setup_record",
      label: `${getProjectSetupPhaseLabel(record.phase)} item updated.`,
      buildPayload: (formData) => buildProjectSetupRecordPayload(formData, record.phase),
      select: "id, phase, category, title, owner, status, priority, due_date, notes, created_at",
      update: (project, data, attachments) => ({
        ...project,
        projectSetupRecords: sortProjectSetupRecords(
          project.projectSetupRecords.map((item) =>
            item.id === record.id ? buildProjectSetupRecordFromRow(data, [...item.attachments, ...attachments]) : item
          )
        )
      }),
      afterSuccess: () => setEditingProjectSetupRecordId(null)
    });
  }

  function handleDelete(options: {
    table: string;
    recordId: string;
    section?: RecordSectionType;
    confirmMessage?: string;
    remove: (project: ProjectBundle) => ProjectBundle;
  }) {
    if (typeof window !== "undefined") {
      const isConfirmed = window.confirm(options.confirmMessage ?? "Delete this record? This cannot be undone.");

      if (!isConfirmed) {
        return;
      }
    }

    resetMessages();
    startTransition(async () => {
      try {
        await requireConfiguredAndUser();
        if (OVERVIEW_MANAGED_TABLES.has(options.table) && !canManageOverviewTeams) {
          throw new Error("You do not have permission to delete overview details.");
        }

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

    const reviewerRole =
      currentProjectRole === "client" ? "client" : currentProjectRole === "consultant" ? "consultant" : null;
    const noteKey = reviewerRole ? getContractorSubmissionReviewKey(submission.id, reviewerRole) : "";
    const reviewNote = noteKey ? (contractorSubmissionReviewNotes[noteKey] ?? "").trim() : "";

    if (nextStatus === "rejected" && reviewerRole && !reviewNote) {
      setContractorSubmissionReviewErrors((current) => ({
        ...current,
        [noteKey]: "Add a review comment before rejecting this submission."
      }));
      return;
    }

    startTransition(async () => {
      try {
        await requireConfiguredAndUser();

        if (!reviewerRole) {
          throw new Error("Only the client or consultant can change contractor submission approvals.");
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
        setContractorSubmissionReviewErrors((current) => {
          const next = { ...current };
          delete next[noteKey];
          return next;
        });

        const isRejected = nextStatus === "rejected";
        const reviewMessage = isRejected
          ? `${getRoleLabel(reviewerRole)} rejected the contractor submission.`
          : `${getRoleLabel(reviewerRole)} review marked as ${getApprovalLabel(nextStatus).toLowerCase()}.`;
        const notificationDetails = isRejected
          ? `${getContractorSubmissionHeading(submission)} - Comment: ${reviewNote}`
          : getContractorSubmissionHeading(submission);
        await logProjectNotification({
          projectId: activeProject.overview.id,
          action: isRejected ? "rejected" : "updated",
          section: "Contractor Submission",
          title: reviewMessage,
          details: notificationDetails
        });
        const emailSent = isRejected
          ? await sendContractorSubmissionRejectionEmail({
              submission,
              reviewerRole,
              reviewNote
            })
          : false;
        setFeedback(emailSent ? `${reviewMessage} Email sent to ${submission.ownerEmail}.` : reviewMessage);
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
          const rectification = buildRectificationAssistantDraft({
            location: draft.zone,
            title: draft.title,
            details: draft.details
          });
          const { data, error: insertError } = await supabase
            .from("defects")
            .insert({
              project_id: activeProject.overview.id,
              zone: draft.zone,
              title: draft.title,
              status: draft.status,
              details: draft.details
            })
            .select("id, zone, title, status, details, created_at")
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
            followUpDate: null,
            followUpReason: "",
            rectification,
            attachments,
            createdAt: String(data.created_at ?? new Date().toISOString())
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
        link.download = "projectaxis-defect-template.xlsx";
        link.click();
        URL.revokeObjectURL(url);
        setFeedback("Excel defect template downloaded.");
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to generate the defect template.");
      }
    });
  }

  async function handleModuleExport(moduleKey: ModuleKey) {
    resetMessages();

    try {
      if (!activeProject.overview.id) {
        throw new Error("Select a project before exporting.");
      }

      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "ProjectAxis";
      workbook.created = new Date();

      buildModuleExportSheets(activeProject, moduleKey).forEach((sheet) => {
        const rows = sheet.rows.length ? sheet.rows : [{ Status: "No records saved" }];
        const columnNames = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
        const worksheet = workbook.addWorksheet(buildSheetName(sheet.name));

        worksheet.columns = columnNames.map((columnName) => ({
          header: columnName,
          key: columnName,
          width: Math.min(Math.max(columnName.length + 4, 14), 36)
        }));

        worksheet.addRows(rows);
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFEFF6FF" }
        };

        worksheet.columns.forEach((column) => {
          let maxLength = String(column.header ?? "").length;
          column.eachCell?.({ includeEmpty: true }, (cell) => {
            const value = cell.value;
            const text = value === null || value === undefined ? "" : String(value);
            maxLength = Math.max(maxLength, text.length);
            cell.alignment = { vertical: "top", wrapText: true };
          });
          column.width = Math.min(Math.max(maxLength + 2, 14), 48);
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer as BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      downloadBlob(blob, buildExportFilename(activeProject, moduleKey));
      setFeedback(`${MODULE_EXPORT_LABELS[moduleKey]} exported.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to export this module.");
    }
  }

  function handleProjectSetupExport(phase: ProjectSetupPhaseEntry) {
    resetMessages();

    try {
      if (!activeProject.overview.id) {
        throw new Error("Select a project before exporting.");
      }

      const rows = buildProjectSetupExportRows(getVisibleProjectSetupRecords(phase.phase));
      const csvRows = rows.length ? rows : [{ Status: "No records saved" }];
      const blob = new Blob([buildCsvContent(csvRows)], { type: "text/csv;charset=utf-8" });
      const filename = `${sanitizeFilename(activeProject.overview.name || "project")}-${sanitizeFilename(phase.label.toLowerCase().replaceAll(" ", "-"))}.csv`;
      downloadBlob(blob, filename);
      setFeedback(`${phase.label} exported.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to export this project setup module.");
    }
  }

  async function handleSelectedContractorDocumentsExport(format: ExportFormat) {
    resetMessages();

    try {
      const selectedSubmissions = activeProject.contractorSubmissions.filter(
        (submission) => selectedContractorDocumentIds.includes(submission.id) && visibleContractorSubmissionIdSet.has(submission.id)
      );

      if (!selectedSubmissions.length) {
        throw new Error("Select at least one contractor document before exporting.");
      }

      if (format === "csv") {
        const rows = buildContractorSubmissionExportRows(selectedSubmissions, activeProject);
        const blob = new Blob([buildCsvContent(rows)], { type: "text/csv;charset=utf-8" });
        downloadBlob(blob, buildExportFilename(activeProject, "contractor_submissions", "csv"));
      } else {
        const blob = await buildContractorSubmissionPdfBlob(activeProject, selectedSubmissions);
        downloadBlob(blob, buildExportFilename(activeProject, "contractor_submissions", "pdf"));
      }

      setFeedback(`${selectedSubmissions.length} contractor document(s) exported as ${format.toUpperCase()}.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to export the selected contractor documents.");
    }
  }

  function buildAiReportDraft(reportType: AiReportType) {
    const openDefects = activeProject.defects.filter((defect) => defect.status !== "closed");
    const recurringObservations = activeProject.aiSiteObservations.filter((observation) => observation.isRecurringIssue);
    const worseningObservations = activeProject.aiSiteObservations.filter((observation) => observation.progressStatus === "worsened");
    const delayedObservations = activeProject.aiSiteObservations.filter((observation) => observation.progressStatus === "delayed");
    const latestDailyReports = [...activeProject.dailyReports].sort((a, b) => b.reportDate.localeCompare(a.reportDate)).slice(0, 5);
    const latestWeeklyReports = [...activeProject.weeklyReports].sort((a, b) => b.weekEnding.localeCompare(a.weekEnding)).slice(0, 3);
    const reportTitle = getAiReportTypeLabel(reportType);
    const focusSummary =
      reportType === "defects_report"
        ? `This report focuses on ${openDefects.length} open defect(s), recurring defect signals, and follow-up priorities.`
        : reportType === "progress_report"
          ? `This report focuses on progress comparisons: ${aiProjectInsights.progressTrend.improved} improved, ${aiProjectInsights.progressTrend.delayed} delayed, and ${aiProjectInsights.progressTrend.worsened} worsened.`
          : `This weekly summary combines current reports, defects, recurring issues, progress status, and project risk.`;
    const keyIssues = openDefects.slice(0, 6).map((defect, index) => {
      const followUp = getDefectFollowUpSuggestion(defect, todaySnapshot);
      const suffix = followUp ? ` Follow-up: ${formatDate(followUp.followUpDate)} - ${followUp.followUpReason}` : "";
      return `${index + 1}. ${defect.title} (${defect.zone || "No zone"}, ${formatSectionLabel(defect.status)}). ${defect.details || "No details saved."}${suffix}`;
    });
    const recurringProblems = recurringObservations.slice(0, 6).map((observation, index) => {
      const followUp = getAiObservationFollowUpSuggestion(observation, todaySnapshot);
      const suffix = followUp ? ` Follow-up: ${formatDate(followUp.followUpDate)} - ${followUp.followUpReason}` : "";
      return `${index + 1}. ${observation.location || "No location"} / ${observation.trade || "No trade"} - ${
        observation.recurrenceSummary || observation.aiSummary || "Recurring issue detected."
      }${suffix}`;
    });
    const progressItems = [...worseningObservations, ...delayedObservations]
      .slice(0, 6)
      .map(
        (observation, index) =>
          `${index + 1}. ${formatSectionLabel(observation.progressStatus)} at ${observation.location || "No location"} / ${
            observation.trade || "No trade"
          }. ${observation.progressDeltaSummary || observation.aiSummary || "No progress detail saved."}`
      );
    const reportItems = latestDailyReports.map(
      (report, index) => `${index + 1}. ${formatDate(report.reportDate)} - ${report.location || "No location"}: ${report.workDone || "No work summary saved."}`
    );
    const weeklyItems = latestWeeklyReports.map(
      (report, index) => `${index + 1}. Week ending ${formatDate(report.weekEnding)} - ${report.summary || "No weekly summary saved."}`
    );
    const topRecurringGroups = aiProjectInsights.topRecurringIssues.map(
      (group, index) =>
        `${index + 1}. ${group.label}: ${group.count} total signal(s), ${group.recurringCount} recurring, ${group.openDefectCount} open defect(s).`
    );

    return [
      `${reportTitle.toUpperCase()}`,
      `Project: ${activeProject.overview.name || "Untitled project"}`,
      `Generated: ${formatDate(todaySnapshot)}`,
      `Prepared by: ProjectAxis AI Report Generator`,
      "",
      "EXECUTIVE SUMMARY",
      focusSummary,
      aiProjectInsights.projectRisk.riskSummary,
      "",
      "KEY ISSUES",
      ...(keyIssues.length ? keyIssues : ["No open defect issues are currently recorded."]),
      "",
      "RECURRING PROBLEMS",
      ...(recurringProblems.length ? recurringProblems : topRecurringGroups.length ? topRecurringGroups : ["No recurring problems have been detected yet."]),
      "",
      "PROGRESS STATUS",
      `Improved: ${aiProjectInsights.progressTrend.improved}`,
      `Delayed: ${aiProjectInsights.progressTrend.delayed}`,
      `Worsened: ${aiProjectInsights.progressTrend.worsened}`,
      `Unchanged: ${aiProjectInsights.progressTrend.unchanged}`,
      ...(progressItems.length ? ["", ...progressItems] : ["No delayed or worsening progress comparisons are currently recorded."]),
      "",
      "RISK SUMMARY",
      `Risk score: ${aiProjectInsights.projectRisk.riskScore}/100`,
      `Risk level: ${formatSectionLabel(aiProjectInsights.projectRisk.riskLevel)}`,
      aiProjectInsights.projectRisk.riskSummary,
      "",
      "RECENT REPORT INPUTS",
      ...(weeklyItems.length ? ["Weekly reports:", ...weeklyItems] : ["No weekly reports saved."]),
      ...(reportItems.length ? ["", "Daily reports:", ...reportItems] : ["", "No daily reports saved."]),
      "",
      "RECOMMENDED NEXT ACTIONS",
      "1. Review all open defects and confirm ownership with responsible trades.",
      "2. Prioritize recurring issues and any delayed or worsening progress areas.",
      "3. Confirm follow-up dates before issuing this report externally.",
      "4. Attach supporting photos, drawings, or official records where required."
    ].join("\n");
  }

  function handleAiReportGenerate() {
    resetMessages();
    setAiReportError(null);

    if (!activeProject.overview.id) {
      setAiReportError("Select a project before generating a report.");
      return;
    }

    setAiReportDraft(buildAiReportDraft(aiReportType));
    setFeedback(`${getAiReportTypeLabel(aiReportType)} draft generated. Review and edit before exporting.`);
  }

  async function handleAiReportPdfExport() {
    resetMessages();
    setAiReportError(null);

    if (!aiReportDraft.trim()) {
      setAiReportError("Generate and review a report draft before exporting.");
      return;
    }

    setIsAiReportExporting(true);

    try {
      const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
      const pdfDoc = await PDFDocument.create();
      const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const pageSize: [number, number] = [595.28, 841.89];
      const margin = 48;
      const lineHeight = 14;
      const maxLineCharacters = 92;
      let page = pdfDoc.addPage(pageSize);
      let y = pageSize[1] - margin;

      const addPageIfNeeded = (height = lineHeight) => {
        if (y - height < margin) {
          page = pdfDoc.addPage(pageSize);
          y = pageSize[1] - margin;
        }
      };

      aiReportDraft.split(/\r?\n/).forEach((rawLine, index) => {
        const isBlank = !rawLine.trim();
        if (isBlank) {
          y -= lineHeight * 0.75;
          return;
        }

        const isHeading = rawLine === rawLine.toUpperCase() && rawLine.length <= 40;
        const size = index === 0 ? 18 : isHeading ? 12 : 10;
        const font = index === 0 || isHeading ? boldFont : regularFont;
        const color = isHeading || index === 0 ? rgb(0.07, 0.12, 0.22) : rgb(0.16, 0.2, 0.29);
        const wrappedLines = wrapPdfTextLine(rawLine, maxLineCharacters);

        wrappedLines.forEach((line, lineIndex) => {
          addPageIfNeeded(lineHeight);
          page.drawText(line, {
            x: margin,
            y,
            size,
            font,
            color
          });
          y -= lineIndex === wrappedLines.length - 1 && isHeading ? lineHeight * 1.25 : lineHeight;
        });
      });

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = buildPdfSafeFilename(activeProject.overview.name, aiReportType);
      link.click();
      URL.revokeObjectURL(url);
      setFeedback(`${getAiReportTypeLabel(aiReportType)} PDF exported.`);
    } catch (caughtError) {
      setAiReportError(caughtError instanceof Error ? caughtError.message : "Unable to export the report PDF.");
    } finally {
      setIsAiReportExporting(false);
    }
  }

  function handleRectificationAssistantSave(
    event: React.FormEvent<HTMLFormElement>,
    options: {
      recordType: "ai_site_observation" | "defect";
      recordId: string;
    }
  ) {
    event.preventDefault();
    resetMessages();
    setAiObservationQueueError(null);
    setAiObservationQueueSuccess(null);

    const formData = new FormData(event.currentTarget);
    const nextAssistant: RectificationAssistant = {
      rootCause: String(formData.get("rootCause") ?? "").trim(),
      responsibleTrade: String(formData.get("responsibleTrade") ?? "").trim(),
      rectificationSteps: normalizeAssistantLines(String(formData.get("rectificationSteps") ?? "")),
      closureChecklist: normalizeAssistantLines(String(formData.get("closureChecklist") ?? ""))
    };

    startTransition(async () => {
      try {
        await requireConfiguredAndUser();
        const supabase = getConfiguredClient();
        const table = options.recordType === "ai_site_observation" ? "ai_site_observations" : "defects";
        const { error: updateError } = await supabase
          .from(table)
          .update({
            root_cause: nextAssistant.rootCause,
            responsible_trade: nextAssistant.responsibleTrade,
            rectification_steps: nextAssistant.rectificationSteps,
            closure_checklist: nextAssistant.closureChecklist
          })
          .eq("id", options.recordId);

        if (updateError) {
          throw updateError;
        }

        replaceProject(activeProject.overview.id, (project) =>
          options.recordType === "ai_site_observation"
            ? {
                ...project,
                aiSiteObservations: project.aiSiteObservations.map((item) =>
                  item.id === options.recordId ? { ...item, rectification: nextAssistant } : item
                )
              }
            : {
                ...project,
                defects: project.defects.map((item) =>
                  item.id === options.recordId ? { ...item, rectification: nextAssistant } : item
                )
              }
        );

        setFeedback("Rectification assistant saved.");
        setAiObservationQueueSuccess(options.recordType === "ai_site_observation" ? "AI rectification assistant saved." : null);
      } catch (caughtError) {
        const message =
          caughtError instanceof Error && caughtError.message.includes("does not exist")
            ? "Run the AI Rectification Assistant Supabase migration before saving this assistant."
            : caughtError instanceof Error
              ? caughtError.message
              : "Unable to save the rectification assistant.";
        setError(message);
        setAiObservationQueueError(options.recordType === "ai_site_observation" ? message : null);
      }
    });
  }

  function handleDrawingLinkSave(
    event: React.FormEvent<HTMLFormElement>,
    options: {
      recordType: "ai_site_observation" | "defect";
      recordId: string;
    }
  ) {
    event.preventDefault();
    resetMessages();
    setAiObservationQueueError(null);
    setAiObservationQueueSuccess(null);

    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      try {
        const user = await requireConfiguredAndUser();
        const drawingSheetId = String(formData.get("drawingSheetId") ?? "").trim();
        const drawingSheet = activeProject.drawingSheets.find((item) => item.id === drawingSheetId);

        if (!activeProject.overview.id) {
          throw new Error("Select a project before linking drawings.");
        }

        if (!drawingSheet) {
          throw new Error("Select a drawing sheet before saving the link.");
        }

        const xCoordinate = normalizeOptionalCoordinate(formData.get("xCoordinate"));
        const yCoordinate = normalizeOptionalCoordinate(formData.get("yCoordinate"));

        if ((xCoordinate === null) !== (yCoordinate === null)) {
          throw new Error("Enter both X and Y coordinates, or leave both blank.");
        }

        const markupLabel = String(formData.get("markupLabel") ?? "").trim();
        const notes = String(formData.get("notes") ?? "").trim();
        const supabase = getConfiguredClient();
        const { data, error: insertError } = await supabase
          .from("drawing_links")
          .insert({
            project_id: activeProject.overview.id,
            drawing_sheet_id: drawingSheetId,
            record_type: options.recordType,
            record_id: options.recordId,
            x_coordinate: xCoordinate,
            y_coordinate: yCoordinate,
            markup_label: markupLabel,
            notes,
            created_by_user_id: user.id
          })
          .select("id, project_id, drawing_sheet_id, record_type, record_id, x_coordinate, y_coordinate, markup_label, notes, created_by_user_id, created_at")
          .single();

        if (insertError) {
          throw insertError;
        }

        const nextLink: ProjectBundle["drawingLinks"][number] = {
          id: String(data.id),
          projectId: String(data.project_id),
          drawingSheetId: String(data.drawing_sheet_id),
          recordType: options.recordType,
          recordId: String(data.record_id),
          xCoordinate: data.x_coordinate === null || data.x_coordinate === undefined ? null : Number(data.x_coordinate),
          yCoordinate: data.y_coordinate === null || data.y_coordinate === undefined ? null : Number(data.y_coordinate),
          markupLabel: String(data.markup_label ?? ""),
          notes: String(data.notes ?? ""),
          createdByUserId: typeof data.created_by_user_id === "string" ? data.created_by_user_id : null,
          createdAt: String(data.created_at)
        };

        replaceProject(activeProject.overview.id, (project) => ({
          ...project,
          drawingLinks: [nextLink, ...project.drawingLinks.filter((link) => link.id !== nextLink.id)]
        }));
        form.reset();
        setFeedback("Drawing linked.");
        if (options.recordType === "ai_site_observation") {
          setAiObservationQueueSuccess("Drawing linked to AI observation.");
        }

        await logProjectNotification({
          projectId: activeProject.overview.id,
          action: "updated",
          section: "Drawing Register",
          title: `Drawing linked: ${drawingSheet.title || drawingSheet.sheetNumber || "Untitled drawing"}`,
          details: `${formatSectionLabel(options.recordType)} ${options.recordId.slice(0, 8)}`
        });
      } catch (caughtError) {
        const message =
          caughtError instanceof Error && (caughtError.message.includes("drawing_links") || caughtError.message.includes("schema cache"))
            ? "Run the Drawing Register Supabase migration before linking drawings."
            : caughtError instanceof Error
              ? caughtError.message
              : "Unable to link the drawing.";
        setError(message);
        if (options.recordType === "ai_site_observation") {
          setAiObservationQueueError(message);
        }
      }
    });
  }

  async function handleAiSiteObservationAnalyze(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    resetAiAnalysisState();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const image = formData.get("image");
    const location = String(formData.get("location") ?? "").trim();
    const trade = String(formData.get("trade") ?? "").trim();
    const selectedMode = SMART_CAMERA_MODES.find((mode) => mode.key === smartCameraMode) ?? SMART_CAMERA_MODES[0];

    if (!activeProject.overview.id) {
      setAiSiteAnalysisError("Select a project before analyzing site photos.");
      return;
    }

    if (!(image instanceof File) || image.size === 0) {
      setAiSiteAnalysisError("Choose or take a site photo before analyzing.");
      return;
    }

    formData.set("projectId", activeProject.overview.id);
    formData.set("observationMode", selectedMode.key);
    formData.set("detectedTypeHint", selectedMode.detectedTypeHint);
    setIsAiSiteAnalyzing(true);

    try {
      const response = await fetch("/api/ai/site-observation", {
        method: "POST",
        body: formData,
        credentials: "same-origin"
      });
      const payload = (await response.json()) as Partial<AiSiteAnalysisResult> & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to analyze this site photo.");
      }

      const nextResult: AiSiteAnalysisResult = {
        summary: String(payload.summary ?? ""),
        detectedType: String(payload.detectedType ?? "site_observation"),
        confidence: Number(payload.confidence ?? 0),
        suggestedAction: String(payload.suggestedAction ?? ""),
        suggestedTitle: String(payload.suggestedTitle ?? ""),
        suggestedDetails: String(payload.suggestedDetails ?? ""),
        progressStatus: normalizeAiProgressStatus(payload.progressStatus),
        progressDeltaSummary: String(payload.progressDeltaSummary ?? ""),
        comparisonConfidence: Number(payload.comparisonConfidence ?? 0),
        observationId: typeof payload.observationId === "string" ? payload.observationId : null,
        imagePath: typeof payload.imagePath === "string" ? payload.imagePath : null,
        imagePublicUrl: typeof payload.imagePublicUrl === "string" ? payload.imagePublicUrl : null,
        imageName: typeof payload.imageName === "string" ? payload.imageName : null,
        imageMimeType: typeof payload.imageMimeType === "string" ? payload.imageMimeType : null,
        createdAt: typeof payload.createdAt === "string" ? payload.createdAt : null,
        previousObservationId: typeof payload.previousObservationId === "string" ? payload.previousObservationId : null,
        recurrenceGroupId: typeof payload.recurrenceGroupId === "string" ? payload.recurrenceGroupId : null,
        recurrenceCount: Number(payload.recurrenceCount ?? 0),
        recurrenceSummary: String(payload.recurrenceSummary ?? ""),
        isRecurringIssue: Boolean(payload.isRecurringIssue),
        followUpDate: typeof payload.followUpDate === "string" ? payload.followUpDate : null,
        followUpReason: String(payload.followUpReason ?? ""),
        rootCause: String(payload.rootCause ?? ""),
        responsibleTrade: String(payload.responsibleTrade ?? ""),
        rectificationSteps: Array.isArray(payload.rectificationSteps)
          ? payload.rectificationSteps.map((item) => String(item ?? "").trim()).filter(Boolean)
          : [],
        closureChecklist: Array.isArray(payload.closureChecklist)
          ? payload.closureChecklist.map((item) => String(item ?? "").trim()).filter(Boolean)
          : [],
        location,
        trade,
        cameraMode: selectedMode.key
      };

      setAiSiteAnalysisResult(nextResult);
      if (typeof window !== "undefined") {
        const prefix = `projectaxis:smart-camera:${activeProject.overview.id}`;
        window.localStorage.setItem(`${prefix}:location`, location);
        window.localStorage.setItem(`${prefix}:trade`, trade);
        window.localStorage.setItem(`${prefix}:mode`, selectedMode.key);
      }
      if (nextResult.observationId && nextResult.imagePath) {
        replaceProject(activeProject.overview.id, (project) => ({
          ...project,
          aiSiteObservations: [
            {
              id: nextResult.observationId ?? "",
              projectId: activeProject.overview.id,
              createdByUserId: viewer?.id ?? null,
              location,
              trade,
              imagePath: nextResult.imagePath ?? "",
              imagePublicUrl: nextResult.imagePublicUrl,
              aiSummary: nextResult.summary,
              detectedType: nextResult.detectedType,
              confidence: nextResult.confidence,
              status: "pending",
              linkedRecordType: null,
              linkedRecordId: null,
              previousObservationId: nextResult.previousObservationId,
              progressStatus: nextResult.progressStatus,
              progressDeltaSummary: nextResult.progressDeltaSummary,
              comparisonConfidence: nextResult.comparisonConfidence,
              recurrenceGroupId: nextResult.recurrenceGroupId,
              recurrenceCount: nextResult.recurrenceCount,
              recurrenceSummary: nextResult.recurrenceSummary,
              isRecurringIssue: nextResult.isRecurringIssue,
              followUpDate: nextResult.followUpDate,
              followUpReason: nextResult.followUpReason,
              rectification: mergeRectificationAssistant(
                {
                  rootCause: nextResult.rootCause,
                  responsibleTrade: nextResult.responsibleTrade,
                  rectificationSteps: nextResult.rectificationSteps,
                  closureChecklist: nextResult.closureChecklist
                },
                buildRectificationAssistantDraft({
                  location,
                  trade,
                  detectedType: nextResult.detectedType,
                  summary: nextResult.summary,
                  details: nextResult.suggestedDetails
                })
              ),
              createdAt: nextResult.createdAt ?? new Date().toISOString()
            },
            ...project.aiSiteObservations
              .filter((observation) => observation.id !== nextResult.observationId)
              .map((observation) =>
                nextResult.isRecurringIssue &&
                nextResult.recurrenceGroupId &&
                observation.location.trim().toLowerCase() === location.trim().toLowerCase() &&
                observation.trade.trim().toLowerCase() === trade.trim().toLowerCase() &&
                observation.detectedType.trim().toLowerCase() === nextResult.detectedType.trim().toLowerCase()
                  ? {
                      ...observation,
                      recurrenceGroupId: nextResult.recurrenceGroupId,
                      recurrenceCount: nextResult.recurrenceCount,
                      recurrenceSummary: nextResult.recurrenceSummary,
                      isRecurringIssue: true,
                      followUpDate: observation.followUpDate ?? nextResult.followUpDate,
                      followUpReason: observation.followUpReason || nextResult.followUpReason
                    }
                  : observation
              )
          ]
        }));
      }
    } catch (caughtError) {
      setAiSiteAnalysisError(caughtError instanceof Error ? caughtError.message : "Unable to analyze this site photo.");
    } finally {
      setIsAiSiteAnalyzing(false);
    }
  }

  function openAiDailyReportReview() {
    if (!aiSiteAnalysisResult) return;

    const workDone = [aiSiteAnalysisResult.summary, aiSiteAnalysisResult.suggestedDetails].filter(Boolean).join("\n\n");
    setAiDailyReportError(null);
    setAiDailyReportSuccess(null);
    setAiDailyReportDraft({
      reportDate: todaySnapshot,
      location: aiSiteAnalysisResult.location,
      workDone,
      manpowerByTrade: aiSiteAnalysisResult.trade
    });
  }

  function updateAiDailyReportDraft(field: keyof AiDailyReportDraft, value: string) {
    setAiDailyReportDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  async function handleAiDailyReportCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    setAiDailyReportError(null);
    setAiDailyReportSuccess(null);

    if (!aiSiteAnalysisResult || !aiDailyReportDraft) {
      setAiDailyReportError("Run AI analysis and review the daily report details before saving.");
      return;
    }

    if (!aiSiteAnalysisResult.observationId || !aiSiteAnalysisResult.imagePath) {
      setAiDailyReportError("This AI suggestion was not saved as an observation. Analyze the photo again before creating a daily report.");
      return;
    }

    setIsAiDailyReportSaving(true);

    try {
      await requireConfiguredAndUser();
      const supabase = getConfiguredClient();
      const formData = new FormData(event.currentTarget);
      const reportDate = String(formData.get("reportDate") ?? todaySnapshot);
      const location = String(formData.get("location") ?? "").trim();
      const workDone = String(formData.get("workDone") ?? "").trim();
      const manpowerByTrade = String(formData.get("manpowerByTrade") ?? "").trim();

      const { data: report, error: reportError } = await supabase
        .from("daily_reports")
        .insert({
          project_id: activeProject.overview.id,
          report_date: reportDate,
          location,
          work_done: workDone,
          manpower_by_trade: manpowerByTrade
        })
        .select("id, report_date, location, work_done, manpower_by_trade")
        .single();

      if (reportError) {
        throw reportError;
      }

      const attachmentName = aiSiteAnalysisResult.imageName || "AI site observation photo";
      const attachmentMimeType = aiSiteAnalysisResult.imageMimeType || "application/octet-stream";
      const linkedRecordId = String(report.id);
      const attachment = await attachAiSiteObservationImage(supabase, {
        projectId: activeProject.overview.id,
        sectionType: "daily_report",
        recordId: linkedRecordId,
        imagePath: aiSiteAnalysisResult.imagePath,
        name: attachmentName,
        mimeType: attachmentMimeType
      });
      await linkAiSiteObservationToRecord(supabase, {
        observationId: aiSiteAnalysisResult.observationId,
        linkedRecordType: "daily_report",
        linkedRecordId
      });

      replaceProject(activeProject.overview.id, (project) => ({
        ...project,
        dailyReports: [
          {
            id: linkedRecordId,
            reportDate: String(report.report_date),
            location: String(report.location),
            workDone: String(report.work_done ?? ""),
            manpowerByTrade: String(report.manpower_by_trade ?? ""),
            attachments: [attachment]
          },
          ...project.dailyReports
        ],
        aiSiteObservations: project.aiSiteObservations.map((observation) =>
          observation.id === aiSiteAnalysisResult.observationId
            ? {
                ...observation,
                status: "approved",
                linkedRecordType: "daily_report",
                linkedRecordId
              }
            : observation
        )
      }));

      setAiSiteAnalysisResult((current) =>
        current && current.observationId === aiSiteAnalysisResult.observationId ? { ...current } : current
      );
      setAiDailyReportDraft(null);
      setAiDailyReportSuccess("Daily report created from AI suggestion.");
      await logProjectNotification({
        projectId: activeProject.overview.id,
        action: "created",
        section: "Daily Reports",
        title: "Daily report created from AI suggestion.",
        details: location || aiSiteAnalysisResult.suggestedTitle
      });
    } catch (caughtError) {
      setAiDailyReportError(caughtError instanceof Error ? caughtError.message : "Unable to create the daily report.");
    } finally {
      setIsAiDailyReportSaving(false);
    }
  }

  function getAiObservationAttachmentName(observation: ProjectBundle["aiSiteObservations"][number]) {
    const fileName = observation.imagePath.split("/").pop();
    return fileName || "AI site observation photo";
  }

  async function attachAiObservationImage(
    observation: ProjectBundle["aiSiteObservations"][number],
    sectionType: Extract<RecordSectionType, "daily_report" | "defect">,
    recordId: string
  ) {
    const supabase = getConfiguredClient();
    return attachAiSiteObservationImage(supabase, {
      projectId: activeProject.overview.id,
      sectionType,
      recordId,
      imagePath: observation.imagePath,
      name: getAiObservationAttachmentName(observation),
      mimeType: "image/jpeg"
    });
  }

  async function updateAiObservationStatus(
    observation: ProjectBundle["aiSiteObservations"][number],
    status: ProjectBundle["aiSiteObservations"][number]["status"]
  ) {
    resetMessages();
    resetAiQueueMessages();
    setAiObservationActionKey(`${status}:${observation.id}`);

    try {
      await requireConfiguredAndUser();
      const supabase = getConfiguredClient();
      await updateAiSiteObservationStatus(supabase, observation.id, status);

      replaceProject(activeProject.overview.id, (project) => ({
        ...project,
        aiSiteObservations: project.aiSiteObservations.map((item) => (item.id === observation.id ? { ...item, status } : item))
      }));
      setAiObservationQueueSuccess(
        status === "dismissed" ? "AI observation dismissed." : "AI observation marked as reviewed."
      );
      await logProjectNotification({
        projectId: activeProject.overview.id,
        action: "updated",
        section: "AI Site Intelligence",
        title: status === "dismissed" ? "AI observation dismissed." : "AI observation reviewed.",
        details: observation.location || observation.detectedType
      });
    } catch (caughtError) {
      setAiObservationQueueError(caughtError instanceof Error ? caughtError.message : "Unable to update the AI observation.");
    } finally {
      setAiObservationActionKey(null);
    }
  }

  function openAiObservationConversionReview(
    observation: ProjectBundle["aiSiteObservations"][number],
    mode: AiObservationConversionDraft["mode"]
  ) {
    resetMessages();
    resetAiQueueMessages();

    if (observation.linkedRecordType || observation.linkedRecordId) {
      setAiObservationQueueError("This AI observation is already linked to an official record.");
      return;
    }

    if (mode === "daily_report") {
      setAiObservationConversionDraft({
        mode,
        observationId: observation.id,
        reportDate: todaySnapshot,
        location: observation.location,
        workDone: observation.aiSummary,
        manpowerByTrade: observation.trade
      });
      return;
    }

    setAiObservationConversionDraft({
      mode,
      observationId: observation.id,
      zone: observation.location,
      title: `${formatSectionLabel(observation.detectedType || "site_observation")} - ${observation.location || "Site observation"}`,
      status: "open",
      details: observation.aiSummary
    });
  }

  function updateAiObservationConversionDraft(field: string, value: string) {
    setAiObservationConversionDraft((current) => (current ? { ...current, [field]: value } as AiObservationConversionDraft : current));
  }

  async function handleAiObservationConversionCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    resetAiQueueMessages();

    if (!aiObservationConversionDraft) {
      setAiObservationQueueError("Choose an AI observation to convert first.");
      return;
    }

    const observation = activeProject.aiSiteObservations.find((item) => item.id === aiObservationConversionDraft.observationId);
    if (!observation) {
      setAiObservationQueueError("This AI observation is no longer available.");
      return;
    }

    if (observation.linkedRecordType || observation.linkedRecordId) {
      setAiObservationQueueError("This AI observation is already linked to an official record.");
      return;
    }

    setAiObservationActionKey(`convert:${observation.id}`);

    try {
      await requireConfiguredAndUser();
      const supabase = getConfiguredClient();
      const formData = new FormData(event.currentTarget);

      if (aiObservationConversionDraft.mode === "daily_report") {
        const { data: report, error: reportError } = await supabase
          .from("daily_reports")
          .insert({
            project_id: activeProject.overview.id,
            report_date: String(formData.get("reportDate") ?? todaySnapshot),
            location: String(formData.get("location") ?? "").trim(),
            work_done: String(formData.get("workDone") ?? "").trim(),
            manpower_by_trade: String(formData.get("manpowerByTrade") ?? "").trim()
          })
          .select("id, report_date, location, work_done, manpower_by_trade")
          .single();

        if (reportError) {
          throw reportError;
        }

        const linkedRecordId = String(report.id);
        const attachment = await attachAiObservationImage(observation, "daily_report", linkedRecordId);
        await linkAiSiteObservationToRecord(supabase, {
          observationId: observation.id,
          linkedRecordType: "daily_report",
          linkedRecordId
        });

        replaceProject(activeProject.overview.id, (project) => ({
          ...project,
          dailyReports: [
            {
              id: linkedRecordId,
              reportDate: String(report.report_date),
              location: String(report.location),
              workDone: String(report.work_done ?? ""),
              manpowerByTrade: String(report.manpower_by_trade ?? ""),
              attachments: [attachment]
            },
            ...project.dailyReports
          ],
          aiSiteObservations: project.aiSiteObservations.map((item) =>
            item.id === observation.id
              ? { ...item, status: "approved", linkedRecordType: "daily_report", linkedRecordId }
              : item
          )
        }));
        setAiObservationQueueSuccess("Daily report created from AI observation.");
        await logProjectNotification({
          projectId: activeProject.overview.id,
          action: "created",
          section: "Daily Reports",
          title: "Daily report created from AI observation.",
          details: String(report.location ?? observation.location)
        });
      } else {
        const zone = String(formData.get("zone") ?? "").trim();
        if (!zone) {
          throw new Error("A defect zone is required.");
        }
        const defectTitle = String(formData.get("title") ?? "").trim();
        const defectDetails = String(formData.get("details") ?? "").trim();
        const rectification = buildRectificationAssistantDraft({
          location: zone,
          trade: observation.trade,
          title: defectTitle,
          detectedType: observation.detectedType,
          summary: observation.aiSummary,
          details: defectDetails
        });

        await syncDefectZones(activeProject.overview.id, [zone]);
        const { data: defect, error: defectError } = await supabase
          .from("defects")
          .insert({
            project_id: activeProject.overview.id,
            zone,
            title: defectTitle,
            status: String(formData.get("status") ?? "open"),
            details: defectDetails
          })
          .select("id, zone, title, status, details, created_at")
          .single();

        if (defectError) {
          throw defectError;
        }

        const linkedRecordId = String(defect.id);
        const attachment = await attachAiObservationImage(observation, "defect", linkedRecordId);
        await linkAiSiteObservationToRecord(supabase, {
          observationId: observation.id,
          linkedRecordType: "defect",
          linkedRecordId
        });

        replaceProject(activeProject.overview.id, (project) => ({
          ...project,
          defects: [
            {
              id: linkedRecordId,
              zone: String(defect.zone ?? ""),
              title: String(defect.title),
              status: defect.status as DefectStatus,
              details: String(defect.details ?? ""),
              followUpDate: null,
              followUpReason: "",
              rectification,
              attachments: [attachment],
              createdAt: String(defect.created_at ?? new Date().toISOString())
            },
            ...project.defects
          ],
          aiSiteObservations: project.aiSiteObservations.map((item) =>
            item.id === observation.id ? { ...item, status: "approved", linkedRecordType: "defect", linkedRecordId } : item
          )
        }));
        setAiObservationQueueSuccess("Defect created from AI observation.");
        await logProjectNotification({
          projectId: activeProject.overview.id,
          action: "created",
          section: "Defects",
          title: "Defect created from AI observation.",
          details: String(defect.title ?? observation.location)
        });
      }

      setAiObservationConversionDraft(null);
    } catch (caughtError) {
      setAiObservationQueueError(caughtError instanceof Error ? caughtError.message : "Unable to convert the AI observation.");
    } finally {
      setAiObservationActionKey(null);
    }
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
          const rectification = buildRectificationAssistantDraft({
            location: row.zone,
            title: row.title,
            details: row.details
          });
          const { data, error: insertError } = await supabase
            .from("defects")
            .insert({
              project_id: activeProject.overview.id,
              zone: row.zone,
              title: row.title,
              status: row.status,
              details: row.details
            })
            .select("id, zone, title, status, details, created_at")
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
            followUpDate: null,
            followUpReason: "",
            rectification,
            attachments,
            createdAt: String(data.created_at ?? new Date().toISOString())
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
      defects: formData.get("defects") === "on",
      site_intelligence: formData.get("site_intelligence") === "on"
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
          can_defects: modules.defects,
          can_site_intelligence: modules.site_intelligence
        };

        const { data: membershipRow, error: membershipError } = await supabase
          .from("project_members")
          .upsert(membershipPayload, { onConflict: "project_id,user_id" })
          .select(
            "id, project_id, user_id, email, role, can_overview, can_contractor_submissions, can_handover, can_daily_reports, can_weekly_reports, can_financials, can_completion, can_defects, can_site_intelligence"
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
        setOpenCreatePanelKey(null);
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

  function renderOverviewActionMenu({
    menuKey,
    label,
    onEdit,
    onDelete
  }: {
    menuKey: string;
    label: string;
    onEdit: () => void;
    onDelete: () => void;
  }) {
    const isOpen = overviewActionMenuKey === menuKey;

    return (
      <div className="overview-action-menu">
        <button
          aria-expanded={isOpen}
          aria-label={`Open actions for ${label}`}
          className="ghost-button overview-action-menu-button"
          onClick={() => setOverviewActionMenuKey((current) => (current === menuKey ? null : menuKey))}
          type="button"
        >
          <span className="overview-menu-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </button>
        {isOpen ? (
          <div className="overview-action-dropdown" role="menu">
            <button
              className="overview-action-dropdown-item"
              onClick={() => {
                setOverviewActionMenuKey(null);
                onEdit();
              }}
              role="menuitem"
              type="button"
            >
              Edit
            </button>
            <button
              className="overview-action-dropdown-item is-danger"
              onClick={() => {
                setOverviewActionMenuKey(null);
                onDelete();
              }}
              role="menuitem"
              type="button"
            >
              Delete
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  function renderProjectSetupPanel(phase: ProjectSetupPhaseEntry) {
    const createKey = getProjectSetupCreateKey(phase.phase);
    const records = getVisibleProjectSetupRecords(phase.phase);
    const totalRecords = activeProject.projectSetupRecords.filter((record) => record.phase === phase.phase).length;
    const categoryListId = `project-setup-categories-${phase.phase}`;

    const renderRecordForm = (
      record: ProjectBundle["projectSetupRecords"][number] | null,
      onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
    ) => (
      <form className="module-form-grid" onSubmit={onSubmit}>
        <label className="field">
          <span>Category</span>
          <input
            defaultValue={record?.category ?? ""}
            key={`project-setup-category-${record?.id ?? createKey}`}
            list={categoryListId}
            name="category"
            placeholder={phase.categories[0]}
            required
          />
        </label>
        <label className="field">
          <span>Item</span>
          <input
            defaultValue={record?.title ?? ""}
            key={`project-setup-title-${record?.id ?? createKey}`}
            name="title"
            placeholder={phase.deliverables[0]}
            required
          />
        </label>
        <label className="field">
          <span>Owner</span>
          <input
            defaultValue={record?.owner ?? ""}
            key={`project-setup-owner-${record?.id ?? createKey}`}
            name="owner"
            placeholder="Consultant / client / contractor"
          />
        </label>
        <label className="field">
          <span>Due date</span>
          <input
            defaultValue={record?.dueDate ?? ""}
            key={`project-setup-due-${record?.id ?? createKey}`}
            name="dueDate"
            type="date"
          />
        </label>
        <label className="field">
          <span>Status</span>
          <select defaultValue={record?.status ?? "not_started"} key={`project-setup-status-${record?.id ?? createKey}`} name="status">
            {PROJECT_SETUP_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Priority</span>
          <select defaultValue={record?.priority ?? "normal"} key={`project-setup-priority-${record?.id ?? createKey}`} name="priority">
            {PROJECT_SETUP_PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field field-full">
          <span>Notes</span>
          <textarea
            defaultValue={record?.notes ?? ""}
            key={`project-setup-notes-${record?.id ?? createKey}`}
            name="notes"
            rows={3}
          />
        </label>
        <label className="field field-full">
          <span>{record ? "Add more attachments" : "Attachments"}</span>
          <input accept={getUploadAcceptForMode("mixed")} multiple name="attachments" type="file" />
          <FreePilotUploadHint mode="mixed" />
        </label>
        <div className="record-actions field-full">
          <button className="primary-button" disabled={isPending || !isConfigured || !activeProject.overview.id} type="submit">
            {record ? "Save changes" : "Save item"}
          </button>
          {record ? (
            <>
              <button className="ghost-button" onClick={() => setEditingProjectSetupRecordId(null)} type="button">
                Cancel
              </button>
              <button
                className="ghost-button"
                onClick={() =>
                  handleDelete({
                    table: "project_setup_records",
                    recordId: record.id,
                    section: "project_setup_record",
                    confirmMessage: `Delete ${record.title}? This will remove the project setup record and its attachments.`,
                    remove: (project) => ({
                      ...project,
                      projectSetupRecords: project.projectSetupRecords.filter((item) => item.id !== record.id)
                    })
                  })
                }
                type="button"
              >
                Delete
              </button>
            </>
          ) : null}
        </div>
      </form>
    );

    return (
      <section className="content-card dashboard-module-card project-setup-module-card" id={phase.href.slice(1)}>
        <div className="section-header">
          <div>
            <p className="eyebrow">Project Setup</p>
            <h3>{phase.label}</h3>
          </div>
          <ModuleHeaderActions>
            <ModuleAiButton
              isOpen={openAiAssistantKey === phase.key}
              moduleName={phase.label}
              onClick={() => toggleModuleAiAssistant(phase.key)}
            />
            <FilterIconButton
              isOpen={openFilterPanelKey === phase.key}
              moduleName={phase.label}
              onClick={() => toggleModuleFilter(phase.key)}
            />
            <CreateToggleButton isOpen={openCreatePanelKey === createKey} onClick={() => toggleCreatePanel(createKey)} />
            <button
              className="ghost-button module-export-button"
              disabled={!activeProject.overview.id}
              onClick={() => handleProjectSetupExport(phase)}
              type="button"
            >
              <span aria-hidden="true" className="nav-symbol nav-symbol-theme">
                {"\u21e9"}
              </span>
              Export
            </button>
          </ModuleHeaderActions>
        </div>
        {openAiAssistantKey === phase.key ? <ModuleAiAssistantPanel {...getModuleAiPanelProps(phase.key, phase.label)} /> : null}
        {openFilterPanelKey === phase.key ? renderModuleFilterPanel(phase.key, phase.label) : null}
        <datalist id={categoryListId}>
          {phase.categories.map((category) => (
            <option key={category} value={category} />
          ))}
        </datalist>
        <div className="project-setup-phase-tabs" aria-label="Project setup phases">
          {PROJECT_SETUP_PHASES.map((entry) => (
            <button
              aria-current={entry.key === phase.key ? "page" : undefined}
              className={cn("project-setup-phase-tab", entry.key === phase.key && "is-active")}
              key={entry.key}
              onClick={() => handlePanelSelect(entry.key, entry.href)}
              type="button"
            >
              {entry.label}
            </button>
          ))}
        </div>
        <details className="project-setup-guide-disclosure">
          <summary>
            <span>
              <span className="eyebrow">Phase guide</span>
              <strong>{phase.focus}</strong>
            </span>
            <span className="pill project-setup-guide-toggle">
              <span className="guide-closed-label">Open guide</span>
              <span className="guide-open-label">Hide guide</span>
            </span>
          </summary>
          <div className="project-setup-guide-grid">
            <article className="overview-read-card overview-read-card-wide">
              <span>Focus</span>
              <strong>{phase.focus}</strong>
            </article>
            <article className="overview-read-card">
              <span>Checks</span>
              <p>{phase.guide.join(" ")}</p>
            </article>
            <article className="overview-read-card">
              <span>Deliverables</span>
              <p>{phase.deliverables.join(", ")}</p>
            </article>
          </div>
        </details>
        {openCreatePanelKey === createKey ? (
          <CreatePanel meta={<span className="pill">{totalRecords} saved</span>} title={`New ${phase.label} item`}>
            {renderRecordForm(null, (event) => handleProjectSetupRecordCreate(event, phase))}
          </CreatePanel>
        ) : null}
        <div className="submission-table-wrap top-gap">
          {records.length ? (
            <table className="submission-table project-setup-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Owner</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th>Files</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <Fragment key={record.id}>
                    <tr className={cn(selectedProjectSetupRecordId === record.id && "is-selected")}>
                      <td className="submission-table-main-cell">
                        <strong>{record.title}</strong>
                        <span>{record.category || "General"}</span>
                      </td>
                      <td>
                        <strong>{record.owner || "Unassigned"}</strong>
                      </td>
                      <td>{record.dueDate ? formatDate(record.dueDate) : "No date"}</td>
                      <td>
                        <ProjectSetupStatusPill status={record.status} />
                      </td>
                      <td>
                        <span className="pill">{record.attachments.length}</span>
                      </td>
                      <td>
                        <div className="record-actions submission-table-actions">
                          <button
                            className="secondary-button"
                            onClick={() => {
                              setEditingProjectSetupRecordId(null);
                              setSelectedProjectSetupRecordId((current) => (current === record.id ? null : record.id));
                            }}
                            type="button"
                          >
                            {selectedProjectSetupRecordId === record.id ? "Hide" : "View"}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {selectedProjectSetupRecordId === record.id ? (
                      <tr className="submission-expanded-row">
                        <td colSpan={6}>
                          <div className="submission-inline-detail">
                            <div className="record-header">
                              <div>
                                <p className="eyebrow">{phase.label}</p>
                                <strong>{record.title}</strong>
                                <p>{record.notes || "No notes recorded yet."}</p>
                              </div>
                              <div className="record-actions">
                                <button
                                  aria-expanded={editingProjectSetupRecordId === record.id}
                                  className="secondary-button"
                                  onClick={() =>
                                    setEditingProjectSetupRecordId((current) => (current === record.id ? null : record.id))
                                  }
                                  type="button"
                                >
                                  {editingProjectSetupRecordId === record.id ? "Cancel" : "Edit"}
                                </button>
                                <button
                                  className="ghost-button"
                                  onClick={() => {
                                    setSelectedProjectSetupRecordId(null);
                                    setEditingProjectSetupRecordId(null);
                                  }}
                                  type="button"
                                >
                                  Close
                                </button>
                              </div>
                            </div>
                            <div className="submission-item-list">
                              <article className="submission-item">
                                <div className="submission-item-header">
                                  <strong>Category</strong>
                                  <span className="pill">{getProjectSetupPriorityLabel(record.priority)}</span>
                                </div>
                                <p>{record.category || "General"}</p>
                              </article>
                              <article className="submission-item">
                                <div className="submission-item-header">
                                  <strong>Owner and due date</strong>
                                </div>
                                <p>
                                  {record.owner || "Unassigned"}
                                  {record.dueDate ? ` · ${formatDate(record.dueDate)}` : ""}
                                </p>
                              </article>
                            </div>
                            <AttachmentList attachments={record.attachments} />
                            {editingProjectSetupRecordId === record.id ? (
                              <div className="top-gap">
                                {renderRecordForm(record, (event) => handleProjectSetupRecordUpdate(event, record))}
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          ) : (
            <article className="record-surface">
              <p className="muted-copy">No {phase.label.toLowerCase()} records match this view.</p>
            </article>
          )}
        </div>
      </section>
    );
  }

  return (
    <>
      <section className={cn("hero-card", activePanel?.key !== "overview" && "hero-card-mobile-compact")}>
        <div className="hero-copy-block">
          <p className="eyebrow">Active Project</p>
          <h2>{activeProject.overview.name || "Create your first project"}</h2>
          {viewer ? (
            <div className="viewer-banner">
              <span className="pill">{getRoleLabel(viewer.role, viewer.email)}</span>
              <span className="pill">{viewer.email || "current user"}</span>
            </div>
          ) : null}
          {projects.length > 1 ? (
            <div className="mobile-project-chip-row" aria-label="Accessible projects">
              <span className="mobile-project-chip-label">Projects</span>
              {projects.map((project) => (
                <button
                  className={`project-chip ${project.overview.id === activeProject.overview.id ? "active" : ""}`}
                  key={`mobile-${project.overview.id}`}
                  onClick={() => setActiveProjectId(project.overview.id)}
                  type="button"
                >
                  {project.overview.name}
                </button>
              ))}
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
        <div className="hero-status-stack">
          <div className="countdown-card">
            <span>Countdown</span>
            <strong>{formatCountdown(activeProject.overview.completionDate, todaySnapshot)}</strong>
            <small>Target completion: {formatDate(activeProject.overview.completionDate)}</small>
          </div>
          <article className={cn("risk-card", "hero-risk-card", `risk-card-${aiProjectInsights.projectRisk.riskLevel}`)}>
            <div className="record-header">
              <div>
                <span>AI Risk Score</span>
                <strong>{aiProjectInsights.projectRisk.riskScore}/100</strong>
              </div>
              <RiskLevelPill level={aiProjectInsights.projectRisk.riskLevel} />
            </div>
            <small>{aiProjectInsights.projectRisk.riskSummary}</small>
          </article>
        </div>
      </section>

      <section
        className={cn(
          "content-card project-switch-card",
          viewer?.role !== "master_admin" && viewer ? "project-switch-card-mobile-hidden" : "project-switch-card-mobile-admin"
        )}
      >
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

      {!isSuspended && activeProject.overview.id && availableDashboardSectors.length > 1 ? (
        <section className="dashboard-sector-toolbar" aria-label="Dashboard section">
          <div>
            <p className="eyebrow">Dashboard</p>
            <strong>{getDashboardSectorLabel(resolvedDashboardSector)}</strong>
          </div>
          <label className="dashboard-sector-select">
            <span>Section</span>
            <select
              onChange={(event) => handleDashboardSectorSelect(event.currentTarget.value as DashboardSectorKey)}
              value={resolvedDashboardSector}
            >
              {availableDashboardSectors.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </section>
      ) : null}

      {!isSuspended ? <div className="dashboard-grid">
        <aside className="dashboard-sidebar panel-surface">
          <div className="sidebar-title-row">
            <h3>Modules</h3>
            <span className="pill">{getRoleLabel(activeProject.access.assignedRole, viewer?.email)}</span>
          </div>
          <div className="submission-table-wrap module-table-wrap">
            <table className="submission-table module-table" aria-label="Available modules">
              <thead>
                <tr>
                  <th>Module</th>
                </tr>
              </thead>
              <tbody>
                {sectorPanelEntries.map((entry, index) => {
                  const isActive = activePanel?.key === entry.key;

                  return (
                    <tr className={cn(isActive && "is-selected")} key={entry.key}>
                      <td>
                        <button
                          aria-current={isActive ? "page" : undefined}
                          className="module-table-button"
                          onClick={() => handlePanelSelect(entry.key, entry.href)}
                          type="button"
                        >
                          <span className="module-table-index">{String(index + 1).padStart(2, "0")}</span>
                          <span>{entry.label}</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </aside>

        <main className="dashboard-main">
          {moduleAccess.overview && activePanel?.key === "overview" ? (
            <section className="content-card dashboard-module-card" id="overview">
            <div className="section-header">
              <div>
                <p className="eyebrow">Overview</p>
                <h3>
                  Project summary <span className="mobile-optional-title">and timeline</span>
                </h3>
              </div>
              <ModuleHeaderActions>
                <ModuleAiButton
                  isOpen={openAiAssistantKey === "overview"}
                  moduleName="Overview"
                  onClick={() => toggleModuleAiAssistant("overview")}
                />
                {canManageOverviewTeams ? (
                  <CreateToggleButton isOpen={isOverviewCreatePanelOpen} onClick={toggleOverviewCreatePanel} />
                ) : null}
                <ExportButton disabled={!activeProject.overview.id} moduleKey="overview" onExport={handleModuleExport} />
              </ModuleHeaderActions>
            </div>
            {openAiAssistantKey === "overview" ? (
              <ModuleAiAssistantPanel {...getModuleAiPanelProps("overview", "Overview")} />
            ) : null}
            <div className="stats-grid">
              <StatCard label="Milestones" value={String(activeProject.milestones.length)} />
              <StatCard label="Daily Reports" value={String(activeProject.dailyReports.length)} />
              <StatCard label="Survey Items" value={String(activeProject.surveyItems.length)} />
              <StatCard label="Approved Value" value={formatCurrency(approvedTotal)} />
              <StatCard label="AI Risk Score" value={`${aiProjectInsights.projectRisk.riskScore}/100`} />
            </div>
            <div className="overview-read-grid">
              <article className="overview-read-card overview-read-card-wide">
                <span>Project details</span>
                <strong>{activeProject.overview.name || "Untitled project"}</strong>
                <p>{activeProject.overview.location || "No location saved yet."}</p>
                {activeProject.overview.details ? <p>{activeProject.overview.details}</p> : null}
              </article>
              <article className="overview-read-card">
                <span>Client</span>
                <strong>{activeProject.overview.clientName || "Not set"}</strong>
              </article>
              <article className="overview-read-card">
                <span>Contractor</span>
                <strong>{leadContractorDisplayName}</strong>
              </article>
              <article className="overview-read-card">
                <span>Handover</span>
                <strong>{formatDate(activeProject.overview.handoverDate)}</strong>
              </article>
              <article className="overview-read-card">
                <span>Completion</span>
                <strong>{formatDate(activeProject.overview.completionDate)}</strong>
              </article>
            </div>

            <div className="overview-saved-section">
              <div className="overview-saved-section-header">
                <h3>Team information</h3>
                <span className="pill">
                  {activeProject.projectContractors.length + activeProject.projectConsultants.length} records
                </span>
              </div>
              {activeProject.projectContractors.length || activeProject.projectConsultants.length ? (
                <div className="submission-table-wrap overview-table-wrap">
                  <table className="submission-table overview-compact-table overview-team-table">
                    <thead>
                      <tr>
                        <th className="overview-company-column">Company</th>
                        <th className="overview-role-column">Role</th>
                        <th className="overview-trades-column">Trades</th>
                        {canManageOverviewTeams ? <th className="overview-action-column">Action</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {sortProjectContractors(activeProject.projectContractors).map((contractor) => (
                        <tr key={contractor.id}>
                          <td className="submission-table-main-cell overview-company-column">
                            <strong>{contractor.companyName}</strong>
                          </td>
                          <td className="overview-role-column">
                            <span className="overview-role-full">{formatContractorTypeLabel(contractor.contractorType)}</span>
                            <span className="overview-role-short">{formatContractorTypeShortLabel(contractor.contractorType)}</span>
                          </td>
                          <td className="overview-trades-column">
                            <div className="overview-table-pills">
                              {contractor.trades.map((trade) => (
                                <span className="pill" key={trade}>
                                  {formatContractorTradeLabel(trade)}
                                </span>
                              ))}
                            </div>
                          </td>
                          {canManageOverviewTeams ? (
                            <td className="overview-action-column">
                              {renderOverviewActionMenu({
                                menuKey: `contractor-${contractor.id}`,
                                label: contractor.companyName,
                                onEdit: () => openOverviewEditPanel({ kind: "contractor", id: contractor.id }),
                                onDelete: () =>
                                  handleDelete({
                                    table: "project_contractors",
                                    recordId: contractor.id,
                                    confirmMessage: `Delete ${contractor.companyName}? This will remove this team record from the project.`,
                                    remove: (project) => ({
                                      ...project,
                                      projectContractors: project.projectContractors.filter((item) => item.id !== contractor.id)
                                    })
                                  })
                              })}
                            </td>
                          ) : null}
                        </tr>
                      ))}
                      {sortProjectConsultants(activeProject.projectConsultants).map((consultant) => (
                        <tr key={consultant.id}>
                          <td className="submission-table-main-cell overview-company-column">
                            <strong>{consultant.companyName}</strong>
                          </td>
                          <td className="overview-role-column">
                            <span className="overview-role-full">Consultant</span>
                            <span className="overview-role-short">Consult</span>
                          </td>
                          <td className="overview-trades-column">
                            <div className="overview-table-pills">
                              {consultant.trades.map((trade) => (
                                <span className="pill" key={trade}>
                                  {formatConsultantTradeLabel(trade)}
                                </span>
                              ))}
                            </div>
                          </td>
                          {canManageOverviewTeams ? (
                            <td className="overview-action-column">
                              {renderOverviewActionMenu({
                                menuKey: `consultant-${consultant.id}`,
                                label: consultant.companyName,
                                onEdit: () => openOverviewEditPanel({ kind: "consultant", id: consultant.id }),
                                onDelete: () =>
                                  handleDelete({
                                    table: "project_consultants",
                                    recordId: consultant.id,
                                    confirmMessage: `Delete ${consultant.companyName}? This will remove this consultant record from the project.`,
                                    remove: (project) => ({
                                      ...project,
                                      projectConsultants: project.projectConsultants.filter((item) => item.id !== consultant.id)
                                    })
                                  })
                              })}
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted-copy">No contractor or consultant details have been added yet.</p>
              )}
            </div>

            <div className="overview-saved-section">
              <div className="overview-saved-section-header">
                <h3>Milestones</h3>
                <span className="pill">{activeProject.milestones.length} records</span>
              </div>
              {activeProject.milestones.length ? (
                <div className="submission-table-wrap overview-table-wrap">
                  <table className="submission-table overview-compact-table overview-milestone-table">
                    <thead>
                      <tr>
                        <th>Milestone</th>
                        <th>Date</th>
                        {canManageOverviewTeams ? <th>Action</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {activeProject.milestones.map((milestone) => (
                        <tr key={milestone.id}>
                          <td className="submission-table-main-cell">
                            <strong>{milestone.title}</strong>
                          </td>
                          <td>{formatDate(milestone.dueDate)}</td>
                          {canManageOverviewTeams ? (
                            <td>
                              {renderOverviewActionMenu({
                                menuKey: `milestone-${milestone.id}`,
                                label: milestone.title,
                                onEdit: () => openOverviewEditPanel({ kind: "milestone", id: milestone.id }),
                                onDelete: () =>
                                  handleDelete({
                                    table: "milestones",
                                    recordId: milestone.id,
                                    confirmMessage: `Delete ${milestone.title}? This will remove this milestone from the project.`,
                                    remove: (project) => ({
                                      ...project,
                                      milestones: project.milestones.filter((item) => item.id !== milestone.id)
                                    })
                                  })
                              })}
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted-copy">No milestones added yet.</p>
              )}
            </div>
            {canManageOverviewTeams && isOverviewCreatePanelOpen ? (
            <div className="section-stack top-gap overview-action-list">
              <div className="overview-create-switcher" role="group" aria-label="Overview create options">
                {[
                  { key: "overview-details", label: "Project details" },
                  { key: "overview-contractor", label: "Contractor" },
                  { key: "overview-consultant", label: "Consultant" },
                  { key: "overview-milestone", label: "Milestone" }
                ].map((action) => (
                  <button
                    className={cn("overview-create-switcher-button", openCreatePanelKey === action.key && "is-active")}
                    key={action.key}
                    onClick={() => {
                      setOverviewEditTarget(null);
                      setOpenCreatePanelKey(action.key);
                    }}
                    type="button"
                  >
                    {action.label}
                  </button>
                ))}
              </div>

              {openCreatePanelKey === "overview-details" ? (
              <CreatePanel
                eyebrow="Edit"
                meta={
                  <>
                    <span className="pill">{activeProject.overview.location || "No location"}</span>
                    <span className="pill">{formatDate(activeProject.overview.completionDate)}</span>
                  </>
                }
                title="Update project details"
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
              </CreatePanel>
              ) : null}

              {openCreatePanelKey === "overview-contractor" ? (
              <CreatePanel
                eyebrow={overviewEditingContractor ? "Edit" : "Create"}
                meta={
                  <>
                    <span className="pill">{activeProject.projectContractors.length} records</span>
                    <span className="pill">{overviewEditingContractor ? "Editing" : "Editable"}</span>
                  </>
                }
                title={overviewEditingContractor ? "Edit contractor information" : "Add contractor information"}
              >
                {canManageOverviewTeams ? (
                  <form
                    className="module-form-grid"
                    onSubmit={(event) => handleOverviewContractorSubmit(event, overviewEditingContractor)}
                  >
                    <label className="field">
                      <span>Company name</span>
                      <input
                        defaultValue={overviewEditingContractor?.companyName ?? ""}
                        key={`contractor-company-${overviewEditingContractor?.id ?? "new"}`}
                        name="companyName"
                        placeholder="Northfield Projects"
                        required
                      />
                    </label>
                    <label className="field">
                      <span>Type</span>
                      <select
                        defaultValue={overviewEditingContractor?.contractorType ?? "main_contractor"}
                        key={`contractor-type-${overviewEditingContractor?.id ?? "new"}`}
                        name="contractorType"
                      >
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
                            <input
                              defaultChecked={overviewEditingContractor?.trades.includes(option.value) ?? false}
                              key={`contractor-trade-${overviewEditingContractor?.id ?? "new"}-${option.value}`}
                              name="trades"
                              type="checkbox"
                              value={option.value}
                            />
                            <span>{option.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="record-actions field-full">
                      <button className="secondary-button" disabled={isPending || !isConfigured || !activeProject.overview.id} type="submit">
                        {overviewEditingContractor ? "Save contractor" : "Add contractor company"}
                      </button>
                      {overviewEditingContractor ? (
                        <button className="ghost-button" onClick={closeOverviewEditPanel} type="button">
                          Cancel
                        </button>
                      ) : null}
                    </div>
                  </form>
                ) : (
                  <p className="muted-copy">Contractor details are shown above. Your current role has read-only access.</p>
                )}
              </CreatePanel>
              ) : null}

              {openCreatePanelKey === "overview-consultant" ? (
              <CreatePanel
                eyebrow={overviewEditingConsultant ? "Edit" : "Create"}
                meta={
                  <>
                    <span className="pill">{activeProject.projectConsultants.length} records</span>
                    <span className="pill">{overviewEditingConsultant ? "Editing" : "Editable"}</span>
                  </>
                }
                title={overviewEditingConsultant ? "Edit consultant details" : "Add consultant details"}
              >
                {canManageOverviewTeams ? (
                  <form
                    className="module-form-grid"
                    onSubmit={(event) => handleOverviewConsultantSubmit(event, overviewEditingConsultant)}
                  >
                    <label className="field field-full">
                      <span>Consultant company</span>
                      <input
                        defaultValue={overviewEditingConsultant?.companyName ?? ""}
                        key={`consultant-company-${overviewEditingConsultant?.id ?? "new"}`}
                        name="companyName"
                        placeholder="Studio Form Architects"
                        required
                      />
                    </label>
                    <div className="field field-full">
                      <span>Trade</span>
                      <div className="selection-grid compact-selection-grid">
                        {CONSULTANT_TRADE_OPTIONS.map((option) => (
                          <label className="selection-card" key={option.value}>
                            <input
                              defaultChecked={overviewEditingConsultant?.trades.includes(option.value) ?? false}
                              key={`consultant-trade-${overviewEditingConsultant?.id ?? "new"}-${option.value}`}
                              name="trades"
                              type="checkbox"
                              value={option.value}
                            />
                            <span>{option.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="record-actions field-full">
                      <button className="secondary-button" disabled={isPending || !isConfigured || !activeProject.overview.id} type="submit">
                        {overviewEditingConsultant ? "Save consultant" : "Add consultant company"}
                      </button>
                      {overviewEditingConsultant ? (
                        <button className="ghost-button" onClick={closeOverviewEditPanel} type="button">
                          Cancel
                        </button>
                      ) : null}
                    </div>
                  </form>
                ) : (
                  <p className="muted-copy">Consultant details are shown above. Your current role has read-only access.</p>
                )}
              </CreatePanel>
              ) : null}

              {openCreatePanelKey === "overview-milestone" ? (
              <CreatePanel
                eyebrow={overviewEditingMilestone ? "Edit" : "Create"}
                meta={<span className="pill">{activeProject.milestones.length} records</span>}
                title={overviewEditingMilestone ? "Edit milestone" : "Add milestone"}
              >
                <form className="inline-create-form" onSubmit={(event) => handleOverviewMilestoneSubmit(event, overviewEditingMilestone)}>
                  <label className="field">
                    <span>Milestone</span>
                    <input
                      defaultValue={overviewEditingMilestone?.title ?? ""}
                      key={`milestone-title-${overviewEditingMilestone?.id ?? "new"}`}
                      name="title"
                      placeholder="Authority submission"
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Date</span>
                    <input
                      defaultValue={overviewEditingMilestone?.dueDate ?? ""}
                      key={`milestone-date-${overviewEditingMilestone?.id ?? "new"}`}
                      name="dueDate"
                      type="date"
                      required
                    />
                  </label>
                  <div className="record-actions">
                    <button className="secondary-button" disabled={isPending || !isConfigured || !activeProject.overview.id} type="submit">
                      {overviewEditingMilestone ? "Save milestone" : "Add milestone"}
                    </button>
                    {overviewEditingMilestone ? (
                      <button className="ghost-button" onClick={closeOverviewEditPanel} type="button">
                        Cancel
                      </button>
                    ) : null}
                  </div>
                </form>
              </CreatePanel>
              ) : null}
            </div>
            ) : null}
            </section>
          ) : null}

          {activeProjectSetupPhase ? renderProjectSetupPanel(activeProjectSetupPhase) : null}

          {moduleAccess.contractor_submissions && activePanel?.key === "contractor_submissions" ? (
            <section className="content-card dashboard-module-card" id="contractor-submissions">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Project Coordination</p>
                  <h3>Documents Submission</h3>
                </div>
                <ModuleHeaderActions>
                  <ModuleAiButton
                    isOpen={openAiAssistantKey === "contractor_submissions"}
                    moduleName="Documents Submission"
                    onClick={() => toggleModuleAiAssistant("contractor_submissions")}
                  />
                  <FilterIconButton
                    isOpen={openFilterPanelKey === "contractor_submissions"}
                    moduleName="Documents Submission"
                    onClick={() => toggleModuleFilter("contractor_submissions")}
                  />
                  <ExportButton disabled={!activeProject.overview.id} moduleKey="contractor_submissions" onExport={handleModuleExport} />
                </ModuleHeaderActions>
              </div>
              {openAiAssistantKey === "contractor_submissions" ? (
                <ModuleAiAssistantPanel {...getModuleAiPanelProps("contractor_submissions", "Documents Submission")} />
              ) : null}
              {openFilterPanelKey === "contractor_submissions" ? (
                renderModuleFilterPanel("contractor_submissions", "Documents Submission")
              ) : null}

              <div className="section-stack top-gap">
                <section className="panel-surface">
                  <div className="section-header">
                    <div>
                      <p className="eyebrow">Contractor</p>
                      <h3>Contractor Documents</h3>
                    </div>
                    <ModuleHeaderActions>
                      {!canCreateContractorSubmissions ? <TonePill tone="pending">Review only</TonePill> : null}
                      <CreateToggleButton
                        isOpen={openCreatePanelKey === "contractor-documents"}
                        onClick={() => toggleCreatePanel("contractor-documents")}
                      />
                    </ModuleHeaderActions>
                  </div>
                  {openCreatePanelKey === "contractor-documents" ? (
                  <CreatePanel
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
                              items,
                              owner_user_id: viewer?.id ?? "",
                              owner_email: viewer?.email ?? "",
                              owner_role: viewer?.role === "master_admin" ? "master_admin" : currentProjectRole
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
                                  <p>{formatTitleLabel(item.submissionType)}</p>
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
                  </CreatePanel>
                  ) : null}
                  {isContractorDocumentExportMode ? (
                    <div className="submission-export-toolbar top-gap">
                      <div>
                        <p className="eyebrow">Export selection</p>
                        <strong>{selectedVisibleContractorDocumentIds.length} selected</strong>
                        <p className="muted-copy">Tick contractor document rows, then choose CSV or PDF.</p>
                      </div>
                      <div className="record-actions">
                        <button
                          className="secondary-button"
                          disabled={!selectedVisibleContractorDocumentIds.length}
                          onClick={() => void handleSelectedContractorDocumentsExport("csv")}
                          type="button"
                        >
                          CSV
                        </button>
                        <button
                          className="secondary-button"
                          disabled={!selectedVisibleContractorDocumentIds.length}
                          onClick={() => void handleSelectedContractorDocumentsExport("pdf")}
                          type="button"
                        >
                          PDF
                        </button>
                        <button
                          className="ghost-button"
                          onClick={() => {
                            setIsContractorDocumentExportMode(false);
                            setSelectedContractorDocumentIds([]);
                          }}
                          type="button"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <div className="submission-table-wrap top-gap">
                    {visibleContractorSubmissions.length ? (
                      <table className="submission-table contractor-documents-table">
                        <thead>
                          <tr>
                            {isContractorDocumentExportMode ? (
                              <th className="submission-select-cell">
                                <label className="submission-select-control">
                                  <input
                                    aria-label="Select all visible contractor documents"
                                    checked={allVisibleContractorDocumentsSelected}
                                    onChange={toggleVisibleContractorDocumentSelection}
                                    type="checkbox"
                                  />
                                </label>
                              </th>
                            ) : null}
                            <th className="submission-date-column">Date</th>
                            <th className="submission-main-column">Submission</th>
                            <th className="submission-count-column">Items</th>
                            <th className="submission-owner-column mobile-table-secondary">Submitted by</th>
                            <th className="submission-review-column">Client</th>
                            <th className="mobile-table-optional">Consultant</th>
                            <th className="mobile-table-optional">Files</th>
                            <th className="submission-actions-column">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleContractorSubmissions.map((submission) => {
                            const submissionItems = getSafeContractorSubmissionItems(submission);
                            const firstItem = submissionItems[0];
                            const ownerRole = getContractorSubmissionOwnerRole(submission, activeProject.members);
                            const isExportSelected = selectedContractorDocumentIds.includes(submission.id);

                            return (
                              <Fragment key={submission.id}>
                              <tr className={cn(selectedContractorSubmissionId === submission.id && "is-selected", isExportSelected && "is-export-selected")}>
                                {isContractorDocumentExportMode ? (
                                  <td className="submission-select-cell">
                                    <label className="submission-select-control">
                                      <input
                                        aria-label={`Select ${getContractorSubmissionHeading(submission)} submitted ${formatDate(
                                          submission.submittedDate
                                        )}`}
                                        checked={isExportSelected}
                                        onChange={() => toggleContractorDocumentSelection(submission.id)}
                                        type="checkbox"
                                      />
                                    </label>
                                  </td>
                                ) : null}
                                <td className="submission-date-column">
                                  <strong>{formatDate(submission.submittedDate)}</strong>
                                </td>
                                <td className="submission-table-main-cell submission-main-column">
                                  <strong>{getContractorSubmissionHeading(submission)}</strong>
                                  <small>{firstItem?.description || "No description recorded."}</small>
                                </td>
                                <td className="submission-count-column">
                                  <span className="pill">{submissionItems.length}</span>
                                </td>
                                <td className="submission-owner-column mobile-table-secondary">
                                  <strong>{getRoleLabel(ownerRole, submission.ownerEmail)}</strong>
                                  <small>{submission.ownerEmail || "Unknown user"}</small>
                                </td>
                                <td className="submission-review-column">
                                  <StatusPill status={submission.clientStatus} />
                                </td>
                                <td className="mobile-table-optional">
                                  <StatusPill status={submission.consultantStatus} />
                                </td>
                                <td className="mobile-table-optional">
                                  <span className="pill">{submission.attachments.length}</span>
                                </td>
                                <td className="submission-actions-column">
                                  <div className="record-actions submission-table-actions">
                                    <StatusPill status={getContractorSubmissionOverallStatus(submission)} />
                                    <button
                                      className="secondary-button"
                                      onClick={() =>
                                        setSelectedContractorSubmissionId((current) => (current === submission.id ? null : submission.id))
                                      }
                                      type="button"
                                    >
                                      {selectedContractorSubmissionId === submission.id ? "Hide" : "View"}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                              {selectedContractorSubmissionId === submission.id ? (
                                <tr className="submission-expanded-row">
                                  <td colSpan={isContractorDocumentExportMode ? 9 : 8}>
                                    <div className="submission-inline-detail">
                                      <div className="record-header">
                                        <div>
                                          <p className="eyebrow">Submission Details</p>
                                          <strong>{getContractorSubmissionHeading(submission)}</strong>
                                          <p>{formatDate(submission.submittedDate)}</p>
                                        </div>
                                        <button
                                          className="ghost-button"
                                          onClick={() => setSelectedContractorSubmissionId(null)}
                                          type="button"
                                        >
                                          Close
                                        </button>
                                      </div>
                                      <div className="submission-item-list">
                                        {submissionItems.map((item, index) => (
                                          <article className="submission-item" key={item.id}>
                                            <div className="submission-item-header">
                                              <strong>
                                                {index + 1}. {formatTitleLabel(item.submissionType)}
                                              </strong>
                                              <span className="pill">
                                                {item.quantity === null ? "Qty not stated" : `Qty ${item.quantity}`}
                                                {item.unit ? ` ${item.unit}` : ""}
                                              </span>
                                            </div>
                                            <p>{item.description || "No description recorded."}</p>
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
                                                  : `${getApprovalLabel(submission.clientStatus)} by ${
                                                      submission.clientReviewedByEmail || "client"
                                                    }${submission.clientReviewedAt ? ` on ${formatDateTime(submission.clientReviewedAt)}` : ""}`}
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
                                                    contractorSubmissionReviewNotes[
                                                      getContractorSubmissionReviewKey(submission.id, "client")
                                                    ] ?? submission.clientReviewNote
                                                  }
                                                />
                                              </label>
                                              {contractorSubmissionReviewErrors[
                                                getContractorSubmissionReviewKey(submission.id, "client")
                                              ] ? (
                                                <p className="form-error">
                                                  {
                                                    contractorSubmissionReviewErrors[
                                                      getContractorSubmissionReviewKey(submission.id, "client")
                                                    ]
                                                  }
                                                </p>
                                              ) : null}
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
                                                    }${
                                                      submission.consultantReviewedAt ? ` on ${formatDateTime(submission.consultantReviewedAt)}` : ""
                                                    }`}
                                              </p>
                                            </div>
                                            <StatusPill status={submission.consultantStatus} />
                                          </div>
                                          {submission.consultantReviewNote ? (
                                            <p className="muted-copy">Comment: {submission.consultantReviewNote}</p>
                                          ) : null}
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
                                                    contractorSubmissionReviewNotes[
                                                      getContractorSubmissionReviewKey(submission.id, "consultant")
                                                    ] ?? submission.consultantReviewNote
                                                  }
                                                />
                                              </label>
                                              {contractorSubmissionReviewErrors[
                                                getContractorSubmissionReviewKey(submission.id, "consultant")
                                              ] ? (
                                                <p className="form-error">
                                                  {
                                                    contractorSubmissionReviewErrors[
                                                      getContractorSubmissionReviewKey(submission.id, "consultant")
                                                    ]
                                                  }
                                                </p>
                                              ) : null}
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
                                      {viewer?.role === "master_admin" || submission.ownerUserId === viewer?.id ? (
                                        <>
                                          <p className="muted-copy">
                                            Editing this submission will reset both client and consultant reviews back to pending.
                                          </p>
                                          <form
                                            className="module-form-grid"
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
                                                    item.id === submission.id
                                                      ? buildContractorSubmissionFromRow(data, [...item.attachments, ...attachments])
                                                      : item
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
                                                {submissionItems.map((item, index) => (
                                                  <article className="record-surface draft-item-card" key={`edit-${item.id}`}>
                                                    <div className="record-header">
                                                      <div>
                                                        <strong>Item {index + 1}</strong>
                                                        <p>{formatTitleLabel(item.submissionType)}</p>
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
                                                        <input
                                                          defaultValue={item.quantity ?? ""}
                                                          min="0"
                                                          name={`quantity:${item.id}`}
                                                          step="0.01"
                                                          type="number"
                                                        />
                                                      </label>
                                                      <label className="field">
                                                        <span>Unit of measurement</span>
                                                        <input
                                                          defaultValue={item.unit}
                                                          name={`unit:${item.id}`}
                                                          placeholder="pcs / m2 / set / n.a."
                                                        />
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
                                    </div>
                                  </td>
                                </tr>
                              ) : null}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <article className="record-surface">
                        <p className="muted-copy">
                          {activeProject.contractorSubmissions.length
                            ? "No contractor submissions match this filter."
                            : "No contractor submissions recorded yet."}
                        </p>
                      </article>
                    )}
                  </div>
                  {(() => {
                    const submission =
                      activeProject.contractorSubmissions.find((item) => item.id === selectedContractorSubmissionId) ??
                      activeProject.contractorSubmissions[0] ??
                      null;

                    if (!submission || !selectedContractorSubmissionId) {
                      return null;
                    }

                    return null;

                    return (
                      <article className="record-surface submission-detail-panel top-gap">
                        <div className="record-header">
                          <div>
                            <p className="eyebrow">Selected Submission</p>
                            <strong>{getContractorSubmissionHeading(submission)}</strong>
                            <p>{formatDate(submission.submittedDate)}</p>
                          </div>
                          <div className="record-actions">
                            <StatusPill status={getContractorSubmissionOverallStatus(submission)} />
                            <button className="ghost-button" onClick={() => setSelectedContractorSubmissionId(null)} type="button">
                              Close
                            </button>
                          </div>
                        </div>
                          <div className="submission-item-list">
                            {getSafeContractorSubmissionItems(submission).map((item, index) => (
                              <article className="submission-item" key={item.id}>
                                <div className="submission-item-header">
                                  <strong>
                                    {index + 1}. {formatTitleLabel(item.submissionType)}
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
                          {viewer?.role === "master_admin" || submission.ownerUserId === viewer?.id ? (
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
                                            <p>{formatTitleLabel(item.submissionType)}</p>
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
                      </article>
                    );
                  })()}
                </section>

                <section className="panel-surface">
                  <div className="section-header">
                    <div>
                      <p className="eyebrow">Consultant</p>
                      <h3>Consultant Documents</h3>
                    </div>
                    <ModuleHeaderActions>
                      {!canCreateConsultantSubmissions ? <TonePill tone="pending">Review only</TonePill> : null}
                      <CreateToggleButton
                        isOpen={openCreatePanelKey === "consultant-documents"}
                        onClick={() => toggleCreatePanel("consultant-documents")}
                      />
                    </ModuleHeaderActions>
                  </div>
                  {openCreatePanelKey === "consultant-documents" ? (
                  <CreatePanel
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
                  </CreatePanel>
                  ) : null}
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
                          {viewer?.role === "master_admin" || submission.ownerUserId === viewer?.id ? (
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
              <ModuleHeaderActions>
                <ModuleAiButton
                  isOpen={openAiAssistantKey === "handover"}
                  moduleName="Pre-Handover Survey"
                  onClick={() => toggleModuleAiAssistant("handover")}
                />
                <FilterIconButton
                  isOpen={openFilterPanelKey === "handover"}
                  moduleName="Pre-Handover Survey"
                  onClick={() => toggleModuleFilter("handover")}
                />
                <CreateToggleButton isOpen={openCreatePanelKey === "handover"} onClick={() => toggleCreatePanel("handover")} />
                <ExportButton disabled={!activeProject.overview.id} moduleKey="handover" onExport={handleModuleExport} />
              </ModuleHeaderActions>
            </div>
            {openAiAssistantKey === "handover" ? (
              <ModuleAiAssistantPanel {...getModuleAiPanelProps("handover", "Pre-Handover Survey")} />
            ) : null}
            {openFilterPanelKey === "handover" ? renderModuleFilterPanel("handover", "Pre-Handover Survey") : null}
            {openCreatePanelKey === "handover" ? (
            <CreatePanel
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
            </CreatePanel>
            ) : null}
            <div className="list-grid top-gap">
              {visibleSurveyItems.length ? (
                visibleSurveyItems.map((item) => (
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
              <ModuleHeaderActions>
                <ModuleAiButton
                  isOpen={openAiAssistantKey === "daily_reports"}
                  moduleName="Daily Reports"
                  onClick={() => toggleModuleAiAssistant("daily_reports")}
                />
                <FilterIconButton
                  isOpen={openFilterPanelKey === "daily_reports"}
                  moduleName="Daily Reports"
                  onClick={() => toggleModuleFilter("daily_reports")}
                />
                <CreateToggleButton isOpen={openCreatePanelKey === "daily-reports"} onClick={() => toggleCreatePanel("daily-reports")} />
                <ExportButton disabled={!activeProject.overview.id} moduleKey="daily_reports" onExport={handleModuleExport} />
              </ModuleHeaderActions>
            </div>
            {openAiAssistantKey === "daily_reports" ? (
              <ModuleAiAssistantPanel {...getModuleAiPanelProps("daily_reports", "Daily Reports")} />
            ) : null}
            {openFilterPanelKey === "daily_reports" ? renderModuleFilterPanel("daily_reports", "Daily Reports") : null}
            {openCreatePanelKey === "daily-reports" ? (
            <CreatePanel
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
            </CreatePanel>
            ) : null}
            <div className="submission-table-wrap top-gap">
              {visibleDailyReports.length ? (
                <table className="submission-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Location</th>
                      <th>Work completed</th>
                      <th>Manpower</th>
                      <th>Files</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleDailyReports.map((report) => (
                      <Fragment key={report.id}>
                        <tr className={cn(selectedDailyReportId === report.id && "is-selected")}>
                          <td>
                            <strong>{formatDate(report.reportDate)}</strong>
                          </td>
                          <td className="submission-table-main-cell">
                            <strong>{report.location || "No location recorded."}</strong>
                          </td>
                          <td>
                            <span>{report.workDone || "No work details recorded yet."}</span>
                          </td>
                          <td>
                            <span>{report.manpowerByTrade || "No manpower breakdown recorded yet."}</span>
                          </td>
                          <td>
                            <span className="pill">{report.attachments.length}</span>
                          </td>
                          <td>
                            <div className="record-actions submission-table-actions">
                              <button
                                className="secondary-button"
                                onClick={() => {
                                  setEditingDailyReportId(null);
                                  setSelectedDailyReportId((current) => (current === report.id ? null : report.id));
                                }}
                                type="button"
                              >
                                {selectedDailyReportId === report.id ? "Hide" : "View"}
                              </button>
                            </div>
                          </td>
                        </tr>
                        {selectedDailyReportId === report.id ? (
                          <tr className="submission-expanded-row">
                            <td colSpan={6}>
                              <div className="submission-inline-detail">
                                <div className="record-header">
                                  <div>
                                    <p className="eyebrow">Saved Report</p>
                                    <strong>{formatDate(report.reportDate)}</strong>
                                    <p>{report.location || "No location recorded."}</p>
                                  </div>
                                  <div className="record-actions">
                                    <button
                                      aria-expanded={editingDailyReportId === report.id}
                                      className="secondary-button"
                                      onClick={() =>
                                        setEditingDailyReportId((current) => (current === report.id ? null : report.id))
                                      }
                                      type="button"
                                    >
                                      {editingDailyReportId === report.id ? "Cancel" : "Edit"}
                                    </button>
                                    <button
                                      className="ghost-button"
                                      onClick={() => {
                                        setSelectedDailyReportId(null);
                                        setEditingDailyReportId(null);
                                      }}
                                      type="button"
                                    >
                                      Close
                                    </button>
                                  </div>
                                </div>
                                <div className="submission-item-list">
                                  <article className="submission-item">
                                    <div className="submission-item-header">
                                      <strong>Work completed today</strong>
                                    </div>
                                    <p>{report.workDone || "No work details recorded yet."}</p>
                                  </article>
                                  <article className="submission-item">
                                    <div className="submission-item-header">
                                      <strong>Manpower by trade</strong>
                                    </div>
                                    <p>{report.manpowerByTrade || "No manpower breakdown recorded yet."}</p>
                                  </article>
                                </div>
                                <AttachmentList attachments={report.attachments} />
                                {editingDailyReportId === report.id ? (
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
                                        }),
                                        afterSuccess: () => setEditingDailyReportId(null)
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
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
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
              <ModuleHeaderActions>
                <ModuleAiButton
                  isOpen={openAiAssistantKey === "weekly_reports"}
                  moduleName="Weekly Reports"
                  onClick={() => toggleModuleAiAssistant("weekly_reports")}
                />
                <FilterIconButton
                  isOpen={openFilterPanelKey === "weekly_reports"}
                  moduleName="Weekly Reports"
                  onClick={() => toggleModuleFilter("weekly_reports")}
                />
                <CreateToggleButton isOpen={openCreatePanelKey === "weekly-reports"} onClick={() => toggleCreatePanel("weekly-reports")} />
                <ExportButton disabled={!activeProject.overview.id} moduleKey="weekly_reports" onExport={handleModuleExport} />
              </ModuleHeaderActions>
            </div>
            {openAiAssistantKey === "weekly_reports" ? (
              <ModuleAiAssistantPanel {...getModuleAiPanelProps("weekly_reports", "Weekly Reports")} />
            ) : null}
            {openFilterPanelKey === "weekly_reports" ? renderModuleFilterPanel("weekly_reports", "Weekly Reports") : null}
            {openCreatePanelKey === "weekly-reports" ? (
            <CreatePanel
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
            </CreatePanel>
            ) : null}
            <div className="list-grid top-gap">
              {visibleWeeklyReports.length ? (
                visibleWeeklyReports.map((report) => (
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
              <ModuleHeaderActions>
                <ModuleAiButton
                  isOpen={openAiAssistantKey === "financials"}
                  moduleName="Financial Register"
                  onClick={() => toggleModuleAiAssistant("financials")}
                />
                <FilterIconButton
                  isOpen={openFilterPanelKey === "financials"}
                  moduleName="Financial Register"
                  onClick={() => toggleModuleFilter("financials")}
                />
                {canCreateFinancialRecords ? (
                  <CreateToggleButton isOpen={openCreatePanelKey === "financials"} onClick={() => toggleCreatePanel("financials")} />
                ) : null}
                <ExportButton disabled={!activeProject.overview.id} moduleKey="financials" onExport={handleModuleExport} />
              </ModuleHeaderActions>
            </div>
            {openAiAssistantKey === "financials" ? (
              <ModuleAiAssistantPanel {...getModuleAiPanelProps("financials", "Financial Register")} />
            ) : null}
            {openFilterPanelKey === "financials" ? renderModuleFilterPanel("financials", "Financial Register") : null}
            <div className="stats-grid compact">
              <StatCard label="Total Visible" value={formatCurrency(visibleOverallTotal)} />
              <StatCard label="Awaiting Client" value={formatCurrency(visibleAwaitingReviewTotal)} />
              <StatCard label="Approved / Paid" value={formatCurrency(visibleApprovedTotal)} />
            </div>
            {canCreateFinancialRecords && openCreatePanelKey === "financials" ? (
              <CreatePanel
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
              </CreatePanel>
            ) : !canCreateFinancialRecords ? (
              <div className="panel-surface top-gap">
                <p className="muted-copy">Review only.</p>
              </div>
            ) : null}
            <div className="list-grid top-gap">
              {visibleFinancialRecords.length ? (
                visibleFinancialRecords.map((record) => (
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
              <ModuleHeaderActions>
                <ModuleAiButton
                  isOpen={openAiAssistantKey === "completion"}
                  moduleName="Completion Checklist"
                  onClick={() => toggleModuleAiAssistant("completion")}
                />
                <FilterIconButton
                  isOpen={openFilterPanelKey === "completion"}
                  moduleName="Completion Checklist"
                  onClick={() => toggleModuleFilter("completion")}
                />
                <CreateToggleButton isOpen={openCreatePanelKey === "completion"} onClick={() => toggleCreatePanel("completion")} />
                <ExportButton disabled={!activeProject.overview.id} moduleKey="completion" onExport={handleModuleExport} />
              </ModuleHeaderActions>
            </div>
            {openAiAssistantKey === "completion" ? (
              <ModuleAiAssistantPanel {...getModuleAiPanelProps("completion", "Completion Checklist")} />
            ) : null}
            {openFilterPanelKey === "completion" ? renderModuleFilterPanel("completion", "Completion Checklist") : null}
            {openCreatePanelKey === "completion" ? (
            <CreatePanel
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
            </CreatePanel>
            ) : null}
            <div className="list-grid top-gap">
              {visibleCompletionChecklist.length ? (
                visibleCompletionChecklist.map((item) => (
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
              <ModuleHeaderActions>
                <ModuleAiButton
                  isOpen={openAiAssistantKey === "defects"}
                  moduleName="Defect Register"
                  onClick={() => toggleModuleAiAssistant("defects")}
                />
                <FilterIconButton
                  isOpen={openFilterPanelKey === "defects"}
                  moduleName="Defect Register"
                  onClick={() => toggleModuleFilter("defects")}
                />
                <CreateToggleButton isOpen={openCreatePanelKey === "defects"} onClick={() => toggleCreatePanel("defects")} />
                <ExportButton disabled={!activeProject.overview.id} moduleKey="defects" onExport={handleModuleExport} />
              </ModuleHeaderActions>
            </div>
            {openAiAssistantKey === "defects" ? (
              <ModuleAiAssistantPanel {...getModuleAiPanelProps("defects", "Defect Register")} />
            ) : null}
            {openFilterPanelKey === "defects" ? renderModuleFilterPanel("defects", "Defect Register") : null}
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
            {openCreatePanelKey === "defects" ? (
            <CreatePanel
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
            </CreatePanel>
            ) : null}
            <div className="list-grid top-gap">
              {visibleDefects.length ? (
                visibleDefects.map((defect) => {
                  const followUp = getDefectFollowUpSuggestion(defect, todaySnapshot);

                  return (
                    <DisclosureCard
                      badge={<DefectStatusPill status={defect.status} />}
                      className="record-surface"
                      eyebrow="Saved Defect"
                      key={defect.id}
                      meta={
                        <>
                          {defect.zone ? <span className="pill">{defect.zone}</span> : null}
                          <span className="pill">{defect.attachments.length} attachment(s)</span>
                          {followUp ? <span className="pill follow-up-pill">Follow-up required</span> : null}
                        </>
                      }
                      subtitle={defect.details || "No extra notes recorded yet."}
                      title={defect.title}
                    >
                    <AttachmentList attachments={defect.attachments} />
                    {followUp ? <FollowUpNotice followUpDate={followUp.followUpDate} followUpReason={followUp.followUpReason} /> : null}
                    <DrawingLinkPanel
                      disabled={isPending || !isConfigured}
                      drawingLinks={drawingLinksByRecord[`defect:${defect.id}`] ?? []}
                      drawingSheets={activeProject.drawingSheets}
                      onSubmit={(event) =>
                        handleDrawingLinkSave(event, {
                          recordType: "defect",
                          recordId: defect.id
                        })
                      }
                    />
                    <RectificationAssistantForm
                      assistant={mergeRectificationAssistant(
                        defect.rectification,
                        buildRectificationAssistantDraft({
                          location: defect.zone,
                          title: defect.title,
                          details: defect.details
                        })
                      )}
                      disabled={isPending || !isConfigured}
                      onSubmit={(event) =>
                        handleRectificationAssistantSave(event, {
                          recordType: "defect",
                          recordId: defect.id
                        })
                      }
                    />
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
                                    ...item,
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
                  );
                })
              ) : (
                <article className="record-surface">
                  <p className="muted-copy">No defects recorded yet.</p>
                </article>
              )}
            </div>
            </section>
          ) : null}

          {activeProject.overview.id && activePanel?.key === "drawing_register" ? (
            <section className="content-card dashboard-module-card" id="drawing-register">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Drawing Register</p>
                  <h3>Project drawing sheets</h3>
                </div>
                <ModuleHeaderActions>
                  <ModuleAiButton
                    isOpen={openAiAssistantKey === "drawing_register"}
                    moduleName="Drawing Register"
                    onClick={() => toggleModuleAiAssistant("drawing_register")}
                  />
                  <FilterIconButton
                    isOpen={openFilterPanelKey === "drawing_register"}
                    moduleName="Drawing Register"
                    onClick={() => toggleModuleFilter("drawing_register")}
                  />
                  <CreateToggleButton
                    isOpen={openCreatePanelKey === "drawing-register"}
                    onClick={() => toggleCreatePanel("drawing-register")}
                  />
                  <span className="pill">{activeProject.drawingSheets.length} drawing(s)</span>
                </ModuleHeaderActions>
              </div>
              {openAiAssistantKey === "drawing_register" ? (
                <ModuleAiAssistantPanel {...getModuleAiPanelProps("drawing_register", "Drawing Register")} />
              ) : null}
              {openFilterPanelKey === "drawing_register" ? renderModuleFilterPanel("drawing_register", "Drawing Register") : null}
              <p className="muted-copy">
                Upload approved drawing PDFs or images, link field records, then review marked-up locations in heatmap mode.
              </p>

              {openCreatePanelKey === "drawing-register" ? (
                <CreatePanel meta={<span className="pill">{activeProject.drawingSheets.length} saved</span>} title="New drawing sheet">
                <form className="module-form-grid" onSubmit={handleDrawingSheetUpload}>
                  <label className="field">
                    <span>Drawing title</span>
                    <input name="title" placeholder="Reflected ceiling plan" />
                  </label>
                  <label className="field">
                    <span>Type of drawing</span>
                    <select defaultValue="design_drawing" name="drawingType">
                      {DRAWING_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Sheet number</span>
                    <input name="sheetNumber" placeholder="A-102" />
                  </label>
                  <label className="field">
                    <span>Revision</span>
                    <input name="revision" placeholder="Rev 01" />
                  </label>
                  <label className="field">
                    <span>Discipline</span>
                    <input name="discipline" placeholder="Architectural / M&E / Fire" />
                  </label>
                  <label className="field field-full">
                    <span>Drawing PDF or image</span>
                    <input accept={DRAWING_UPLOAD_ACCEPT} name="drawingFile" required type="file" />
                    <p className="field-hint">PDF and image drawings are supported. Images are optimized before upload.</p>
                  </label>
                  <button className="primary-button" disabled={isPending || !isConfigured} type="submit">
                    {isPending ? "Uploading..." : "Upload drawing"}
                  </button>
                </form>
                </CreatePanel>
              ) : null}

              {heatmapDrawing ? (
                <article className="panel-surface drawing-heatmap-panel top-gap">
                  <div className="section-header">
                    <div>
                      <p className="eyebrow">View Heatmap</p>
                      <h3>{heatmapDrawing.title || heatmapDrawing.sheetNumber || "Drawing heatmap"}</h3>
                      <p className="muted-copy">
                        {[heatmapDrawing.sheetNumber, heatmapDrawing.revision, heatmapDrawing.discipline].filter(Boolean).join(" · ") ||
                          "Drawing details not set"}
                      </p>
                    </div>
                    <div className="record-actions">
                      <span className="pill">{heatmapLinks.length} marker(s)</span>
                      <button
                        className="ghost-button"
                        onClick={() => {
                          setHeatmapDrawingId(null);
                          setActiveHeatmapLinkId(null);
                        }}
                        type="button"
                      >
                        Close heatmap
                      </button>
                    </div>
                  </div>
                  <div className="drawing-heatmap-legend top-gap">
                    <span className="drawing-heatmap-legend-item drawing-heatmap-legend-defect">Defect count</span>
                    <span className="drawing-heatmap-legend-item drawing-heatmap-legend-recurring">Recurring issue</span>
                    <span className="drawing-heatmap-legend-item drawing-heatmap-legend-improved">Improved</span>
                    <span className="drawing-heatmap-legend-item drawing-heatmap-legend-delayed">Delayed</span>
                    <span className="drawing-heatmap-legend-item drawing-heatmap-legend-worsened">Worsened</span>
                    <span className="drawing-heatmap-legend-item drawing-heatmap-legend-unknown">Other</span>
                  </div>
                  <div className="drawing-heatmap-layout top-gap">
                    <div className="drawing-heatmap-preview">
                      {heatmapDrawingFileUrl ? (
                        isHeatmapDrawingPdf ? (
                          <object className="drawing-heatmap-file" data={heatmapDrawingFileUrl} type="application/pdf">
                            <a href={heatmapDrawingFileUrl} rel="noreferrer" target="_blank">
                              Open drawing PDF
                            </a>
                          </object>
                        ) : (
                          <img
                            alt={heatmapDrawing.title || heatmapDrawing.sheetNumber || "Drawing sheet"}
                            className="drawing-heatmap-image"
                            src={heatmapDrawingFileUrl}
                          />
                        )
                      ) : (
                        <div className="drawing-heatmap-empty">
                          <p className="muted-copy">Drawing file is unavailable.</p>
                        </div>
                      )}
                      <div className="drawing-heatmap-overlay" aria-label="Drawing markers">
                        {heatmapLinks.map((link) => {
                          const observation = link.recordType === "ai_site_observation" ? aiSiteObservationsById.get(link.recordId) : undefined;
                          const defect = link.recordType === "defect" ? defectsById.get(link.recordId) : undefined;
                          const defectCount = heatmapDefectCountByPoint.get(getDrawingPointKey(link)) ?? 0;
                          const tone = getDrawingHeatmapTone({ defect, defectCount, observation });
                          const label = getDrawingHeatmapLabel({ defect, defectCount, observation });

                          return (
                            <button
                              aria-label={`Open ${link.markupLabel || link.recordType} marker`}
                              className={cn(
                                "drawing-heatmap-marker",
                                `drawing-heatmap-marker-${tone}`,
                                activeHeatmapLink?.id === link.id && "is-active"
                              )}
                              key={link.id}
                              onClick={() => setActiveHeatmapLinkId(link.id)}
                              style={{
                                left: `${Math.min(Math.max(link.xCoordinate ?? 0, 0), 1) * 100}%`,
                                top: `${Math.min(Math.max(link.yCoordinate ?? 0, 0), 1) * 100}%`
                              }}
                              title={link.markupLabel || formatSectionLabel(link.recordType)}
                              type="button"
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <aside className="drawing-heatmap-detail">
                      <div className="record-header">
                        <div>
                          <p className="eyebrow">Related records</p>
                          <strong>{activeHeatmapLink ? activeHeatmapLink.markupLabel || "Selected marker" : "Select a marker"}</strong>
                        </div>
                        {activeHeatmapLink ? <span className="pill">{formatSectionLabel(activeHeatmapLink.recordType)}</span> : null}
                      </div>
                      {activeHeatmapLink ? (
                        <div className="drawing-heatmap-record">
                          {activeHeatmapLink.xCoordinate !== null && activeHeatmapLink.yCoordinate !== null ? (
                            <span className="pill">
                              X {activeHeatmapLink.xCoordinate.toFixed(3)} / Y {activeHeatmapLink.yCoordinate.toFixed(3)}
                            </span>
                          ) : null}
                          {activeHeatmapLink.notes ? <p className="muted-copy">{activeHeatmapLink.notes}</p> : null}
                          {activeHeatmapDefect ? (
                            <article className="drawing-heatmap-related-card">
                              <div className="record-header">
                                <div>
                                  <p className="eyebrow">Defect</p>
                                  <strong>{activeHeatmapDefect.title || "Untitled defect"}</strong>
                                  <p>{activeHeatmapDefect.zone || "No zone set"}</p>
                                </div>
                                <DefectStatusPill status={activeHeatmapDefect.status} />
                              </div>
                              {activeHeatmapDefect.details ? <p className="muted-copy top-gap">{activeHeatmapDefect.details}</p> : null}
                            </article>
                          ) : null}
                          {activeHeatmapObservation ? (
                            <article className="drawing-heatmap-related-card">
                              <div className="record-header">
                                <div>
                                  <p className="eyebrow">AI Observation</p>
                                  <strong>{activeHeatmapObservation.location || "No location set"}</strong>
                                  <p>{activeHeatmapObservation.trade || "Trade not set"}</p>
                                </div>
                                <span className="pill">{formatSectionLabel(activeHeatmapObservation.progressStatus)}</span>
                              </div>
                              <p className="muted-copy top-gap">{activeHeatmapObservation.aiSummary || "No AI summary saved."}</p>
                              <div className="attachment-list top-gap">
                                {activeHeatmapObservation.isRecurringIssue ? (
                                  <span className="pill recurring-issue-badge">Recurring issue</span>
                                ) : null}
                                {activeHeatmapObservation.recurrenceCount ? (
                                  <span className="pill">{activeHeatmapObservation.recurrenceCount} occurrence(s)</span>
                                ) : null}
                                {activeHeatmapObservation.confidence ? (
                                  <span className="pill">{Math.round(activeHeatmapObservation.confidence * 100)}% confidence</span>
                                ) : null}
                              </div>
                              {activeHeatmapObservation.progressDeltaSummary ? (
                                <p className="muted-copy top-gap">{activeHeatmapObservation.progressDeltaSummary}</p>
                              ) : null}
                            </article>
                          ) : null}
                          {heatmapDrawingFileUrl ? (
                            <a className="attachment-link" href={heatmapDrawingFileUrl} rel="noreferrer" target="_blank">
                              Open drawing file
                            </a>
                          ) : null}
                        </div>
                      ) : (
                        <p className="muted-copy top-gap">
                          Click a heatmap marker to inspect the linked AI observation or defect. Links without coordinates are kept on the record card but
                          are not plotted here.
                        </p>
                      )}
                    </aside>
                  </div>
                </article>
              ) : null}

              <div className="overview-saved-section">
                <div className="overview-saved-section-header">
                  <h3>Uploaded drawing sheets</h3>
                  <span className="pill">{visibleDrawingSheets.length} shown</span>
                </div>
                {visibleDrawingSheets.length ? (
                  <div className="submission-table-wrap top-gap">
                    <table className="submission-table drawing-register-table">
                      <thead>
                        <tr>
                          <th>Drawing</th>
                          <th>Type</th>
                          <th>Rev</th>
                          <th>Uploaded</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleDrawingSheets.map((drawing) => (
                          <tr key={drawing.id}>
                            <td className="submission-table-main-cell">
                              <strong>{drawing.title || drawing.sheetNumber || "Untitled drawing"}</strong>
                              <small>{[drawing.sheetNumber, drawing.discipline].filter(Boolean).join(" · ") || "No sheet details"}</small>
                              {drawing.aiDrawingTitle ? <small>AI: {drawing.aiDrawingTitle}</small> : null}
                            </td>
                            <td>{getDrawingTypeLabel(drawing.drawingType)}</td>
                            <td>{drawing.revision || "-"}</td>
                            <td>{formatDateTime(drawing.createdAt)}</td>
                            <td>
                              <div className="record-actions submission-table-actions">
                                {drawing.filePublicUrl ? (
                                  <a className="secondary-button" href={drawing.filePublicUrl} rel="noreferrer" target="_blank">
                                    Open
                                  </a>
                                ) : (
                                  <span className="pill">No file</span>
                                )}
                                <button
                                  className="ghost-button"
                                  disabled={drawingSummaryActionId === drawing.id || !isConfigured}
                                  onClick={() => handleDrawingSummaryGenerate(drawing)}
                                  type="button"
                                >
                                  AI
                                </button>
                                <button
                                  className="ghost-button"
                                  onClick={() => {
                                    setHeatmapDrawingId(drawing.id);
                                    setActiveHeatmapLinkId(null);
                                  }}
                                  type="button"
                                >
                                  Heatmap
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <article className="record-surface">
                    <p className="muted-copy">No drawing sheets uploaded yet.</p>
                  </article>
                )}
              </div>
            </section>
          ) : null}

          {moduleAccess.site_intelligence && activePanel?.key === "site_intelligence" ? (
            <section className="content-card dashboard-module-card" id="site-intelligence">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Site Assistant</p>
                  <h3>AI Site Intelligence</h3>
                </div>
                <ModuleHeaderActions>
                  <ModuleAiButton
                    isOpen={openAiAssistantKey === "site_intelligence"}
                    moduleName="AI Site Intelligence"
                    onClick={() => toggleModuleAiAssistant("site_intelligence")}
                  />
                  <FilterIconButton
                    isOpen={openFilterPanelKey === "site_intelligence"}
                    moduleName="AI Site Intelligence"
                    onClick={() => toggleModuleFilter("site_intelligence")}
                  />
                  <span className="pill compact-header-icon-pill">Basic workflow</span>
                  <span className="pill pro-pill compact-header-icon-pill">Pro insights</span>
                </ModuleHeaderActions>
              </div>
              {openAiAssistantKey === "site_intelligence" ? (
                <ModuleAiAssistantPanel {...getModuleAiPanelProps("site_intelligence", "AI Site Intelligence")} />
              ) : null}
              {openFilterPanelKey === "site_intelligence" ? renderModuleFilterPanel("site_intelligence", "AI Site Intelligence") : null}
              <div className="ai-simple-steps top-gap" aria-label="AI Site Intelligence workflow">
                <div className={cn("ai-simple-step", !aiSiteAnalysisResult && "active")}>
                  <span>1</span>
                  <strong>Take photo</strong>
                </div>
                <div className={cn("ai-simple-step", aiSiteAnalysisResult && !aiDailyReportDraft && "active")}>
                  <span>2</span>
                  <strong>Review suggestion</strong>
                </div>
                <div className={cn("ai-simple-step", aiDailyReportDraft && "active")}>
                  <span>3</span>
                  <strong>Create record</strong>
                </div>
              </div>

              <article className="panel-surface ai-guided-panel top-gap">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Step 1</p>
                    <h3>Take or upload a site photo</h3>
                  </div>
                  <span className="pill compact-header-icon-pill">{isAiSiteAnalyzing ? "Analyzing" : "Basic"}</span>
                </div>
                <p className="muted-copy">
                  Choose what you want checked, add location and trade if you know them, then let ProjectAxis draft the note.
                </p>
                <form className="module-form-grid top-gap" onSubmit={handleAiSiteObservationAnalyze}>
                  <SmartCameraModeSelector onChange={setSmartCameraMode} value={smartCameraMode} />
                  <label className="field">
                    <span>Location</span>
                    <input
                      autoComplete="off"
                      list={`ai-site-locations-${activeProject.overview.id || "default"}`}
                      name="location"
                      onChange={(event) => setAiSiteLocation(event.currentTarget.value)}
                      placeholder="Last used location will appear here"
                      value={aiSiteLocation}
                    />
                  </label>
                  <label className="field">
                    <span>Trade</span>
                    <input
                      autoComplete="off"
                      list={`ai-site-trades-${activeProject.overview.id || "default"}`}
                      name="trade"
                      onChange={(event) => setAiSiteTrade(event.currentTarget.value)}
                      placeholder="Last used trade will appear here"
                      value={aiSiteTrade}
                    />
                  </label>
                  <input name="observationMode" type="hidden" value={smartCameraMode} />
                  <input name="detectedTypeHint" type="hidden" value={selectedSmartCameraMode.detectedTypeHint} />
                  <datalist id={`ai-site-locations-${activeProject.overview.id || "default"}`}>
                    {Array.from(new Set(activeProject.aiSiteObservations.map((observation) => observation.location).filter(Boolean))).map(
                      (locationOption) => (
                        <option key={locationOption} value={locationOption} />
                      )
                    )}
                  </datalist>
                  <datalist id={`ai-site-trades-${activeProject.overview.id || "default"}`}>
                    {Array.from(new Set(activeProject.aiSiteObservations.map((observation) => observation.trade).filter(Boolean))).map(
                      (tradeOption) => (
                        <option key={tradeOption} value={tradeOption} />
                      )
                    )}
                  </datalist>
                  <label className="field field-full">
                    <span>Progress comparison</span>
                    <select
                      name="previousObservationId"
                      onChange={(event) => setAiPreviousObservationId(event.currentTarget.value)}
                      value={aiPreviousObservationId}
                    >
                      <option value="auto">Auto-select latest matching observation</option>
                      <option value="none">Do not compare this photo</option>
                      {matchingAiPreviousObservations.map((observation) => (
                        <option key={observation.id} value={observation.id}>
                          {formatDateTime(observation.createdAt)} - {observation.aiSummary || observation.detectedType || "Previous observation"}
                        </option>
                      ))}
                    </select>
                    <p className="field-hint">
                      {matchingAiPreviousObservations.length
                        ? `${matchingAiPreviousObservations.length} previous observation(s) match this location and trade.`
                        : "Enter a matching location and trade to compare against earlier photos."}
                    </p>
                  </label>
                  <label className="field field-full">
                    <span>Site photo</span>
                    <input accept={getUploadAcceptForMode("image-only")} capture="environment" name="image" required type="file" />
                    <p className="field-hint">On mobile, this opens the rear camera where supported. Existing photos still work.</p>
                  </label>
                  <button className="primary-button" disabled={isAiSiteAnalyzing || !activeProject.overview.id} type="submit">
                    {isAiSiteAnalyzing ? "Analyzing..." : `Analyze ${selectedSmartCameraMode.label.toLowerCase()}`}
                  </button>
                </form>
                {aiSiteAnalysisError ? <p className="form-error top-gap">{aiSiteAnalysisError}</p> : null}
                {aiSiteAnalysisResult ? (
                  <article className="record-surface ai-review-card top-gap">
                    <div className="record-header">
                      <div>
                        <p className="eyebrow">Step 2 · Review suggestion</p>
                        <strong>{aiSiteAnalysisResult.suggestedTitle || "Site observation suggestion"}</strong>
                      </div>
                      <div className="attachment-list">
                        <span className="pill">{formatSectionLabel(aiSiteAnalysisResult.cameraMode)}</span>
                        {aiSiteAnalysisResult.isRecurringIssue ? <span className="pill recurring-issue-badge">Recurring issue</span> : null}
                      </div>
                    </div>
                    <p>{aiSiteAnalysisResult.summary}</p>
                    <div className="module-form-grid top-gap">
                      <div className="field field-full">
                        <span>What ProjectAxis suggests</span>
                        <strong>{aiSiteAnalysisResult.suggestedAction}</strong>
                        <p className="muted-copy">{aiSiteAnalysisResult.suggestedDetails}</p>
                      </div>
                      <details className="ai-pro-details field field-full">
                        <summary className="ai-pro-summary">
                          <span>Pro details</span>
                          <span className="pill pro-pill">Optional</span>
                        </summary>
                        <div className="module-form-grid top-gap">
                          <div className="field">
                            <span>Detected type</span>
                            <strong>{formatSectionLabel(aiSiteAnalysisResult.detectedType)}</strong>
                          </div>
                          <div className="field">
                            <span>AI confidence</span>
                            <strong>{Math.round(aiSiteAnalysisResult.confidence * 100)}%</strong>
                          </div>
                          <div className="field field-full ai-progress-comparison">
                            <span>Progress comparison</span>
                            <div className="attachment-list">
                              <span className="pill">{formatSectionLabel(aiSiteAnalysisResult.progressStatus)}</span>
                              <span className="pill">{Math.round(aiSiteAnalysisResult.comparisonConfidence * 100)}% comparison confidence</span>
                              {aiSiteAnalysisResult.previousObservationId ? (
                                <span className="pill">Compared with {aiSiteAnalysisResult.previousObservationId.slice(0, 8)}</span>
                              ) : (
                                <span className="pill">No previous observation</span>
                              )}
                            </div>
                            <p className="muted-copy top-gap">
                              {aiSiteAnalysisResult.progressDeltaSummary || "No comparison summary returned."}
                            </p>
                          </div>
                          {aiSiteAnalysisResult.isRecurringIssue ? (
                            <div className="field field-full ai-recurring-issue">
                              <span>Recurring issue detection</span>
                              <div className="attachment-list">
                                <span className="pill recurring-issue-badge">Recurring issue</span>
                                <span className="pill">{aiSiteAnalysisResult.recurrenceCount} times</span>
                              </div>
                              <p className="muted-copy top-gap">{aiSiteAnalysisResult.recurrenceSummary}</p>
                            </div>
                          ) : null}
                        </div>
                      </details>
                    </div>
                    {aiDailyReportSuccess ? <p className="success-copy top-gap">{aiDailyReportSuccess}</p> : null}
                    {aiDailyReportError ? <p className="form-error top-gap">{aiDailyReportError}</p> : null}
                    {!aiDailyReportDraft && !aiDailyReportSuccess ? (
                      <div className="record-actions top-gap">
                        <button
                          className="primary-button"
                          disabled={isAiDailyReportSaving || !aiSiteAnalysisResult.observationId}
                          onClick={openAiDailyReportReview}
                          type="button"
                        >
                          Create Daily Report
                        </button>
                        {!aiSiteAnalysisResult.observationId ? (
                          <span className="muted-copy">Analyze again after the AI observation table is available.</span>
                        ) : null}
                      </div>
                    ) : null}
                    {aiDailyReportDraft ? (
                      <form className="module-form-grid top-gap" onSubmit={handleAiDailyReportCreate}>
                        <div className="field field-full">
                          <span>Step 3</span>
                          <strong>Review and save the daily report</strong>
                          <p className="field-hint">You can edit the wording before anything becomes an official project record.</p>
                        </div>
                        <label className="field">
                          <span>Date</span>
                          <input
                            name="reportDate"
                            onChange={(event) => updateAiDailyReportDraft("reportDate", event.currentTarget.value)}
                            required
                            type="date"
                            value={aiDailyReportDraft.reportDate}
                          />
                        </label>
                        <label className="field">
                          <span>Project / location</span>
                          <input
                            name="location"
                            onChange={(event) => updateAiDailyReportDraft("location", event.currentTarget.value)}
                            required
                            value={aiDailyReportDraft.location}
                          />
                        </label>
                        <label className="field field-full">
                          <span>Work completed today</span>
                          <textarea
                            name="workDone"
                            onChange={(event) => updateAiDailyReportDraft("workDone", event.currentTarget.value)}
                            rows={5}
                            value={aiDailyReportDraft.workDone}
                          />
                        </label>
                        <label className="field field-full">
                          <span>Manpower by trade</span>
                          <textarea
                            name="manpowerByTrade"
                            onChange={(event) => updateAiDailyReportDraft("manpowerByTrade", event.currentTarget.value)}
                            rows={3}
                            value={aiDailyReportDraft.manpowerByTrade}
                          />
                        </label>
                        <div className="record-actions field-full">
                          <button
                            className="primary-button"
                            disabled={isAiDailyReportSaving || !isConfigured || !activeProject.overview.id}
                            type="submit"
                          >
                            {isAiDailyReportSaving ? "Saving..." : "Save daily report"}
                          </button>
                          <button
                            className="ghost-button"
                            disabled={isAiDailyReportSaving}
                            onClick={() => setAiDailyReportDraft(null)}
                            type="button"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : null}
                  </article>
                ) : null}
              </article>

              <article className="panel-surface top-gap">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Saved Photos</p>
                    <h3>Review queue and history</h3>
                  </div>
                  <span className="pill">{aiObservationGroups.pending.length} to review</span>
                </div>
                <p className="muted-copy">
                  Use this list when you want to turn a saved AI photo into a defect or daily report later.
                </p>
                <div className="record-actions top-gap">
                  {[
                    { key: "pending" as const, label: "To review", count: aiObservationGroups.pending.length },
                    { key: "approved" as const, label: "Saved", count: aiObservationGroups.approved.length },
                    { key: "dismissed" as const, label: "Ignored", count: aiObservationGroups.dismissed.length },
                    { key: "all" as const, label: "All", count: aiObservationGroups.all.length }
                  ].map((item) => (
                    <button
                      className={aiObservationFilter === item.key ? "secondary-button" : "ghost-button"}
                      key={item.key}
                      onClick={() => setAiObservationFilter(item.key)}
                      type="button"
                    >
                      {item.label} ({item.count})
                    </button>
                  ))}
                </div>
                {aiObservationQueueSuccess ? <p className="success-copy top-gap">{aiObservationQueueSuccess}</p> : null}
                {aiObservationQueueError ? <p className="form-error top-gap">{aiObservationQueueError}</p> : null}
              </article>

              {visibleAiObservationGroups.map((group) => (
                <div className="list-grid top-gap" key={group.key}>
                  <div className="overview-saved-section-header field-full">
                    <h3>{group.title}</h3>
                    <span className="pill">{group.observations.length} observation(s)</span>
                  </div>
                  {group.observations.length ? (
                    group.observations.map((observation) => {
                      const isLinked = Boolean(observation.linkedRecordType || observation.linkedRecordId);
                      const isObservationBusy = Boolean(aiObservationActionKey?.endsWith(`:${observation.id}`));
                      const activeConversionDraft =
                        aiObservationConversionDraft?.observationId === observation.id ? aiObservationConversionDraft : null;
                      const comparedObservation = observation.previousObservationId
                        ? activeProject.aiSiteObservations.find((item) => item.id === observation.previousObservationId) ?? null
                        : null;
                      const followUp = getAiObservationFollowUpSuggestion(observation, todaySnapshot);
                      const relatedRecurringObservations = observation.recurrenceGroupId
                        ? activeProject.aiSiteObservations.filter(
                            (item) => item.id !== observation.id && item.recurrenceGroupId === observation.recurrenceGroupId
                          )
                        : observation.isRecurringIssue
                          ? activeProject.aiSiteObservations.filter(
                              (item) =>
                                item.id !== observation.id &&
                                item.isRecurringIssue &&
                                item.location.trim().toLowerCase() === observation.location.trim().toLowerCase() &&
                                item.trade.trim().toLowerCase() === observation.trade.trim().toLowerCase() &&
                                item.detectedType.trim().toLowerCase() === observation.detectedType.trim().toLowerCase()
                            )
                          : [];

                      return (
                        <article className="record-surface ai-observation-card" key={observation.id}>
                          {observation.imagePublicUrl ? (
                            <a className="ai-observation-thumb" href={observation.imagePublicUrl} rel="noreferrer" target="_blank">
                              <img alt={`AI observation at ${observation.location || "site"}`} src={observation.imagePublicUrl} />
                            </a>
                          ) : null}
                          <div className="ai-observation-body">
                            <div className="record-header">
                              <div>
                                <p className="eyebrow">{formatSectionLabel(observation.status)}</p>
                                <strong>{observation.location || "No location recorded"}</strong>
                                <p>{observation.trade || "No trade recorded"}</p>
                              </div>
                              <span className="pill">{Math.round(observation.confidence * 100)}% confidence</span>
                            </div>
                            <p>{observation.aiSummary || "No AI summary saved yet."}</p>
                            <div className="attachment-list top-gap">
                              <span className="pill">{formatSectionLabel(observation.detectedType || "site_observation")}</span>
                              <span className="pill">{formatDateTime(observation.createdAt)}</span>
                              {observation.isRecurringIssue ? <span className="pill recurring-issue-badge">Recurring issue</span> : null}
                              {followUp ? <span className="pill follow-up-pill">Follow-up required</span> : null}
                              {observation.linkedRecordType ? (
                                <span className="pill">
                                  Linked to {formatSectionLabel(observation.linkedRecordType)}
                                  {observation.linkedRecordId ? ` · ${observation.linkedRecordId.slice(0, 8)}` : ""}
                                </span>
                              ) : null}
                              {observation.imagePublicUrl ? (
                                <a className="attachment-link" href={observation.imagePublicUrl} rel="noreferrer" target="_blank">
                                  View photo
                                </a>
                              ) : null}
                            </div>
                            {followUp ? <FollowUpNotice followUpDate={followUp.followUpDate} followUpReason={followUp.followUpReason} /> : null}
                            <details className="ai-pro-details top-gap">
                              <summary className="ai-pro-summary">
                                <span>Pro details</span>
                                <span className="pill pro-pill">Comparison, drawings, rectification</span>
                              </summary>
                              <DrawingLinkPanel
                                disabled={isObservationBusy || !isConfigured}
                                drawingLinks={drawingLinksByRecord[`ai_site_observation:${observation.id}`] ?? []}
                                drawingSheets={activeProject.drawingSheets}
                                onSubmit={(event) =>
                                  handleDrawingLinkSave(event, {
                                    recordType: "ai_site_observation",
                                    recordId: observation.id
                                  })
                                }
                              />
                              <div className="ai-progress-comparison top-gap">
                                <div className="record-header">
                                  <div>
                                    <p className="eyebrow">Progress Comparison</p>
                                    <strong>{formatSectionLabel(observation.progressStatus)}</strong>
                                  </div>
                                  <span className="pill">{Math.round(observation.comparisonConfidence * 100)}% confidence</span>
                                </div>
                                <p className="muted-copy">
                                  {observation.progressDeltaSummary ||
                                    "No previous comparison has been saved for this observation yet."}
                                </p>
                                <div className="attachment-list top-gap">
                                  {comparedObservation ? (
                                    <>
                                      <span className="pill">Compared with {formatDateTime(comparedObservation.createdAt)}</span>
                                      {comparedObservation.imagePublicUrl ? (
                                        <a className="attachment-link" href={comparedObservation.imagePublicUrl} rel="noreferrer" target="_blank">
                                          View previous photo
                                        </a>
                                      ) : null}
                                    </>
                                  ) : observation.previousObservationId ? (
                                    <span className="pill">Previous ID {observation.previousObservationId.slice(0, 8)}</span>
                                  ) : (
                                    <span className="pill">No previous observation</span>
                                  )}
                                </div>
                              </div>
                              {observation.isRecurringIssue ? (
                                <div className="ai-recurring-issue top-gap">
                                  <div className="record-header">
                                    <div>
                                      <p className="eyebrow">Recurring Issue Detection</p>
                                      <strong>Recurring issue</strong>
                                    </div>
                                    <span className="pill">{observation.recurrenceCount} times</span>
                                  </div>
                                  <p className="muted-copy">
                                    {observation.recurrenceSummary ||
                                      `Recurring issue: seen ${observation.recurrenceCount || 2} times in ${
                                        observation.location || "this location"
                                      } / ${observation.trade || "this trade"}`}
                                  </p>
                                  <div className="attachment-list top-gap">
                                    {relatedRecurringObservations.length ? (
                                      relatedRecurringObservations.slice(0, 4).map((relatedObservation) => (
                                        <a
                                          className="attachment-link"
                                          href={relatedObservation.imagePublicUrl ?? "#"}
                                          key={relatedObservation.id}
                                          rel="noreferrer"
                                          target={relatedObservation.imagePublicUrl ? "_blank" : undefined}
                                        >
                                          Related: {formatDateTime(relatedObservation.createdAt)}
                                        </a>
                                      ))
                                    ) : (
                                      <span className="pill">No related observations loaded</span>
                                    )}
                                  </div>
                                </div>
                              ) : null}
                              <RectificationAssistantForm
                                assistant={mergeRectificationAssistant(
                                  observation.rectification,
                                  buildRectificationAssistantDraft({
                                    location: observation.location,
                                    trade: observation.trade,
                                    detectedType: observation.detectedType,
                                    summary: observation.aiSummary,
                                    details: observation.progressDeltaSummary
                                  })
                                )}
                                disabled={isObservationBusy || !isConfigured}
                                onSubmit={(event) =>
                                  handleRectificationAssistantSave(event, {
                                    recordType: "ai_site_observation",
                                    recordId: observation.id
                                  })
                                }
                              />
                            </details>
                            <div className="record-actions top-gap">
                              <button
                                className="ghost-button"
                                disabled={isObservationBusy || observation.status === "reviewed" || isLinked}
                                onClick={() => updateAiObservationStatus(observation, "reviewed")}
                                type="button"
                              >
                                {aiObservationActionKey === `reviewed:${observation.id}` ? "Reviewing..." : "Review"}
                              </button>
                              <button
                                className="ghost-button"
                                disabled={isObservationBusy || observation.status === "dismissed" || isLinked}
                                onClick={() => updateAiObservationStatus(observation, "dismissed")}
                                type="button"
                              >
                                {aiObservationActionKey === `dismissed:${observation.id}` ? "Dismissing..." : "Dismiss"}
                              </button>
                              {!isLinked ? (
                                <>
                                  <button
                                    className="secondary-button"
                                    disabled={isObservationBusy}
                                    onClick={() => openAiObservationConversionReview(observation, "defect")}
                                    type="button"
                                  >
                                    Convert to Defect
                                  </button>
                                  <button
                                    className="secondary-button"
                                    disabled={isObservationBusy}
                                    onClick={() => openAiObservationConversionReview(observation, "daily_report")}
                                    type="button"
                                  >
                                    Convert to Daily Report
                                  </button>
                                </>
                              ) : null}
                            </div>
                            {activeConversionDraft ? (
                              <form className="module-form-grid top-gap" onSubmit={handleAiObservationConversionCreate}>
                                {activeConversionDraft.mode === "daily_report" ? (
                                  <>
                                    <label className="field">
                                      <span>Date</span>
                                      <input
                                        name="reportDate"
                                        onChange={(event) => updateAiObservationConversionDraft("reportDate", event.currentTarget.value)}
                                        required
                                        type="date"
                                        value={activeConversionDraft.reportDate}
                                      />
                                    </label>
                                    <label className="field">
                                      <span>Project / location</span>
                                      <input
                                        name="location"
                                        onChange={(event) => updateAiObservationConversionDraft("location", event.currentTarget.value)}
                                        required
                                        value={activeConversionDraft.location}
                                      />
                                    </label>
                                    <label className="field field-full">
                                      <span>Work completed today</span>
                                      <textarea
                                        name="workDone"
                                        onChange={(event) => updateAiObservationConversionDraft("workDone", event.currentTarget.value)}
                                        rows={4}
                                        value={activeConversionDraft.workDone}
                                      />
                                    </label>
                                    <label className="field field-full">
                                      <span>Manpower by trade</span>
                                      <textarea
                                        name="manpowerByTrade"
                                        onChange={(event) =>
                                          updateAiObservationConversionDraft("manpowerByTrade", event.currentTarget.value)
                                        }
                                        rows={3}
                                        value={activeConversionDraft.manpowerByTrade}
                                      />
                                    </label>
                                  </>
                                ) : (
                                  <>
                                    <label className="field">
                                      <span>Zone</span>
                                      <input
                                        list={`defect-zones-${activeProject.overview.id || "default"}`}
                                        name="zone"
                                        onChange={(event) => updateAiObservationConversionDraft("zone", event.currentTarget.value)}
                                        required
                                        value={activeConversionDraft.zone}
                                      />
                                    </label>
                                    <label className="field">
                                      <span>Defect title</span>
                                      <input
                                        name="title"
                                        onChange={(event) => updateAiObservationConversionDraft("title", event.currentTarget.value)}
                                        required
                                        value={activeConversionDraft.title}
                                      />
                                    </label>
                                    <label className="field">
                                      <span>Status</span>
                                      <select
                                        name="status"
                                        onChange={(event) => updateAiObservationConversionDraft("status", event.currentTarget.value)}
                                        value={activeConversionDraft.status}
                                      >
                                        <option value="open">Open</option>
                                        <option value="in_progress">In progress</option>
                                        <option value="closed">Closed</option>
                                      </select>
                                    </label>
                                    <label className="field field-full">
                                      <span>Details</span>
                                      <textarea
                                        name="details"
                                        onChange={(event) => updateAiObservationConversionDraft("details", event.currentTarget.value)}
                                        rows={4}
                                        value={activeConversionDraft.details}
                                      />
                                    </label>
                                  </>
                                )}
                                <div className="record-actions field-full">
                                  <button
                                    className="primary-button"
                                    disabled={aiObservationActionKey === `convert:${observation.id}` || !isConfigured}
                                    type="submit"
                                  >
                                    {aiObservationActionKey === `convert:${observation.id}`
                                      ? "Saving..."
                                      : activeConversionDraft.mode === "daily_report"
                                        ? "Save daily report"
                                        : "Save defect"}
                                  </button>
                                  <button
                                    className="ghost-button"
                                    disabled={aiObservationActionKey === `convert:${observation.id}`}
                                    onClick={() => setAiObservationConversionDraft(null)}
                                    type="button"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </form>
                            ) : null}
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    <article className="record-surface field-full">
                      <p className="muted-copy">No AI site observations in this queue yet.</p>
                    </article>
                  )}
                </div>
              ))}
            </section>
          ) : null}

          {moduleAccess.site_intelligence && activePanel?.key === "ai_insights" ? (
            <section className="content-card dashboard-module-card" id="ai-insights">
              <div className="section-header">
                <div>
                  <p className="eyebrow">AI Insights</p>
                  <h3>Project issue intelligence</h3>
                </div>
                <ModuleHeaderActions>
                  <ModuleAiButton
                    isOpen={openAiAssistantKey === "ai_insights"}
                    moduleName="AI Insights"
                    onClick={() => toggleModuleAiAssistant("ai_insights")}
                  />
                  <FilterIconButton
                    isOpen={openFilterPanelKey === "ai_insights"}
                    moduleName="AI Insights"
                    onClick={() => toggleModuleFilter("ai_insights")}
                  />
                  <span className="pill">{aiProjectInsights.totalSignals} signals</span>
                </ModuleHeaderActions>
              </div>
              {openAiAssistantKey === "ai_insights" ? (
                <ModuleAiAssistantPanel {...getModuleAiPanelProps("ai_insights", "AI Insights")} />
              ) : null}
              {openFilterPanelKey === "ai_insights" ? renderModuleFilterPanel("ai_insights", "AI Insights") : null}
              <p className="muted-copy">
                Aggregated from AI site observations and the defect register. Report drafts are composed from the records already saved in the project.
              </p>

              <article className="panel-surface ai-report-generator top-gap">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">AI Report Generator</p>
                    <h3>Generate report</h3>
                  </div>
                  <span className="pill compact-header-icon-pill">Editable before PDF</span>
                </div>
                <div className="module-form-grid top-gap">
                  <label className="field">
                    <span>Report type</span>
                    <select onChange={(event) => setAiReportType(event.currentTarget.value as AiReportType)} value={aiReportType}>
                      {AI_REPORT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="record-actions">
                    <button className="primary-button" disabled={!activeProject.overview.id} onClick={handleAiReportGenerate} type="button">
                      Generate Report
                    </button>
                    <button
                      className="secondary-button"
                      disabled={!aiReportDraft.trim() || isAiReportExporting}
                      onClick={handleAiReportPdfExport}
                      type="button"
                    >
                      {isAiReportExporting ? "Exporting..." : "Export PDF"}
                    </button>
                  </div>
                  <label className="field field-full">
                    <span>Editable report draft</span>
                    <textarea
                      onChange={(event) => setAiReportDraft(event.currentTarget.value)}
                      placeholder="Generate a report draft, review the wording, then export it as PDF."
                      rows={16}
                      value={aiReportDraft}
                    />
                  </label>
                </div>
                {aiReportError ? <p className="form-error top-gap">{aiReportError}</p> : null}
              </article>

              <div className="stats-grid top-gap">
                <StatCard label="AI Observations" value={String(aiProjectInsights.aiObservationCount)} />
                <StatCard label="Defects" value={String(aiProjectInsights.defectCount)} />
                <StatCard label="Recurring Issues" value={String(aiProjectInsights.recurringObservationCount)} />
                <StatCard label="Risk Score" value={`${aiProjectInsights.projectRisk.riskScore}/100`} />
                <StatCard
                  label="Progress Trend"
                  value={`${aiProjectInsights.progressTrend.improved} / ${aiProjectInsights.progressTrend.worsened}`}
                />
              </div>

              <div className="insight-summary-grid top-gap">
                <article className={cn("record-surface", "insight-metric-card", "risk-card", `risk-card-${aiProjectInsights.projectRisk.riskLevel}`)}>
                  <div className="record-header">
                    <div>
                      <p className="eyebrow">Project Risk</p>
                      <strong>{aiProjectInsights.projectRisk.riskScore}/100</strong>
                    </div>
                    <RiskLevelPill level={aiProjectInsights.projectRisk.riskLevel} />
                  </div>
                  <p className="muted-copy top-gap">{aiProjectInsights.projectRisk.riskSummary}</p>
                </article>
                <article className="record-surface insight-metric-card">
                  <p className="eyebrow">Open Action Load</p>
                  <strong>{aiProjectInsights.openDefectCount}</strong>
                  <p className="muted-copy">Open or in-progress defects currently counted in the register.</p>
                </article>
                <article className="record-surface insight-metric-card">
                  <p className="eyebrow">Recurring Groups</p>
                  <strong>{aiProjectInsights.recurringGroupCount}</strong>
                  <p className="muted-copy">Issue groups with repeat patterns or AI recurring issue flags.</p>
                </article>
                <article className="record-surface insight-metric-card">
                  <p className="eyebrow">Improved vs Worsened</p>
                  <strong>
                    {aiProjectInsights.progressTrend.improved} improved · {aiProjectInsights.progressTrend.worsened} worsened
                  </strong>
                  <p className="muted-copy">
                    Also tracking {aiProjectInsights.progressTrend.delayed} delayed, {aiProjectInsights.progressTrend.unchanged} unchanged, and{" "}
                    {aiProjectInsights.progressTrend.unknown} unknown comparison(s).
                  </p>
                </article>
              </div>

              <div className="insight-grid top-gap">
                <InsightListCard
                  emptyLabel="No recurring issue pattern has been detected yet."
                  eyebrow="Top Patterns"
                  groups={aiProjectInsights.topRecurringIssues}
                  title="Top recurring issues"
                />
                <InsightListCard
                  emptyLabel="No trade-level issue data is available yet."
                  eyebrow="Trade View"
                  groups={aiProjectInsights.tradeGroups}
                  title="Issues grouped by trade"
                />
                <InsightListCard
                  emptyLabel="No location-level issue data is available yet."
                  eyebrow="Location View"
                  groups={aiProjectInsights.locationGroups}
                  title="Issues grouped by location"
                />
                <article className="record-surface insight-list-card">
                  <div className="record-header">
                    <div>
                      <p className="eyebrow">Risk Scoring</p>
                      <strong>Zone risk levels</strong>
                    </div>
                    <span className="pill">{visibleZoneRisks.length} zone(s)</span>
                  </div>
                  {visibleZoneRisks.length ? (
                    <div className="insight-list">
                      {visibleZoneRisks.slice(0, 6).map((risk) => (
                        <div className="insight-list-row" key={risk.key}>
                          <div>
                            <strong>{risk.label}</strong>
                            <p className="muted-copy">{risk.riskSummary}</p>
                            <div className="attachment-list top-gap">
                              <span className="pill">{risk.recurringIssuesCount} recurring</span>
                              <span className="pill">{risk.openDefects} open defect(s)</span>
                              <span className="pill">{risk.worseningProgressCount} worsening</span>
                            </div>
                          </div>
                          <div className="insight-list-meta">
                            <RiskLevelPill level={risk.riskLevel} />
                            <span className="pill">{risk.riskScore}/100</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted-copy top-gap">No zone risk signals are available yet.</p>
                  )}
                </article>
                <article className="record-surface insight-list-card">
                  <div className="record-header">
                    <div>
                      <p className="eyebrow">Progress</p>
                      <strong>Simple progress trend</strong>
                    </div>
                    <span className="pill">
                      {aiProjectInsights.progressTrend.improved + aiProjectInsights.progressTrend.worsened} directional
                    </span>
                  </div>
                  <div className="insight-list">
                    {(["improved", "worsened", "delayed", "unchanged", "unknown"] as const).map((status) => (
                      <div className="insight-list-row" key={status}>
                        <div>
                          <strong>{formatSectionLabel(status)}</strong>
                          <p className="muted-copy">AI progress comparison result</p>
                        </div>
                        <span className="pill">{aiProjectInsights.progressTrend[status]} observation(s)</span>
                      </div>
                    ))}
                  </div>
                </article>
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
                <ModuleHeaderActions>
                  <ModuleAiButton
                    isOpen={openAiAssistantKey === "access_control"}
                    moduleName="Access Control"
                    onClick={() => toggleModuleAiAssistant("access_control")}
                  />
                  <FilterIconButton
                    isOpen={openFilterPanelKey === "access_control"}
                    moduleName="Access Control"
                    onClick={() => toggleModuleFilter("access_control")}
                  />
                  <CreateToggleButton
                    isOpen={openCreatePanelKey === "access-control"}
                    onClick={() => toggleCreatePanel("access-control")}
                  />
                </ModuleHeaderActions>
              </div>
              {openAiAssistantKey === "access_control" ? (
                <ModuleAiAssistantPanel {...getModuleAiPanelProps("access_control", "Access Control")} />
              ) : null}
              {openFilterPanelKey === "access_control" ? renderModuleFilterPanel("access_control", "Access Control") : null}
              {openCreatePanelKey === "access-control" ? (
                <CreatePanel meta={<span className="pill">{visibleMembers.length} members</span>} title="Add project access">
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
                </CreatePanel>
              ) : null}

              <div className="list-grid top-gap">
                {visibleMembers.length ? (
                  visibleMembers.map((member) => (
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

      {!isSuspended && activePanel ? (
        <div className="mobile-dashboard-actions" aria-label="Mobile dashboard controls">
          {isMobileModuleListOpen || isMobileCreateMenuOpen ? (
            <button
              aria-label="Close mobile panel"
              className="mobile-bottom-scrim"
              onClick={() => {
                setIsMobileModuleListOpen(false);
                setIsMobileCreateMenuOpen(false);
              }}
              type="button"
            />
          ) : null}

          {isMobileModuleListOpen ? (
            <div className="mobile-bottom-sheet" role="dialog" aria-label="Modules">
              <div className="mobile-bottom-sheet-header">
                <div>
                  <p className="eyebrow">Modules</p>
                  <strong>{getDashboardSectorLabel(resolvedDashboardSector)}</strong>
                </div>
                <button className="ghost-button" onClick={() => setIsMobileModuleListOpen(false)} type="button">
                  Close
                </button>
              </div>
              {availableDashboardSectors.length > 1 ? (
                <label className="dashboard-sector-select mobile-sheet-sector-select">
                  <span>Section</span>
                  <select
                    onChange={(event) => handleDashboardSectorSelect(event.currentTarget.value as DashboardSectorKey)}
                    value={resolvedDashboardSector}
                  >
                    {availableDashboardSectors.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="mobile-bottom-sheet-list">
                {sectorPanelEntries.map((entry, index) => {
                  const isActive = activePanel.key === entry.key;

                  return (
                    <button
                      aria-current={isActive ? "page" : undefined}
                      className={cn("mobile-bottom-sheet-button", isActive && "is-active")}
                      key={entry.key}
                      onClick={() => handleMobilePanelSelect(entry.key, entry.href)}
                      type="button"
                    >
                      <span className="module-table-index">{String(index + 1).padStart(2, "0")}</span>
                      <span>{entry.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {isMobileCreateMenuOpen ? (
            <div className="mobile-bottom-sheet mobile-create-sheet" role="dialog" aria-label="Create options">
              <div className="mobile-bottom-sheet-header">
                <div>
                  <p className="eyebrow">Create</p>
                  <strong>{activePanel.label}</strong>
                </div>
                <button className="ghost-button" onClick={() => setIsMobileCreateMenuOpen(false)} type="button">
                  Close
                </button>
              </div>
              <div className="mobile-bottom-sheet-list">
                {availableMobileCreateActions.map((action) => (
                  <button
                    className="mobile-bottom-sheet-button"
                    key={action.key}
                    onClick={() => handleMobileCreateActionSelect(action.key)}
                    type="button"
                  >
                    <span className="mobile-sheet-symbol" aria-hidden="true">
                      +
                    </span>
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mobile-bottom-bar">
            <button
              aria-expanded={hasOpenMobileCreatePanel || isMobileCreateMenuOpen}
              className={cn("mobile-bottom-action", hasOpenMobileCreatePanel && "is-active")}
              disabled={!availableMobileCreateActions.length}
              onClick={handleMobileCreateToggle}
              type="button"
            >
              <span className="mobile-bottom-action-icon" aria-hidden="true">
                {hasOpenMobileCreatePanel ? "\u00d7" : "+"}
              </span>
              <span>{hasOpenMobileCreatePanel ? "Close" : "Create"}</span>
            </button>
            <button
              aria-expanded={isMobileModuleListOpen}
              aria-label="Show modules"
              className={cn("mobile-bottom-list-button", isMobileModuleListOpen && "is-active")}
              onClick={() => {
                setIsMobileCreateMenuOpen(false);
                setIsMobileModuleListOpen((current) => !current);
              }}
              type="button"
            >
              <span aria-hidden="true">{"\u2630"}</span>
            </button>
            <button
              aria-expanded={isContractorDocumentExportMode}
              className={cn("mobile-bottom-action", isContractorDocumentExportMode && "is-active")}
              disabled={!canExportActivePanel}
              onClick={handleMobileExport}
              type="button"
            >
              <span className="mobile-bottom-action-icon" aria-hidden="true">
                {"\u21e9"}
              </span>
              <span>{isContractorDocumentExportMode ? "Done" : "Export"}</span>
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
