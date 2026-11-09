export function textToAdf(text: string): {
  type: "doc";
  version: 1;
  content: Array<{
    type: "paragraph";
    content?: Array<{ type: "text"; text: string }>;
  }>;
} {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  return {
    type: "doc",
    version: 1,
    content: lines.map((line) => ({
      type: "paragraph",
      content: [{ type: "text", text: line }],
    })),
  };
}

export function commentToText(comment: unknown): string {
  if (typeof comment === "string") return comment;
  if (!comment || typeof comment !== "object") return "";
  return collectText(comment).replace(/\n{3,}/g, "\n\n").trim();
}

function collectText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const record = node as { text?: unknown; content?: unknown; type?: unknown };
  const own = typeof record.text === "string" ? record.text : "";
  if (!Array.isArray(record.content)) return own;
  const children = record.content.map((child) => collectText(child));
  const separator = record.type === "doc" ? "\n" : "";
  return [own, ...children].filter((part) => part.length > 0).join(separator);
}
