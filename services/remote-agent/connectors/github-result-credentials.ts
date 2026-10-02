const CREDENTIAL_QUERY_KEY = /token|secret|password|signature|api[_-]?key/iu;

// Private GitHub Contents responses include a temporary bearer credential in
// download_url. Keep decoded source and ordinary links; authenticated downloads
// remain behind the selected provider connection, never in a model-visible URL.
export function withholdGitHubDownloadCredentials(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withholdGitHubDownloadCredentials);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === "download_url" && typeof item === "string"
        ? publicDownloadUrl(item)
        : withholdGitHubDownloadCredentials(item),
    ])
  );
}

function publicDownloadUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      [...url.searchParams.keys()].some((key) => CREDENTIAL_QUERY_KEY.test(key))
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}
