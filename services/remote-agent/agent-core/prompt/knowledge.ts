export function renderRemoteAgentKnowledgePrompt(
  documentTitles: readonly string[] | null | undefined
): string | null {
  const titles = (documentTitles ?? [])
    .map((title) => title.trim().replaceAll(/\s+/g, " "))
    .filter(Boolean);
  if (titles.length === 0) {
    return null;
  }
  return `Organization documents available: ${titles.join(", ")}`;
}
