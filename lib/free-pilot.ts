export const FREE_PILOT_MAX_ATTACHMENTS_PER_UPLOAD = 5;
export const FREE_PILOT_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const FREE_PILOT_IMAGE_TARGET_BYTES = Math.round(1.8 * 1024 * 1024);
export const FREE_PILOT_MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const FREE_PILOT_MAX_IMAGE_DIMENSION = 1600;
export const FREE_PILOT_RECOMMENDED_ACTIVE_TESTERS = 5;
export const FREE_PILOT_RECOMMENDED_PROJECTS = 1;

export const FREE_PILOT_IMAGE_ONLY_ACCEPT = "image/*";
export const FREE_PILOT_MIXED_ACCEPT = "image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx";
export const FREE_PILOT_EXCEL_IMPORT_ACCEPT = ".xlsx,.xlsm";

export type FreePilotUploadMode = "image-only" | "mixed";

export function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${bytes} B`;
}

export function getFreePilotUploadHint(mode: FreePilotUploadMode) {
  if (mode === "image-only") {
    return `Free pilot: up to ${FREE_PILOT_MAX_ATTACHMENTS_PER_UPLOAD} photos. Images are auto-optimized. Video is disabled for now.`;
  }

  return `Free pilot: up to ${FREE_PILOT_MAX_ATTACHMENTS_PER_UPLOAD} files. Photos are auto-optimized, documents stay under ${formatBytes(FREE_PILOT_MAX_DOCUMENT_BYTES)}, and video is disabled.`;
}
