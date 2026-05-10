export type ChecklistStatus = "good" | "minor_issue" | "major_issue" | "missing";
export type FinancialStatus = "pending" | "submitted" | "approved" | "rejected" | "paid";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type CompletionStatus = "open" | "ready" | "completed";
export type DefectStatus = "open" | "in_progress" | "closed";
export type DrawingType = "design_drawing" | "tender_drawing" | "shop_drawing" | "as_built_drawing";
export type ProjectSetupPhase = "site_survey" | "due_diligence" | "design" | "tender" | "award";
export type ProjectSetupStatus = "not_started" | "in_progress" | "blocked" | "ready" | "closed";
export type ProjectSetupPriority = "normal" | "high" | "urgent";
export type UserRole = "master_admin" | "client" | "contractor" | "subcontractor" | "consultant";
export type RecordSectionType =
  | "contractor_submission"
  | "consultant_submission"
  | "project_setup_record"
  | "survey_item"
  | "daily_report"
  | "weekly_report"
  | "financial_record"
  | "defect";

export type ModuleKey =
  | "overview"
  | "contractor_submissions"
  | "handover"
  | "daily_reports"
  | "weekly_reports"
  | "financials"
  | "completion"
  | "defects"
  | "site_intelligence";

export type ModulePermissions = Record<ModuleKey, boolean>;

export type AppUserProfile = {
  id: string;
  email: string;
  role: UserRole;
  isSuspended: boolean;
};

export type ProjectMember = {
  id: string;
  userId: string;
  email: string;
  role: UserRole;
  modules: ModulePermissions;
};

export type ProjectAccess = {
  isOwner: boolean;
  canManageAccess: boolean;
  modules: ModulePermissions;
  assignedRole: UserRole;
};

export type AttachmentRecord = {
  id: string;
  name: string;
  mimeType: string;
  path: string;
  publicUrl?: string | null;
};

export type ProjectOverview = {
  id: string;
  name: string;
  location: string;
  clientName: string;
  contractorName: string;
  details: string;
  handoverDate: string | null;
  completionDate: string | null;
};

export type ContractorPartyType = "main_contractor" | "subcontractor";
export type ContractorTrade =
  | "architectural"
  | "electrical"
  | "plumbing_sanitary"
  | "fire_protection"
  | "electrical_low_voltage";
export type ConsultantTrade = "architect" | "mep";

export type ProjectContractor = {
  id: string;
  companyName: string;
  contractorType: ContractorPartyType;
  trades: ContractorTrade[];
};

export type ProjectConsultant = {
  id: string;
  companyName: string;
  trades: ConsultantTrade[];
};

export type Milestone = {
  id: string;
  title: string;
  dueDate: string;
};

export type ProjectSetupRecord = {
  id: string;
  phase: ProjectSetupPhase;
  category: string;
  title: string;
  owner: string;
  status: ProjectSetupStatus;
  priority: ProjectSetupPriority;
  dueDate: string | null;
  notes: string;
  attachments: AttachmentRecord[];
  createdAt: string;
};

export type SurveyItem = {
  id: string;
  area: string;
  item: string;
  status: ChecklistStatus;
  details: string;
  attachments: AttachmentRecord[];
};

export type ContractorSubmissionItemType = "material_submission" | "method_statement" | "project_programme" | "rfi";

export type ContractorSubmissionItem = {
  id: string;
  submissionType: ContractorSubmissionItemType;
  description: string;
  quantity: number | null;
  unit: string;
};

export type ContractorSubmission = {
  id: string;
  submittedDate: string;
  items: ContractorSubmissionItem[];
  ownerUserId: string;
  ownerEmail: string;
  ownerRole: UserRole;
  clientStatus: ApprovalStatus;
  clientReviewedAt: string | null;
  clientReviewedByUserId: string | null;
  clientReviewedByEmail: string;
  clientReviewNote: string;
  consultantStatus: ApprovalStatus;
  consultantReviewedAt: string | null;
  consultantReviewedByUserId: string | null;
  consultantReviewedByEmail: string;
  consultantReviewNote: string;
  attachments: AttachmentRecord[];
};

export type ConsultantSubmissionItem = {
  id: string;
  documentType: string;
  description: string;
};

export type ConsultantSubmission = {
  id: string;
  submittedDate: string;
  items: ConsultantSubmissionItem[];
  ownerUserId: string;
  ownerEmail: string;
  ownerRole: UserRole;
  status: ApprovalStatus;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  reviewedByEmail: string;
  reviewNote: string;
  attachments: AttachmentRecord[];
};

export type DailyReport = {
  id: string;
  reportDate: string;
  location: string;
  workDone: string;
  manpowerByTrade: string;
  attachments: AttachmentRecord[];
};

export type WeeklyReport = {
  id: string;
  weekEnding: string;
  summary: string;
  attachments: AttachmentRecord[];
};

export type FinancialRecord = {
  id: string;
  documentType: "quotation" | "invoice" | "variation_order";
  referenceNumber: string;
  amount: number;
  status: FinancialStatus;
  notes: string;
  ownerUserId: string;
  ownerEmail: string;
  ownerRole: UserRole;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  reviewedByEmail: string;
  reviewNote: string;
  attachments: AttachmentRecord[];
};

export type CompletionChecklistItem = {
  id: string;
  item: string;
  status: CompletionStatus;
  details: string;
};

export type DefectZone = {
  id: string;
  name: string;
};

export type RectificationAssistant = {
  rootCause: string;
  responsibleTrade: string;
  rectificationSteps: string[];
  closureChecklist: string[];
};

export type DefectRecord = {
  id: string;
  zone: string;
  title: string;
  status: DefectStatus;
  details: string;
  followUpDate: string | null;
  followUpReason: string;
  rectification: RectificationAssistant;
  attachments: AttachmentRecord[];
  createdAt: string;
};

export type AiSiteObservationStatus = "pending" | "reviewed" | "approved" | "converted" | "dismissed" | "failed";

export type AiProgressStatus =
  | "improved"
  | "unchanged"
  | "delayed"
  | "worsened"
  | "unknown";

export type AiSiteObservation = {
  id: string;
  projectId: string;
  createdByUserId: string | null;
  location: string;
  trade: string;
  imagePath: string;
  imagePublicUrl?: string | null;
  aiSummary: string;
  detectedType: string;
  confidence: number;
  status: AiSiteObservationStatus;
  linkedRecordType: "defect" | "daily_report" | null;
  linkedRecordId: string | null;
  previousObservationId: string | null;
  progressStatus: AiProgressStatus;
  progressDeltaSummary: string;
  comparisonConfidence: number;
  recurrenceGroupId: string | null;
  recurrenceCount: number;
  recurrenceSummary: string;
  isRecurringIssue: boolean;
  followUpDate: string | null;
  followUpReason: string;
  rectification: RectificationAssistant;
  createdAt: string;
};

export type DrawingLinkRecordType = "ai_site_observation" | "defect" | "daily_report";

export type DrawingSheet = {
  id: string;
  projectId: string;
  title: string;
  drawingType: DrawingType;
  revision: string;
  discipline: string;
  sheetNumber: string;
  filePath: string;
  filePublicUrl?: string | null;
  aiDrawingTitle: string;
  aiDiscipline: string;
  aiLikelyZones: string[];
  aiKeyNotes: string[];
  aiRisks: string[];
  aiSummarizedAt: string | null;
  uploadedByUserId: string | null;
  createdAt: string;
};

export type DrawingLink = {
  id: string;
  projectId: string;
  drawingSheetId: string;
  recordType: DrawingLinkRecordType;
  recordId: string;
  xCoordinate: number | null;
  yCoordinate: number | null;
  markupLabel: string;
  notes: string;
  createdByUserId: string | null;
  createdAt: string;
};

export type ProjectNotification = {
  id: string;
  projectId: string;
  actorUserId: string | null;
  actorEmail: string;
  action: string;
  section: string;
  title: string;
  details: string;
  createdAt: string;
};

export type ProjectBundle = {
  overview: ProjectOverview;
  access: ProjectAccess;
  members: ProjectMember[];
  projectContractors: ProjectContractor[];
  projectConsultants: ProjectConsultant[];
  milestones: Milestone[];
  projectSetupRecords: ProjectSetupRecord[];
  contractorSubmissions: ContractorSubmission[];
  consultantSubmissions: ConsultantSubmission[];
  surveyItems: SurveyItem[];
  dailyReports: DailyReport[];
  weeklyReports: WeeklyReport[];
  financialRecords: FinancialRecord[];
  completionChecklist: CompletionChecklistItem[];
  defectZones: DefectZone[];
  defects: DefectRecord[];
  aiSiteObservations: AiSiteObservation[];
  drawingSheets: DrawingSheet[];
  drawingLinks: DrawingLink[];
  notifications: ProjectNotification[];
};

export type AdminProjectSummary = {
  id: string;
  name: string;
  ownerId: string;
  ownerEmail: string;
  canManageMembers: boolean;
  manageableModules: ModulePermissions;
};

export type UserProjectAccess = {
  membershipId: string | null;
  projectId: string;
  projectName: string;
  role: UserRole;
  modules: ModulePermissions;
  isOwner: boolean;
};

export type AdminUserRecord = AppUserProfile & {
  clientOwnerId: string | null;
  clientOwnerEmail: string | null;
  createdByUserId: string | null;
  createdByEmail: string | null;
  projectAccess: UserProjectAccess[];
};
