export function toSlug(value: string): string {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (raw.length === 0) {
    return "anon";
  }
  return (
    raw
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "anon"
  );
}
