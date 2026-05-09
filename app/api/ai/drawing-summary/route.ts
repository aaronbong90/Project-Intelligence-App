import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PROJECT_FILES_BUCKET } from "@/lib/storage";

type DrawingSummary = {
  drawingTitle: string;
  discipline: string;
  likelyZones: string[];
  keyNotes: string[];
  risks: string[];
};

const SUPPORTED_DRAWING_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"]);

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
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

function normalizeDrawingSummary(value: unknown, fallbackTitle: string, fallbackDiscipline: string): DrawingSummary {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    drawingTitle: String(record.drawingTitle ?? fallbackTitle).trim() || fallbackTitle || "Untitled drawing",
    discipline: String(record.discipline ?? fallbackDiscipline).trim() || fallbackDiscipline || "Unknown",
    likelyZones: normalizeStringArray(record.likelyZones).slice(0, 12),
    keyNotes: normalizeStringArray(record.keyNotes).slice(0, 12),
    risks: normalizeStringArray(record.risks).slice(0, 12)
  };
}

function createDemoSummary(input: { title: string; discipline: string; sheetNumber: string }): DrawingSummary {
  const drawingTitle = input.title || input.sheetNumber || "Uploaded drawing";
  const discipline = input.discipline || "General construction";

  return {
    drawingTitle,
    discipline,
    likelyZones: ["Primary work area", "Adjacent coordination zone", "Entry / access area"],
    keyNotes: [
      "Demo summary only because no OpenAI API key is configured.",
      "Review drawing title, revision, zones, and notes manually before using this for site coordination.",
      "Use the Drawing Register to link this sheet to AI observations, defects, or daily reports."
    ],
    risks: [
      "Drawing scale and room labels were not verified by AI in demo mode.",
      "Revision status should be checked before linking site records.",
      "Unclear or cropped drawing areas may require manual review."
    ]
  };
}

async function blobToDataUrl(blob: Blob, mimeType: string) {
  const buffer = Buffer.from(await blob.arrayBuffer());
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
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

async function analyzeDrawingWithOpenAI(input: {
  blob: Blob;
  mimeType: string;
  fileName: string;
  title: string;
  discipline: string;
  sheetNumber: string;
  revision: string;
}): Promise<DrawingSummary> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return createDemoSummary(input);
  }

  const dataUrl = await blobToDataUrl(input.blob, input.mimeType);
  const model = process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";
  const content: Array<Record<string, unknown>> = [
    {
      type: "input_text",
      text: [
        "Analyze this construction drawing for ProjectAxis.",
        "Return a cautious summary only. Do not invent measurements, approvals, or room names that are not visible.",
        `Current register title: ${input.title || "Not provided"}`,
        `Current discipline: ${input.discipline || "Not provided"}`,
        `Sheet number: ${input.sheetNumber || "Not provided"}`,
        `Revision: ${input.revision || "Not provided"}`,
        "Identify drawing title, discipline, likely zones or rooms, key coordination notes, and possible risks or unclear areas.",
        "Return JSON with drawingTitle, discipline, likelyZones, keyNotes, and risks."
      ].join("\n")
    }
  ];

  if (input.mimeType === "application/pdf") {
    content.push({
      type: "input_file",
      filename: input.fileName || "drawing.pdf",
      file_data: dataUrl
    });
  } else {
    content.push({
      type: "input_image",
      image_url: dataUrl,
      detail: "high"
    });
  }

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
          name: "drawing_summary",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["drawingTitle", "discipline", "likelyZones", "keyNotes", "risks"],
            properties: {
              drawingTitle: { type: "string" },
              discipline: { type: "string" },
              likelyZones: {
                type: "array",
                items: { type: "string" }
              },
              keyNotes: {
                type: "array",
                items: { type: "string" }
              },
              risks: {
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
    throw new Error(String(error?.message ?? "OpenAI drawing summary failed."));
  }

  const outputText = extractOpenAIText(payload);
  if (!outputText) {
    throw new Error("OpenAI did not return drawing summary text.");
  }

  return normalizeDrawingSummary(JSON.parse(outputText), input.title, input.discipline);
}

export async function POST(request: NextRequest) {
  try {
    const { drawingSheetId } = (await request.json()) as { drawingSheetId?: string };
    if (!drawingSheetId) {
      return jsonError("drawingSheetId is required.", 400);
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return jsonError("Sign in before summarizing drawings.", 401);
    }

    const { data: drawing, error: drawingError } = await supabase
      .from("drawing_sheets")
      .select("id, project_id, title, revision, discipline, sheet_number, file_path")
      .eq("id", drawingSheetId)
      .single();

    if (drawingError || !drawing) {
      return jsonError(drawingError?.message || "Drawing sheet not found.", 404);
    }

    const { data: hasAccess, error: accessError } = await supabase.rpc("has_project_access", {
      project_uuid: drawing.project_id
    });

    if (accessError) {
      return jsonError(accessError.message || "Unable to verify project access.", 500);
    }

    if (!hasAccess) {
      return jsonError("You do not have access to this drawing sheet.", 403);
    }

    const { data: fileBlob, error: downloadError } = await supabase.storage.from(PROJECT_FILES_BUCKET).download(drawing.file_path);
    if (downloadError || !fileBlob) {
      return jsonError(downloadError?.message || "Unable to download drawing file.", 500);
    }

    const fileName = drawing.file_path.split("/").pop() || "drawing";
    const mimeType = fileBlob.type || (fileName.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
    if (!SUPPORTED_DRAWING_TYPES.has(mimeType)) {
      return jsonError("AI drawing summary supports PDF, JPG, PNG, WEBP, or GIF drawings.", 400);
    }

    const summary = await analyzeDrawingWithOpenAI({
      blob: fileBlob,
      mimeType,
      fileName,
      title: drawing.title ?? "",
      discipline: drawing.discipline ?? "",
      sheetNumber: drawing.sheet_number ?? "",
      revision: drawing.revision ?? ""
    });
    const summarizedAt = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("drawing_sheets")
      .update({
        ai_drawing_title: summary.drawingTitle,
        ai_discipline: summary.discipline,
        ai_likely_zones: summary.likelyZones,
        ai_key_notes: summary.keyNotes,
        ai_risks: summary.risks,
        ai_summarized_at: summarizedAt
      })
      .eq("id", drawingSheetId);

    if (updateError) {
      const message =
        updateError.message.includes("ai_drawing_title") || updateError.message.includes("schema cache")
          ? "Run the AI Drawing Summary Supabase migration before saving summaries."
          : updateError.message;
      return jsonError(message, 500);
    }

    return NextResponse.json({
      drawingSheetId,
      ...summary,
      summarizedAt
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to summarize this drawing.";
    return jsonError(message, 500);
  }
}
