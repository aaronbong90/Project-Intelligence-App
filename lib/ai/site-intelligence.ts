import type { DefectRecord, ProjectBundle } from "@/types/app";

export type SmartCameraMode = "defect" | "progress" | "inspection";
export type AiObservationQueueFilter = "pending" | "approved" | "dismissed" | "all";

export type AiSiteAnalysisResult = {
  summary: string;
  detectedType: string;
  confidence: number;
  suggestedAction: string;
  suggestedTitle: string;
  suggestedDetails: string;
  progressStatus: ProjectBundle["aiSiteObservations"][number]["progressStatus"];
  progressDeltaSummary: string;
  comparisonConfidence: number;
  observationId: string | null;
  imagePath: string | null;
  imagePublicUrl: string | null;
  imageName: string | null;
  imageMimeType: string | null;
  createdAt: string | null;
  previousObservationId: string | null;
  recurrenceGroupId: string | null;
  recurrenceCount: number;
  recurrenceSummary: string;
  isRecurringIssue: boolean;
  followUpDate: string | null;
  followUpReason: string;
  rootCause: string;
  responsibleTrade: string;
  rectificationSteps: string[];
  closureChecklist: string[];
  location: string;
  trade: string;
  cameraMode: SmartCameraMode;
};

export type AiObservationConversionDraft =
  | {
      mode: "daily_report";
      observationId: string;
      reportDate: string;
      location: string;
      workDone: string;
      manpowerByTrade: string;
    }
  | {
      mode: "defect";
      observationId: string;
      zone: string;
      title: string;
      status: DefectRecord["status"];
      details: string;
    };

export const SMART_CAMERA_MODES: Array<{
  key: SmartCameraMode;
  label: string;
  detectedTypeHint: string;
  helper: string;
}> = [
  {
    key: "defect",
    label: "Defect",
    detectedTypeHint: "defect",
    helper: "Look for workmanship, damage, missing works, leaks, cracks, or handover issues."
  },
  {
    key: "progress",
    label: "Progress",
    detectedTypeHint: "progress",
    helper: "Compare current work status against previous photos for improvement or delay."
  },
  {
    key: "inspection",
    label: "Inspection",
    detectedTypeHint: "inspection",
    helper: "Review general site condition, protection, cleanliness, safety, and readiness."
  }
];

export const OPEN_DEFECT_FOLLOW_UP_THRESHOLD_DAYS = 7;

export function normalizeAiComparisonValue(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeAiProgressStatus(value: unknown): ProjectBundle["aiSiteObservations"][number]["progressStatus"] {
  if (value === "improved" || value === "unchanged" || value === "delayed" || value === "worsened" || value === "unknown") {
    return value;
  }

  return "unknown";
}

export function normalizeSmartCameraMode(value: unknown): SmartCameraMode {
  if (value === "defect" || value === "progress" || value === "inspection") {
    return value;
  }

  return "defect";
}

export function normalizeDetectedTypeHint(value: unknown, mode: SmartCameraMode) {
  const hint = String(value ?? "").trim().toLowerCase();
  if (["defect", "progress", "inspection", "daily_report", "safety", "material", "unknown"].includes(hint)) {
    return hint;
  }

  return mode;
}

export function getModeGuidance(mode: SmartCameraMode) {
  if (mode === "progress") {
    return {
      detectedType: "progress",
      action: "Review the progress comparison and decide whether it should become a daily report entry.",
      titlePrefix: "Progress review",
      detail: "Focus on visible progress, unchanged areas, delay signals, and what still needs follow-up."
    };
  }

  if (mode === "inspection") {
    return {
      detectedType: "inspection",
      action: "Review the inspection note and decide whether it needs a defect, daily report, or no official record.",
      titlePrefix: "Inspection review",
      detail: "Focus on site condition, protection, readiness, safety, cleanliness, and coordination concerns."
    };
  }

  return {
    detectedType: "defect",
    action: "Review the photo and decide whether it should become an official defect.",
    titlePrefix: "Defect review",
    detail: "Focus on visible workmanship, damage, missing work, cracks, leaks, or handover issues."
  };
}

function addDaysToDateString(dateText: string, days: number) {
  const source = dateText ? new Date(`${dateText}T00:00:00`) : new Date();
  if (Number.isNaN(source.getTime())) {
    return "";
  }

  source.setDate(source.getDate() + days);
  return source.toISOString().slice(0, 10);
}

function getDaysSince(dateText: string, todayText: string) {
  const start = new Date(dateText);
  const today = new Date(`${todayText}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(today.getTime())) {
    return 0;
  }

  return Math.floor((today.getTime() - start.getTime()) / 86_400_000);
}

export function getDefectFollowUpSuggestion(defect: ProjectBundle["defects"][number], todayText: string) {
  if (defect.status === "closed") {
    return null;
  }

  if (defect.followUpDate || defect.followUpReason) {
    return {
      followUpDate: defect.followUpDate,
      followUpReason: defect.followUpReason || "Follow-up required for this defect."
    };
  }

  if (getDaysSince(defect.createdAt, todayText) < OPEN_DEFECT_FOLLOW_UP_THRESHOLD_DAYS) {
    return null;
  }

  return {
    followUpDate: todayText,
    followUpReason: `Open defect has exceeded ${OPEN_DEFECT_FOLLOW_UP_THRESHOLD_DAYS} days without closure.`
  };
}

export function getAiObservationFollowUpSuggestion(observation: ProjectBundle["aiSiteObservations"][number], todayText: string) {
  if (observation.followUpDate || observation.followUpReason) {
    return {
      followUpDate: observation.followUpDate,
      followUpReason: observation.followUpReason || "Follow-up required for this AI observation."
    };
  }

  if (!observation.isRecurringIssue) {
    return null;
  }

  return {
    followUpDate: addDaysToDateString(todayText, 1),
    followUpReason:
      observation.recurrenceSummary ||
      `Recurring issue detected in ${observation.location || "this location"} / ${observation.trade || "this trade"}.`
  };
}

