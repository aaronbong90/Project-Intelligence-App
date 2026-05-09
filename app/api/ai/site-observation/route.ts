import { NextResponse, type NextRequest } from "next/server";
import {
  getModeGuidance,
  normalizeDetectedTypeHint,
  normalizeSmartCameraMode,
  type SmartCameraMode
} from "@/lib/ai/site-intelligence";
import { createClient } from "@/lib/supabase/server";
import { PROJECT_FILES_BUCKET, getStoragePublicUrl } from "@/lib/storage";
import { sanitizeFilename } from "@/lib/utils";

type SiteObservationAnalysis = {
  summary: string;
  detectedType: string;
  confidence: number;
  suggestedAction: string;
  suggestedTitle: string;
  suggestedDetails: string;
  progressStatus: AiProgressStatus;
  progressDeltaSummary: string;
  comparisonConfidence: number;
  rootCause: string;
  responsibleTrade: string;
  rectificationSteps: string[];
  closureChecklist: string[];
};

type SiteObservationAnalysisResponse = SiteObservationAnalysis & {
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
};

type AiProgressStatus = "improved" | "unchanged" | "delayed" | "worsened" | "unknown";

type PreviousObservation = {
  id: string;
  location: string;
  trade: string;
  imagePath: string;
  aiSummary: string;
  detectedType: string;
  confidence: number;
  createdAt: string;
  linkedRecordType: "defect" | "daily_report" | null;
  linkedRecordId: string | null;
  recurrenceGroupId: string | null;
  isRecurringIssue: boolean;
};

type RecurrenceResult = {
  recurrenceGroupId: string | null;
  recurrenceCount: number;
  recurrenceSummary: string;
  isRecurringIssue: boolean;
  relatedObservationIds: string[];
};

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const AI_OBSERVATION_BASE_SELECT =
  "id, location, trade, image_path, ai_summary, detected_type, confidence, linked_record_type, linked_record_id, created_at";
const AI_OBSERVATION_RECURRENCE_SELECT = `${AI_OBSERVATION_BASE_SELECT}, recurrence_group_id, is_recurring_issue`;

function createDemoAnalysis(
  location: string,
  trade: string,
  previousObservation: PreviousObservation | null,
  mode: SmartCameraMode,
  detectedTypeHint: string
): SiteObservationAnalysis {
  const locationText = location || "the uploaded site photo";
  const tradeText = trade || "general site works";
  const modeGuidance = getModeGuidance(mode);
  const detectedType = detectedTypeHint || modeGuidance.detectedType;
  const progressDeltaSummary = previousObservation
    ? `Demo comparison only: compared this photo with the observation from ${previousObservation.createdAt}. Please review both photos manually before accepting any progress conclusion.`
    : "No previous observation was selected or found for the same location and trade, so this photo is treated as the first comparison point.";

  const assistant = buildRectificationAssistant({
    location,
    trade,
    detectedType,
    summary: `The photo appears related to ${tradeText} at ${locationText}. ${modeGuidance.detail}`
  });

  return {
    summary: `Demo ${mode} analysis only: the photo appears related to ${tradeText} at ${locationText}. Please review the image manually before creating any official project record.`,
    detectedType,
    confidence: 0.62,
    suggestedAction: modeGuidance.action,
    suggestedTitle: `${modeGuidance.titlePrefix} at ${locationText}`,
    suggestedDetails: `AI demo mode is active because no OpenAI API key is configured. ${modeGuidance.detail}`,
    progressStatus: previousObservation ? "unknown" : "unknown",
    progressDeltaSummary,
    comparisonConfidence: previousObservation ? 0.28 : 0,
    ...assistant
  };
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeAnalysis(value: unknown): SiteObservationAnalysis | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const confidence = Number(record.confidence ?? 0);
  const comparisonConfidence = Number(record.comparisonConfidence ?? 0);
  const assistant = buildRectificationAssistant({
    location: "",
    trade: "",
    detectedType: String(record.detectedType ?? "site_observation"),
    summary: `${String(record.summary ?? "")} ${String(record.suggestedDetails ?? "")}`
  });

  return {
    summary: String(record.summary ?? "").trim(),
    detectedType: String(record.detectedType ?? "site_observation").trim() || "site_observation",
    confidence: Number.isFinite(confidence) ? Math.min(Math.max(confidence, 0), 1) : 0,
    suggestedAction: String(record.suggestedAction ?? "").trim(),
    suggestedTitle: String(record.suggestedTitle ?? "").trim(),
    suggestedDetails: String(record.suggestedDetails ?? "").trim(),
    progressStatus: normalizeProgressStatus(record.progressStatus),
    progressDeltaSummary: String(record.progressDeltaSummary ?? "").trim(),
    comparisonConfidence: Number.isFinite(comparisonConfidence) ? Math.min(Math.max(comparisonConfidence, 0), 1) : 0,
    rootCause: String(record.rootCause ?? assistant.rootCause).trim(),
    responsibleTrade: String(record.responsibleTrade ?? assistant.responsibleTrade).trim(),
    rectificationSteps: normalizeStringArray(record.rectificationSteps).length
      ? normalizeStringArray(record.rectificationSteps)
      : assistant.rectificationSteps,
    closureChecklist: normalizeStringArray(record.closureChecklist).length
      ? normalizeStringArray(record.closureChecklist)
      : assistant.closureChecklist
  };
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

function inferResponsibleTrade(input: { trade: string; text: string }) {
  const trade = input.trade.trim();
  if (trade) return trade;

  const text = normalizeComparisonText(input.text);
  if (text.includes("paint") || text.includes("finishing") || text.includes("plaster")) return "Painting / Architectural";
  if (text.includes("leak") || text.includes("pipe") || text.includes("water") || text.includes("plumbing")) return "Plumbing / Waterproofing";
  if (text.includes("power") || text.includes("light") || text.includes("cable") || text.includes("electrical")) return "Electrical";
  if (text.includes("fire") || text.includes("sprinkler")) return "Fire Protection";
  return "Main contractor / relevant trade";
}

function buildRectificationAssistant(input: { location: string; trade: string; detectedType: string; summary: string }) {
  const text = normalizeComparisonText(`${input.detectedType} ${input.summary}`);
  const responsibleTrade = inferResponsibleTrade({ trade: input.trade, text });

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

function normalizeProgressStatus(value: unknown): AiProgressStatus {
  if (value === "improved" || value === "unchanged" || value === "delayed" || value === "worsened" || value === "unknown") {
    return value;
  }

  return "unknown";
}

function normalizeComparisonText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function hasSameComparisonScope(row: { location?: string | null; trade?: string | null }, location: string, trade: string) {
  return normalizeComparisonText(row.location ?? "") === normalizeComparisonText(location) && normalizeComparisonText(row.trade ?? "") === normalizeComparisonText(trade);
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

function isProgressPersistenceError(error: { message?: string; code?: string } | null | undefined) {
  return (
    isMissingProgressComparisonColumn(error) ||
    isMissingRecurrenceColumn(error) ||
    isMissingRectificationColumn(error) ||
    isMissingFollowUpColumn(error) ||
    (typeof error?.message === "string" && error.message.includes("ai_site_observations_progress_status_check"))
  );
}

function addDaysToDateString(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy.toISOString().slice(0, 10);
}

function buildFollowUpSuggestion(input: { recurrence: RecurrenceResult; location: string; trade: string }) {
  if (!input.recurrence.isRecurringIssue) {
    return {
      followUpDate: null,
      followUpReason: ""
    };
  }

  return {
    followUpDate: addDaysToDateString(new Date(), 1),
    followUpReason:
      input.recurrence.recurrenceSummary ||
      `Recurring issue detected in ${input.location || "this location"} / ${input.trade || "this trade"}.`
  };
}

function tokenizeIssueText(value: string) {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "this",
    "that",
    "site",
    "photo",
    "appears",
    "related",
    "review",
    "please",
    "before",
    "after",
    "area",
    "work",
    "works",
    "observation"
  ]);

  return normalizeComparisonText(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !stopWords.has(token));
}

function calculateTokenSimilarity(left: string, right: string) {
  const leftTokens = new Set(tokenizeIssueText(left));
  const rightTokens = new Set(tokenizeIssueText(right));
  if (!leftTokens.size || !rightTokens.size) return 0;

  let overlap = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) overlap += 1;
  });

  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function calculateLocationSimilarity(left: string, right: string) {
  const normalizedLeft = normalizeComparisonText(left);
  const normalizedRight = normalizeComparisonText(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) return 0.82;
  return calculateTokenSimilarity(normalizedLeft, normalizedRight);
}

function calculateTradeSimilarity(left: string, right: string) {
  const normalizedLeft = normalizeComparisonText(left);
  const normalizedRight = normalizeComparisonText(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) return 0.75;
  return calculateTokenSimilarity(normalizedLeft, normalizedRight);
}

function buildRecurrenceSummary(input: { count: number; location: string; trade: string; unresolvedDefectCount: number }) {
  const locationText = input.location || "this location";
  const tradeText = input.trade || "this trade";
  const suffix = input.unresolvedDefectCount
    ? `, including ${input.unresolvedDefectCount} unresolved linked defect${input.unresolvedDefectCount === 1 ? "" : "s"}`
    : "";

  return `Recurring issue: seen ${input.count} times in ${locationText} / ${tradeText}${suffix}`;
}

function mapPreviousObservationRow(row: {
  id: string;
  location?: string | null;
  trade?: string | null;
  image_path: string;
  ai_summary?: string | null;
  detected_type?: string | null;
  confidence?: number | string | null;
  linked_record_type?: string | null;
  linked_record_id?: string | null;
  recurrence_group_id?: string | null;
  is_recurring_issue?: boolean | null;
  created_at: string;
}): PreviousObservation {
  return {
    id: row.id,
    location: row.location ?? "",
    trade: row.trade ?? "",
    imagePath: row.image_path,
    aiSummary: row.ai_summary ?? "",
    detectedType: row.detected_type ?? "unknown",
    confidence: Number(row.confidence ?? 0),
    linkedRecordType: row.linked_record_type === "defect" || row.linked_record_type === "daily_report" ? row.linked_record_type : null,
    linkedRecordId: row.linked_record_id ?? null,
    recurrenceGroupId: row.recurrence_group_id ?? null,
    isRecurringIssue: Boolean(row.is_recurring_issue),
    createdAt: row.created_at
  };
}

function extractOpenAIText(response: Record<string, unknown>) {
  if (typeof response.output_text === "string") {
    return response.output_text;
  }

  const output = Array.isArray(response.output) ? response.output : [];
  for (const outputItem of output) {
    if (!outputItem || typeof outputItem !== "object") continue;
    const content = Array.isArray((outputItem as Record<string, unknown>).content)
      ? ((outputItem as Record<string, unknown>).content as unknown[])
      : [];

    for (const contentItem of content) {
      if (!contentItem || typeof contentItem !== "object") continue;
      const contentRecord = contentItem as Record<string, unknown>;
      if (typeof contentRecord.text === "string") {
        return contentRecord.text;
      }
    }
  }

  return "";
}

async function fileToDataUrl(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  return `data:${file.type};base64,${buffer.toString("base64")}`;
}

async function storagePathToDataUrl(supabase: Awaited<ReturnType<typeof createClient>>, storagePath: string) {
  const { data, error } = await supabase.storage.from(PROJECT_FILES_BUCKET).download(storagePath);

  if (error || !data) {
    return null;
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  return `data:${data.type || "image/jpeg"};base64,${buffer.toString("base64")}`;
}

async function assertSiteIntelligenceAccess(projectId: string) {
  const hasSupabaseEnv = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!hasSupabaseEnv) {
    return null;
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw Object.assign(new Error("Sign in before analyzing site photos."), { status: 401 });
  }

  const { data: hasAccess, error: accessError } = await supabase.rpc("has_module_access", {
    project_uuid: projectId,
    module_key: "site_intelligence"
  });

  if (accessError) {
    throw Object.assign(new Error(accessError.message || "Unable to verify project access."), { status: 500 });
  }

  if (!hasAccess) {
    throw Object.assign(new Error("You do not have access to AI Site Intelligence for this project."), { status: 403 });
  }

  return { supabase, user };
}

async function analyzeWithOpenAI(input: {
  location: string;
  trade: string;
  image: File;
  previousObservation: PreviousObservation | null;
  previousImageDataUrl: string | null;
  observationMode: SmartCameraMode;
  detectedTypeHint: string;
}): Promise<SiteObservationAnalysis> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return createDemoAnalysis(input.location, input.trade, input.previousObservation, input.observationMode, input.detectedTypeHint);
  }

  const imageUrl = await fileToDataUrl(input.image);
  const model = process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";
  const modeGuidance = getModeGuidance(input.observationMode);
  const comparisonText = input.previousObservation
    ? [
        "Compare the current photo against the previous observation from the same project/location/trade.",
        `Previous observation ID: ${input.previousObservation.id}`,
        `Previous created at: ${input.previousObservation.createdAt}`,
        `Previous summary: ${input.previousObservation.aiSummary || "Not provided"}`,
        `Previous detected type: ${input.previousObservation.detectedType || "unknown"}`,
        "Use progressStatus as one of: improved, unchanged, delayed, worsened, unknown."
      ].join("\n")
    : "No previous observation is available for comparison. Use progressStatus unknown, comparisonConfidence 0, and explain that this is the baseline.";
  const content: Array<Record<string, unknown>> = [
    {
      type: "input_text",
      text: [
        "Analyze this construction site photo for ProjectAxis.",
        "Return a cautious review suggestion only. Do not claim certainty, do not create official records, and do not invent measurements.",
        `Location: ${input.location || "Not provided"}`,
        `Trade: ${input.trade || "Not provided"}`,
        `Smart Camera Mode selected by user: ${input.observationMode}.`,
        `Detected type hint: ${input.detectedTypeHint || modeGuidance.detectedType}.`,
        `Mode guidance: ${modeGuidance.detail}`,
        "Use the selected mode as a strong hint, but correct it if the photo clearly shows something else.",
        "Classify detectedType as one of: defect, daily_report, safety, progress, inspection, material, unknown.",
        comparisonText,
        "Also draft a lightweight rectification assistant: rootCause, responsibleTrade, rectificationSteps, and closureChecklist.",
        "Return JSON with summary, detectedType, confidence, suggestedAction, suggestedTitle, suggestedDetails, progressStatus, progressDeltaSummary, comparisonConfidence, rootCause, responsibleTrade, rectificationSteps, and closureChecklist."
      ].join("\n")
    }
  ];

  if (input.previousObservation && input.previousImageDataUrl) {
    content.push(
      {
        type: "input_text",
        text: "Previous observation photo:"
      },
      {
        type: "input_image",
        image_url: input.previousImageDataUrl,
        detail: "low"
      }
    );
  }

  content.push(
    {
      type: "input_text",
      text: "Current uploaded photo:"
    },
    {
      type: "input_image",
      image_url: imageUrl,
      detail: "low"
    }
  );

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "user",
          content
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "site_observation_analysis",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: [
              "summary",
              "detectedType",
              "confidence",
              "suggestedAction",
              "suggestedTitle",
              "suggestedDetails",
              "progressStatus",
              "progressDeltaSummary",
              "comparisonConfidence",
              "rootCause",
              "responsibleTrade",
              "rectificationSteps",
              "closureChecklist"
            ],
            properties: {
              summary: { type: "string" },
              detectedType: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              suggestedAction: { type: "string" },
              suggestedTitle: { type: "string" },
              suggestedDetails: { type: "string" },
              progressStatus: {
                type: "string",
                enum: ["improved", "unchanged", "delayed", "worsened", "unknown"]
              },
              progressDeltaSummary: { type: "string" },
              comparisonConfidence: { type: "number", minimum: 0, maximum: 1 },
              rootCause: { type: "string" },
              responsibleTrade: { type: "string" },
              rectificationSteps: {
                type: "array",
                items: { type: "string" }
              },
              closureChecklist: {
                type: "array",
                items: { type: "string" }
              }
            }
          }
        }
      }
    })
  });

  const payload = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    const error = payload.error && typeof payload.error === "object" ? (payload.error as Record<string, unknown>) : null;
    throw new Error(String(error?.message ?? "OpenAI image analysis failed."));
  }

  const outputText = extractOpenAIText(payload);
  if (!outputText) {
    throw new Error("OpenAI did not return analysis text.");
  }

  const analysis = normalizeAnalysis(JSON.parse(outputText));
  if (!analysis) {
    throw new Error("OpenAI returned an invalid analysis shape.");
  }

  return analysis;
}

async function findPreviousObservation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: {
    projectId: string;
    location: string;
    trade: string;
    previousObservationId: string;
  }
): Promise<PreviousObservation | null> {
  if (input.previousObservationId && input.previousObservationId !== "auto" && input.previousObservationId !== "none") {
    let response = await supabase
      .from("ai_site_observations")
      .select(AI_OBSERVATION_RECURRENCE_SELECT)
      .eq("project_id", input.projectId)
      .eq("id", input.previousObservationId)
      .maybeSingle();
    if (isMissingRecurrenceColumn(response.error)) {
      response = await supabase
        .from("ai_site_observations")
        .select(AI_OBSERVATION_BASE_SELECT)
        .eq("project_id", input.projectId)
        .eq("id", input.previousObservationId)
        .maybeSingle();
    }

    const { data, error } = response;

    if (error) {
      throw Object.assign(new Error(error.message || "Unable to load the selected previous observation."), { status: 500 });
    }

    if (!data) {
      throw Object.assign(new Error("The selected previous observation could not be found."), { status: 400 });
    }

    if (!hasSameComparisonScope(data, input.location, input.trade)) {
      throw Object.assign(new Error("Select a previous observation from the same location and trade."), { status: 400 });
    }

    return mapPreviousObservationRow(data);
  }

  if (input.previousObservationId === "none") {
    return null;
  }

  let response: {
    data: Array<Parameters<typeof mapPreviousObservationRow>[0]> | null;
    error: { message?: string; code?: string } | null;
  } = await supabase
    .from("ai_site_observations")
    .select(AI_OBSERVATION_RECURRENCE_SELECT)
    .eq("project_id", input.projectId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (isMissingRecurrenceColumn(response.error)) {
    response = await supabase
      .from("ai_site_observations")
      .select(AI_OBSERVATION_BASE_SELECT)
      .eq("project_id", input.projectId)
      .order("created_at", { ascending: false })
      .limit(50);
  }

  const { data, error } = response;

  if (error) {
    throw Object.assign(new Error(error.message || "Unable to load previous observations."), { status: 500 });
  }

  const previous = (data ?? []).find((item) => hasSameComparisonScope(item, input.location, input.trade));
  if (!previous) {
    return null;
  }

  return mapPreviousObservationRow(previous);
}

async function loadRecurrenceCandidates(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string
): Promise<PreviousObservation[]> {
  let response: {
    data: Array<Parameters<typeof mapPreviousObservationRow>[0]> | null;
    error: { message?: string; code?: string } | null;
  } = await supabase
    .from("ai_site_observations")
    .select(AI_OBSERVATION_RECURRENCE_SELECT)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(80);

  if (isMissingRecurrenceColumn(response.error)) {
    response = await supabase
      .from("ai_site_observations")
      .select(AI_OBSERVATION_BASE_SELECT)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(80);
  }

  const { data, error } = response;

  if (error) {
    throw Object.assign(new Error(error.message || "Unable to load recurring issue candidates."), { status: 500 });
  }

  return (data ?? []).map((item) => mapPreviousObservationRow(item));
}

async function loadUnresolvedLinkedDefectIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  observations: PreviousObservation[]
) {
  const defectIds = Array.from(
    new Set(
      observations
        .filter((observation) => observation.linkedRecordType === "defect" && observation.linkedRecordId)
        .map((observation) => observation.linkedRecordId as string)
    )
  );

  if (!defectIds.length) {
    return new Set<string>();
  }

  const { data, error } = await supabase
    .from("defects")
    .select("id, status")
    .eq("project_id", projectId)
    .in("id", defectIds);

  if (error) {
    return new Set<string>();
  }

  return new Set((data ?? []).filter((defect) => defect.status !== "closed").map((defect) => defect.id));
}

async function detectRecurringIssue(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: {
    projectId: string;
    location: string;
    trade: string;
    analysis: SiteObservationAnalysis;
  }
): Promise<RecurrenceResult> {
  const candidates = await loadRecurrenceCandidates(supabase, input.projectId);
  const unresolvedDefectIds = await loadUnresolvedLinkedDefectIds(supabase, input.projectId, candidates);
  const currentText = `${input.analysis.summary} ${input.analysis.suggestedDetails}`;

  const scoredCandidates = candidates
    .map((candidate) => {
      const locationScore = calculateLocationSimilarity(input.location, candidate.location);
      const tradeScore = calculateTradeSimilarity(input.trade, candidate.trade);
      const typeScore =
        normalizeComparisonText(input.analysis.detectedType) &&
        normalizeComparisonText(input.analysis.detectedType) === normalizeComparisonText(candidate.detectedType)
          ? 1
          : 0;
      const summaryScore = calculateTokenSimilarity(currentText, candidate.aiSummary);
      const unresolvedDefectScore =
        candidate.linkedRecordType === "defect" && candidate.linkedRecordId && unresolvedDefectIds.has(candidate.linkedRecordId) ? 1 : 0;
      const existingRecurringScore = candidate.isRecurringIssue ? 1 : 0;
      const score =
        locationScore * 0.26 +
        tradeScore * 0.2 +
        typeScore * 0.22 +
        summaryScore * 0.22 +
        unresolvedDefectScore * 0.06 +
        existingRecurringScore * 0.04;

      return {
        candidate,
        score,
        locationScore,
        tradeScore,
        typeScore,
        summaryScore,
        unresolvedDefectScore
      };
    })
    .filter(
      (item) =>
        item.locationScore >= 0.55 &&
        item.tradeScore >= 0.55 &&
        item.typeScore > 0 &&
        (item.summaryScore >= 0.14 || item.unresolvedDefectScore > 0 || item.candidate.isRecurringIssue)
    )
    .sort((a, b) => b.score - a.score);

  const related = scoredCandidates.filter((item) => item.score >= 0.58 || (item.unresolvedDefectScore && item.score >= 0.5)).slice(0, 8);
  const isRecurringIssue = related.length > 0 && (related[0]?.score >= 0.68 || related.length >= 2);

  if (!isRecurringIssue) {
    return {
      recurrenceGroupId: null,
      recurrenceCount: 0,
      recurrenceSummary: "",
      isRecurringIssue: false,
      relatedObservationIds: []
    };
  }

  const recurrenceGroupId = related.find((item) => item.candidate.recurrenceGroupId)?.candidate.recurrenceGroupId ?? related[0].candidate.id;
  const unresolvedDefectCount = related.filter(
    (item) => item.candidate.linkedRecordType === "defect" && item.candidate.linkedRecordId && unresolvedDefectIds.has(item.candidate.linkedRecordId)
  ).length;
  const recurrenceCount = related.length + 1;

  return {
    recurrenceGroupId,
    recurrenceCount,
    recurrenceSummary: buildRecurrenceSummary({
      count: recurrenceCount,
      location: input.location,
      trade: input.trade,
      unresolvedDefectCount
    }),
    isRecurringIssue: true,
    relatedObservationIds: related.map((item) => item.candidate.id)
  };
}

async function updateRelatedRecurringObservations(
  supabase: Awaited<ReturnType<typeof createClient>>,
  recurrence: RecurrenceResult,
  followUp: { followUpDate: string | null; followUpReason: string }
) {
  if (!recurrence.isRecurringIssue || !recurrence.relatedObservationIds.length || !recurrence.recurrenceGroupId) {
    return;
  }

  const { error } = await supabase
    .from("ai_site_observations")
    .update({
      recurrence_group_id: recurrence.recurrenceGroupId,
      recurrence_count: recurrence.recurrenceCount,
      recurrence_summary: recurrence.recurrenceSummary,
      is_recurring_issue: true,
      follow_up_date: followUp.followUpDate,
      follow_up_reason: followUp.followUpReason
    })
    .in("id", recurrence.relatedObservationIds);

  if (error && isMissingFollowUpColumn(error)) {
    const { error: fallbackError } = await supabase
      .from("ai_site_observations")
      .update({
        recurrence_group_id: recurrence.recurrenceGroupId,
        recurrence_count: recurrence.recurrenceCount,
        recurrence_summary: recurrence.recurrenceSummary,
        is_recurring_issue: true
      })
      .in("id", recurrence.relatedObservationIds);

    if (fallbackError && !isMissingRecurrenceColumn(fallbackError)) {
      throw new Error(fallbackError.message || "Unable to update related recurring observations.");
    }
    return;
  }

  if (error && !isMissingRecurrenceColumn(error)) {
    throw new Error(error.message || "Unable to update related recurring observations.");
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const projectId = String(formData.get("projectId") ?? "").trim();
    const location = String(formData.get("location") ?? "").trim();
    const trade = String(formData.get("trade") ?? "").trim();
    const previousObservationId = String(formData.get("previousObservationId") ?? "auto").trim() || "auto";
    const observationMode = normalizeSmartCameraMode(formData.get("observationMode"));
    const detectedTypeHint = normalizeDetectedTypeHint(formData.get("detectedTypeHint"), observationMode);
    const image = formData.get("image");

    if (!projectId) {
      return jsonError("projectId is required.", 400);
    }

    if (!(image instanceof File) || image.size === 0) {
      return jsonError("Upload one site photo before running AI analysis.", 400);
    }

    if (!SUPPORTED_IMAGE_TYPES.has(image.type)) {
      return jsonError("Use a JPG, PNG, WEBP, or non-animated GIF image.", 400);
    }

    if (image.size > MAX_IMAGE_BYTES) {
      return jsonError("The uploaded image is too large. Keep site photos under 8 MB for AI analysis.", 413);
    }

    const access = await assertSiteIntelligenceAccess(projectId);
    const previousObservation = access
      ? await findPreviousObservation(access.supabase, {
          projectId,
          location,
          trade,
          previousObservationId
        })
      : null;
    const previousImageDataUrl =
      access && previousObservation?.imagePath
        ? (await storagePathToDataUrl(access.supabase, previousObservation.imagePath)) ?? getStoragePublicUrl(previousObservation.imagePath)
        : null;
    const analysis = await analyzeWithOpenAI({
      location,
      trade,
      image,
      previousObservation,
      previousImageDataUrl,
      observationMode,
      detectedTypeHint
    });
    const recurrence = access
      ? await detectRecurringIssue(access.supabase, {
          projectId,
          location,
          trade,
          analysis
        })
      : {
          recurrenceGroupId: null,
          recurrenceCount: 0,
          recurrenceSummary: "",
          isRecurringIssue: false,
          relatedObservationIds: []
        };
    const followUp = buildFollowUpSuggestion({ recurrence, location, trade });
    let observationId: string | null = null;
    let imagePath: string | null = null;
    let createdAt: string | null = null;

    if (access) {
      imagePath = `${projectId}/ai_site_observation/${crypto.randomUUID()}-${sanitizeFilename(image.name || "site-photo")}`;
      const { error: uploadError } = await access.supabase.storage.from(PROJECT_FILES_BUCKET).upload(imagePath, image, {
        cacheControl: "3600",
        upsert: false
      });

      if (uploadError) {
        throw new Error(uploadError.message || "Unable to save the AI site photo.");
      }

      const { data: observation, error: observationError } = await access.supabase
        .from("ai_site_observations")
        .insert({
          project_id: projectId,
          created_by_user_id: access.user.id,
          location,
          trade,
          image_path: imagePath,
          ai_summary: analysis.summary,
          detected_type: analysis.detectedType,
          confidence: analysis.confidence,
          status: "pending",
          previous_observation_id: previousObservation?.id ?? null,
          progress_status: analysis.progressStatus,
          progress_delta_summary: analysis.progressDeltaSummary,
          comparison_confidence: analysis.comparisonConfidence,
          recurrence_group_id: recurrence.recurrenceGroupId,
          recurrence_count: recurrence.recurrenceCount,
          recurrence_summary: recurrence.recurrenceSummary,
          is_recurring_issue: recurrence.isRecurringIssue,
          follow_up_date: followUp.followUpDate,
          follow_up_reason: followUp.followUpReason,
          root_cause: analysis.rootCause,
          responsible_trade: analysis.responsibleTrade,
          rectification_steps: analysis.rectificationSteps,
          closure_checklist: analysis.closureChecklist
        })
        .select("id, created_at")
        .single();

      if (observationError) {
        if (!isProgressPersistenceError(observationError)) {
          throw new Error(observationError.message || "Unable to save the AI site observation.");
        }

        const { data: fallbackObservation, error: fallbackError } = await access.supabase
          .from("ai_site_observations")
          .insert({
            project_id: projectId,
            created_by_user_id: access.user.id,
            location,
            trade,
            image_path: imagePath,
            ai_summary: analysis.summary,
            detected_type: analysis.detectedType,
            confidence: analysis.confidence,
            status: "pending"
          })
          .select("id, created_at")
          .single();

        if (fallbackError) {
          throw new Error(fallbackError.message || "Unable to save the AI site observation.");
        }

        observationId = String(fallbackObservation.id);
        createdAt = String(fallbackObservation.created_at);
      } else {
        observationId = String(observation.id);
        createdAt = String(observation.created_at);
        await updateRelatedRecurringObservations(access.supabase, recurrence, followUp);
      }
    }

    const response: SiteObservationAnalysisResponse = {
      ...analysis,
      observationId,
      imagePath,
      imagePublicUrl: imagePath ? getStoragePublicUrl(imagePath) : null,
      imageName: image.name || "site-photo",
      imageMimeType: image.type || "application/octet-stream",
      createdAt,
      previousObservationId: previousObservation?.id ?? null,
      recurrenceGroupId: recurrence.recurrenceGroupId,
      recurrenceCount: recurrence.recurrenceCount,
      recurrenceSummary: recurrence.recurrenceSummary,
      isRecurringIssue: recurrence.isRecurringIssue,
      followUpDate: followUp.followUpDate,
      followUpReason: followUp.followUpReason
    };

    return NextResponse.json(response);
  } catch (error) {
    const status = typeof (error as { status?: unknown }).status === "number" ? ((error as { status: number }).status) : 500;
    const message = error instanceof Error ? error.message : "Unable to analyze this site photo.";

    return jsonError(message, status);
  }
}
