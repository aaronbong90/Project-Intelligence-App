import type { SupabaseClient } from "@supabase/supabase-js";
import { PROJECT_FILES_BUCKET } from "@/lib/storage";
import type { AttachmentRecord, AiSiteObservationStatus, RecordSectionType } from "@/types/app";

export async function updateAiSiteObservationStatus(
  supabase: SupabaseClient,
  observationId: string,
  status: AiSiteObservationStatus
) {
  const { error } = await supabase.from("ai_site_observations").update({ status }).eq("id", observationId);

  if (error) {
    throw error;
  }
}

export async function linkAiSiteObservationToRecord(
  supabase: SupabaseClient,
  input: {
    observationId: string;
    linkedRecordType: "defect" | "daily_report";
    linkedRecordId: string;
  }
) {
  const { error } = await supabase
    .from("ai_site_observations")
    .update({
      status: "approved",
      linked_record_type: input.linkedRecordType,
      linked_record_id: input.linkedRecordId
    })
    .eq("id", input.observationId);

  if (error) {
    throw error;
  }
}

export async function attachAiSiteObservationImage(
  supabase: SupabaseClient,
  input: {
    projectId: string;
    sectionType: Extract<RecordSectionType, "daily_report" | "defect">;
    recordId: string;
    imagePath: string;
    name: string;
    mimeType?: string;
  }
) {
  const { data: attachmentRow, error } = await supabase
    .from("attachments")
    .insert({
      project_id: input.projectId,
      section_type: input.sectionType,
      record_id: input.recordId,
      name: input.name,
      mime_type: input.mimeType ?? "image/jpeg",
      storage_path: input.imagePath
    })
    .select("id, name, mime_type, storage_path")
    .single();

  if (error) {
    throw error;
  }

  const { data: publicUrlData } = supabase.storage.from(PROJECT_FILES_BUCKET).getPublicUrl(input.imagePath);

  return {
    id: String(attachmentRow.id),
    name: String(attachmentRow.name),
    mimeType: String(attachmentRow.mime_type),
    path: String(attachmentRow.storage_path),
    publicUrl: publicUrlData.publicUrl
  } satisfies AttachmentRecord;
}

