import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MAX_ASSISTANT_FILES = 5;
const MAX_ASSISTANT_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_SNIPPET_LENGTH = 12_000;
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const SUPPORTED_TEXT_TYPES = new Set(["application/json", "text/csv", "text/markdown", "text/plain"]);

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function blobToDataUrl(blob: Blob, mimeType: string) {
  const buffer = Buffer.from(await blob.arrayBuffer());
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

async function readTextSnippet(file: File) {
  const text = await file.text();
  return text.length > MAX_TEXT_SNIPPET_LENGTH ? `${text.slice(0, MAX_TEXT_SNIPPET_LENGTH)}\n\n[File truncated for AI review.]` : text;
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

function createDemoAssistantResult(input: { moduleName: string; outputType: string; prompt: string; fileCount: number }) {
  return [
    `Demo AI response for ${input.moduleName}.`,
    "",
    `Requested output: ${input.outputType || "draft"}`,
    `Reference files attached: ${input.fileCount}`,
    "",
    "Suggested next step:",
    "1. Review the request details against the saved project records.",
    "2. Pull key dates, parties, quantities, and status items into a concise draft.",
    "3. Confirm any assumptions before issuing or saving the final record.",
    "",
    `Prompt reviewed: ${input.prompt}`
  ].join("\n");
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return jsonError("Sign in before using the module AI assistant.", 401);
    }

    const formData = await request.formData();
    const moduleName = String(formData.get("moduleName") ?? "Project module").trim() || "Project module";
    const outputType = String(formData.get("aiOutputType") ?? "draft").trim() || "draft";
    const prompt = String(formData.get("aiPrompt") ?? "").trim();
    const files = formData.getAll("aiFiles").filter((value): value is File => value instanceof File && value.size > 0);

    if (!prompt) {
      return jsonError("Prompt is required.", 400);
    }

    if (files.length > MAX_ASSISTANT_FILES) {
      return jsonError(`Attach up to ${MAX_ASSISTANT_FILES} files for one AI request.`, 400);
    }

    const oversizedFile = files.find((file) => file.size > MAX_ASSISTANT_FILE_BYTES);
    if (oversizedFile) {
      return jsonError(`${oversizedFile.name || "One file"} is too large. Keep each file under 8 MB.`, 413);
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        mode: "demo",
        result: createDemoAssistantResult({ moduleName, outputType, prompt, fileCount: files.length })
      });
    }

    const content: Array<Record<string, unknown>> = [
      {
        type: "input_text",
        text: [
          "You are ProjectAxis AI, helping a construction project team work faster and more clearly.",
          `Module: ${moduleName}`,
          `Requested output type: ${outputType}`,
          "Use the user's prompt and any attached reference files. Be practical, concise, and call out assumptions.",
          "Do not invent approvals, dates, quantities, or commitments that are not provided.",
          "",
          `User prompt:\n${prompt}`
        ].join("\n")
      }
    ];

    for (const file of files) {
      const mimeType = file.type || "application/octet-stream";

      if (SUPPORTED_IMAGE_TYPES.has(mimeType)) {
        content.push({
          type: "input_image",
          image_url: await blobToDataUrl(file, mimeType),
          detail: "high"
        });
        continue;
      }

      if (mimeType === "application/pdf") {
        content.push({
          type: "input_file",
          filename: file.name || "reference.pdf",
          file_data: await blobToDataUrl(file, mimeType)
        });
        continue;
      }

      if (SUPPORTED_TEXT_TYPES.has(mimeType) || mimeType.startsWith("text/")) {
        content.push({
          type: "input_text",
          text: `Reference file: ${file.name || "untitled"}\n${await readTextSnippet(file)}`
        });
        continue;
      }

      content.push({
        type: "input_text",
        text: `Reference file attached but not directly readable by AI: ${file.name || "untitled"} (${mimeType}, ${file.size} bytes).`
      });
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_TEXT_MODEL || process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini",
        input: [
          {
            role: "user",
            content
          }
        ]
      })
    });

    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      const error = payload.error && typeof payload.error === "object" ? (payload.error as Record<string, unknown>) : null;
      throw new Error(String(error?.message ?? "AI assistant request failed."));
    }

    const result = extractOpenAIText(payload).trim();
    if (!result) {
      throw new Error("AI assistant did not return a response.");
    }

    return NextResponse.json({ mode: "live", result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to run the module AI assistant.";
    return jsonError(message, 500);
  }
}
