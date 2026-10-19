// Contract: design-plans/member-agent-program.md §4.6 and §4.10. When the
// request chain's root is not the Agent owner, other people read the Agent's
// replies. Paths and machine identity are owner-only (§4.10); the Agent is
// told so in its task prompt. Owner-rooted tasks get no such section.

const PATH_SEPARATOR = /[/\\]/u;
// "C:" drive-qualified forms, and anything that looks like an email address.
const DRIVE_OR_ACCOUNT = /^[A-Za-z]:|@/u;

/**
 * A folder name is shown only when it cannot itself be a path or an account.
 * A custom folder's default name is its basename, but a fallback can be a
 * path slice. Names that match this computer's identity are removed by the
 * Service, which knows it (readProfileFolderDisplayName).
 */
export function toPromptSafeFolderDisplayName(
  displayName: string | null | undefined
): string | null {
  const name = displayName?.trim();
  if (
    !name ||
    PATH_SEPARATOR.test(name) ||
    DRIVE_OR_ACCOUNT.test(name) ||
    name.startsWith("~")
  ) {
    return null;
  }
  return name;
}

/**
 * Task-prompt guidance for a task OpenMeld did not verify as owner-requested:
 * a non-owner root, or a requester it could not verify.
 */
export function renderNonOwnerAudiencePathGuidance(input: {
  folderDisplayName?: string | null;
}): string {
  const folderName = toPromptSafeFolderDisplayName(input.folderDisplayName);
  const folderReference = folderName
    ? `the working folder ${JSON.stringify(folderName)}`
    : "the working folder";
  return [
    "Visible audience: OpenMeld did not verify that the Agent owner asked for this task, so assume people other than the owner read your replies and Space messages.",
    "- Do not reveal absolute local paths, home directory or user folder names, computer names, or account identifiers (usernames, email addresses, account or device ids) from this computer. This includes command output you quote, such as `pwd`, `ls -l`, `whoami`, or error messages.",
    `- Refer to ${folderReference} by that name, and to files by paths relative to it.`,
  ].join("\n");
}
