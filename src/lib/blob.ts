export const BLOB_MAX_BYTES = 8 * 1024 * 1024;

export function parseMime(value: string | null | undefined): string | null {
  if (!value) return null;
  const mime = value.split(";")[0]!.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mime)) {
    return null;
  }
  return mime;
}

export function sanitizeFilename(value: string | null | undefined): string {
  const raw = (value ?? "blob").replace(/\\/g, "/").split("/").pop() ?? "blob";
  const cleaned = raw.replace(/[\u0000-\u001f\u007f"]/g, "").trim() || "blob";
  return cleaned.slice(0, 255);
}
