export const NODE_TITLE_MAX_BYTES = 200;
export const NODE_SUMMARY_MAX_BYTES = 512;
export const NODE_CONTENT_MAX_BYTES = 32768;

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function stripRawHtml(src: string): string {
  const parts = src.split(/(```[\s\S]*?```)/);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<\/?[A-Za-z][^>]*>/g, "");
    })
    .join("");
}

export function rejectTitle(title: string): "empty" | "too_large" | null {
  if (title.trim() === "") return "empty";
  if (utf8Bytes(title) > NODE_TITLE_MAX_BYTES) return "too_large";
  return null;
}

export function rejectSummary(
  summary: string | null | undefined,
): "too_large" | null {
  if (summary == null) return null;
  if (utf8Bytes(summary) > NODE_SUMMARY_MAX_BYTES) return "too_large";
  return null;
}

export function rejectContent(
  content: string | null | undefined,
): "too_large" | null {
  if (content == null) return null;
  if (utf8Bytes(content) > NODE_CONTENT_MAX_BYTES) return "too_large";
  return null;
}
