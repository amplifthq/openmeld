const CLOUDFLARE_VERSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const NON_VERSIONED_SETTING_PATTERN = /"(logpush|tail_consumers)"\s*:/gu;

export function validateCoreVersionReleaseConfig(source) {
  const unsupportedSettings = [
    ...source.matchAll(NON_VERSIONED_SETTING_PATTERN),
  ].map((match) => match[1]);
  const uniqueUnsupportedSettings = [...new Set(unsupportedSettings)].sort();
  if (uniqueUnsupportedSettings.length > 0) {
    throw new Error(
      `Core version release cannot apply non-versioned Wrangler settings: ${uniqueUnsupportedSettings.join(", ")}. Add an explicit reviewed configuration deployment path before using these settings.`
    );
  }
}

export function buildCoreVersionReleaseStepSpecs(input) {
  if (!CLOUDFLARE_VERSION_ID_PATTERN.test(input.versionId)) {
    throw new Error("Core release requires an exact Cloudflare version ID");
  }
  validateCoreVersionReleaseConfig(input.wranglerConfigSource);
  // Atomic migration deployment already applied this version and its triggers.
  if (input.trafficPercent === 100) {
    return [];
  }
  const wranglerPrefix = [
    "--dir",
    "services/core",
    "exec",
    "dotenv",
    "-e",
    "../../.env",
    "-o",
    "--",
    "wrangler",
  ];
  return [
    {
      args: [
        ...wranglerPrefix,
        "versions",
        "deploy",
        `${input.versionId}@100%`,
        "--env",
        "prod",
        "--yes",
      ],
      command: "pnpm",
      label: "Deploy the startup-admitted Core version",
    },
    {
      args: [...wranglerPrefix, "triggers", "deploy", "--env", "prod"],
      command: "pnpm",
      label: "Synchronize Core triggers",
    },
  ];
}
