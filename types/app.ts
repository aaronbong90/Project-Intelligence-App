export type ChecklistStatus = "good" | "minor_issue" | "major_issue" | "missing";
export type FinancialStatus = "pending" | "submitted" | "approved" | "rejected" | "paid";
export type CompletionStatus = "open" | "ready" | "completed";
export type DefectStatus = "open" | "in_progress" | "closed";
export type UserRole = "master_admin" | "client" | "contractor" | "subcontractor" | "consultant";
export type RecordSectionType =
  | "survey_item"
  | "daily_report"
  | "weekly_report"
  | "financial_record"
  | "defect";

export type ModuleKey = "overview" | "handover" | "daily_reports" | "weekly_reports" | "financials" | "completion" | "defects";

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

export type Milestone = {
  id: string;
  title: string;
  dueDate: string;
};

export type SurveyItem = {
  id: string;
  area: string;
  item: string;
  status: ChecklistStatus;
  details: string;
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

export type DefectRecord = {
  id: string;
  zone: string;
  title: string;
  status: DefectStatus;
  details: string;
  attachments: AttachmentRecord[];
};

export type ProjectBundle = {
  overview: ProjectOverview;
  access: ProjectAccess;
  members: ProjectMember[];
  milestones: Milestone[];
  surveyItems: SurveyItem[];
  dailyReports: DailyReport[];
  weeklyReports: WeeklyReport[];
  financialRecords: FinancialRecord[];
  completionChecklist: CompletionChecklistItem[];
  defectZones: DefectZone[];
  defects: DefectRecord[];
};

export type AdminProjectSummary = {
  id: string;
  name: string;
  ownerId: string;
  ownerEmail: string;
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
  projectAccess: UserProjectAccess[];
};
