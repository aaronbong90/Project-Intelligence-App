export const PROJECT_FILES_BUCKET = "project-files";

export function getStoragePublicUrl(path: string) {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!baseUrl) return null;
  return `${baseUrl}/storage/v1/object/public/${PROJECT_FILES_BUCKET}/${path}`;
}
