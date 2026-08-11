import packageJson from "../../package.json";

type CliPackageJson = {
  version: string;
  openMeldReleaseDate?: string;
};

export type CliVersionInfo = {
  version: string;
  releaseDate: string | null;
  releaseDateLabel: string | null;
  summary: string;
};

const PACKAGE_JSON = packageJson as CliPackageJson;
const ISO_RELEASE_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/u;

export function getCliVersionInfo(): CliVersionInfo {
  const version = PACKAGE_JSON.version;
  const releaseDate = normalizeReleaseDate(PACKAGE_JSON.openMeldReleaseDate);
  const releaseDateLabel = releaseDate
    ? formatCliReleaseDateLabel(releaseDate)
    : null;

  return {
    version,
    releaseDate,
    releaseDateLabel,
    summary: formatCliVersionSummary({
      version,
      releaseDateLabel,
    }),
  };
}

export function formatCliVersionSummary(input?: {
  version: string;
  releaseDateLabel: string | null;
}): string {
  const versionInfo = input ?? getCliVersionInfo();
  if (!versionInfo.releaseDateLabel) {
    return `Current version: ${versionInfo.version}`;
  }
  return `Current version: ${versionInfo.version} • ${versionInfo.releaseDateLabel}`;
}

function normalizeReleaseDate(value: string | undefined): string | null {
  const normalized = String(value ?? "").trim();
  if (!ISO_RELEASE_DATE_RE.test(normalized)) {
    return null;
  }
  return normalized;
}

function formatCliReleaseDateLabel(releaseDate: string): string {
  const match = releaseDate.match(ISO_RELEASE_DATE_RE);
  if (!match) {
    return releaseDate;
  }
  return `${match[2]}-${match[3]}`;
}
