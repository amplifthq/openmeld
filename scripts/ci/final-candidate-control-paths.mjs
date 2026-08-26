const CONTROL_PATH_PATTERNS = [
  /^\.github\/actions\/trusted-git-network\/action\.yml$/u,
  /^\.github\/workflows\/final-candidate\.yml$/u,
  /^package\.json$/u,
  /^pnpm-lock\.yaml$/u,
  /^pnpm-workspace\.yaml$/u,
  /^turbo\.json$/u,
  /^scripts\/ci\/final-candidate(?:-[^/]*)?\.(?:mjs|test\.mjs)$/u,
  /^scripts\/ci\/(?:install-isolated-candidate-dependencies|prepare-isolated-candidate)(?:\.test\.mjs|\.sh)$/u,
  /^scripts\/ci\/(?:resolve-approved-native-builds|trusted-git-network)(?:\.test)?\.mjs$/u,
  /^scripts\/ci\/run-isolated-candidate-command\.sh$/u,
  /^scripts\/ci\/trusted-final-candidate\.sh$/u,
  /^scripts\/ci\/verify-trusted-candidate-entrypoints(?:\.test)?\.mjs$/u,
  /^scripts\/dev\/turbo-affected(?:\.test)?\.mjs$/u,
  /^packages\/schemas\/src\/schemas\/ci\/final-candidate\.ts$/u,
];

export function isFinalCandidateControlPath(relativePath) {
  return CONTROL_PATH_PATTERNS.some((pattern) => pattern.test(relativePath));
}
