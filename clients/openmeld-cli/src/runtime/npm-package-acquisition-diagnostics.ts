const DEFAULT_PACKAGE_NAME = "openmeld";

const LOCAL_PROXY_FAILURE_PATTERN =
  /\b(?:connect\s+(?:EPERM|ECONNREFUSED|ECONNRESET|ETIMEDOUT)\s+(?:127\.0\.0\.1|localhost)(?::\d+)?|reason:\s*connect\s+(?:EPERM|ECONNREFUSED|ECONNRESET|ETIMEDOUT)\s+(?:127\.0\.0\.1|localhost)(?::\d+)?)/iu;
const NPM_CACHE_OR_LOG_PERMISSION_PATTERN =
  /(?:log files were not written|(?:EACCES|EPERM)[\s\S]{0,160}\.npm|\.npm[\s\S]{0,160}(?:EACCES|EPERM))/iu;
const NPM_REGISTRY_FAILURE_PATTERN = /registry\.npmjs\.org/iu;

export type NpmPackageAcquisitionFailureDiagnosis = {
  code:
    | "npm_local_proxy_unreachable"
    | "npm_cache_or_log_unwritable"
    | "npm_registry_fetch_failed";
  message: string;
  nextSteps: string[];
};

export function diagnoseNpmPackageAcquisitionFailure(input: {
  packageName?: string;
  text: string;
}): NpmPackageAcquisitionFailureDiagnosis | null {
  const text = input.text.trim();
  if (!text) {
    return null;
  }
  const packageName = input.packageName ?? DEFAULT_PACKAGE_NAME;

  if (LOCAL_PROXY_FAILURE_PATTERN.test(text)) {
    return {
      code: "npm_local_proxy_unreachable",
      message:
        "npm is trying to download the OpenMeld CLI through a local proxy, but that proxy is not reachable.",
      nextSteps: [
        "Start the local proxy app or turn off the npm proxy setting.",
        "Check npm proxy settings with `npm config get proxy` and `npm config get https-proxy`.",
        `Retry the OpenMeld setup or upgrade command after npm can reach ${packageName}.`,
      ],
    };
  }

  if (NPM_CACHE_OR_LOG_PERMISSION_PATTERN.test(text)) {
    return {
      code: "npm_cache_or_log_unwritable",
      message:
        "npm cannot write to its local cache or log directory, so it cannot install the OpenMeld CLI.",
      nextSteps: [
        "Check ownership and permissions for `~/.npm` and `~/.npm/_logs`.",
        "Create the missing npm log directory if needed with `mkdir -p ~/.npm/_logs`.",
        `Retry the OpenMeld setup or upgrade command after npm can install ${packageName}.`,
      ],
    };
  }

  if (NPM_REGISTRY_FAILURE_PATTERN.test(text) || text.includes(packageName)) {
    return {
      code: "npm_registry_fetch_failed",
      message:
        "npm could not download the latest OpenMeld CLI from the npm registry.",
      nextSteps: [
        "Check that this computer can reach `https://registry.npmjs.org`.",
        "Fix the npm/network error shown above, then retry the OpenMeld setup or upgrade command.",
      ],
    };
  }

  return null;
}

export function formatNpmPackageAcquisitionFailureDiagnosis(
  diagnosis: NpmPackageAcquisitionFailureDiagnosis
): string {
  return [
    `Detected cause: ${diagnosis.message}`,
    "Next steps:",
    ...diagnosis.nextSteps.map((step) => `- ${step}`),
  ].join("\n");
}
