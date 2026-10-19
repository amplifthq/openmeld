// Contract: design-plans/member-agent-program.md §4.6 and §4.10. When the
// request chain's root is not the Agent owner, other people read the Agent's
// replies. Paths and machine identity are owner-only (§4.10); the Agent is
// told so in its task prompt. Owner-rooted tasks get no such section.

const PATH_SEPARATOR = /[/\\]/u;

/**
 * A folder name is shown only when it cannot itself be a path. A custom
 * folder's default name is its basename, but a fallback can be a path slice.
 */
export function toPromptSafeFolderDisplayName(
  displayName: string | null | undefined
): string | null {
  const name = displayName?.trim();
  if (!name || PATH_SEPARATOR.test(name) || name.startsWith("~")) {
    return null;
  }
  return name;
}

/** Task-prompt guidance for a task whose root requester is not the owner. */
export function renderNonOwnerAudiencePathGuidance(input: {
  folderDisplayName?: string | null;
}): string {
  const folderName = toPromptSafeFolderDisplayName(input.folderDisplayName);
  const folderReference = folderName
    ? `the working folder ${JSON.stringify(folderName)}`
    : "the working folder";
  return [
    "Visible audience: someone other than the Agent owner asked for this task, so people other than the owner read your replies and Space messages.",
    "- Do not reveal absolute local paths, home directory or user folder names, computer names, or account identifiers (usernames, email addresses, account or device ids) from this computer. This includes command output you quote, such as `pwd`, `ls -l`, `whoami`, or error messages.",
    `- Refer to ${folderReference} by that name, and to files by paths relative to it.`,
  ].join("\n");
}
