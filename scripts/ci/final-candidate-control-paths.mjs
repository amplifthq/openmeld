const CONTROL_PATH_PATTERNS = [
  /^\.github\/workflows\/codeql\.yml$/u,
  /^\.github\/actions\/trusted-git-network\/action\.yml$/u,
  /^\.github\/workflows\/final-candidate(?:-result)?\.yml$/u,
  /^\.github\/workflows\/merge-group-final-candidate\.yml$/u,
  /^\.npmrc$/u,
  /^package\.json$/u,
  /^pnpm-workspace\.yaml$/u,
  /^turbo\.json$/u,
  /^release\/repository-migration\.json$/u,
  /^scripts\/ci\/final-candidate(?:-[^/]*)?\.(?:mjs|test\.mjs)$/u,
  /^scripts\/ci\/download-prior-final-candidate-evidence(?:\.test\.mjs|\.sh)$/u,
  /^scripts\/ci\/install-isolated-candidate-dependencies(?:\.test\.mjs|\.sh)$/u,
  /^scripts\/ci\/(?:resolve-approved-native-builds|trusted-git-network)(?:\.test)?\.mjs$/u,
  /^scripts\/ci\/run-isolated-candidate-command\.sh$/u,
  /^scripts\/ci\/trusted-final-candidate\.sh$/u,
  /^scripts\/ci\/verify-trusted-candidate-entrypoints(?:\.test)?\.mjs$/u,
  /^scripts\/dev\/turbo-affected(?:\.test)?\.mjs$/u,
  /^scripts\/dev\/affected-workspaces(?:\.test)?\.mjs$/u,
  /^scripts\/dev\/verify-pr(?:\.test)?\.mjs$/u,
  /^scripts\/dev\/(?:owned-command|process-rows|process-tree)(?:\.test)?\.mjs$/u,
  /^scripts\/release\/cli-skill(?:-check)?\.mjs$/u,
  /^scripts\/release\/(?:deploy(?:-component)?|live-release|production-(?:artifact-check|web-health)|publish-cli|renderer-build)(?:\.test)?\.mjs$/u,
  /^release\/components\.mjs$/u,
  /^packages\/schemas\/src\/schemas\/ci\/final-candidate\.ts$/u,
];

export function isFinalCandidateControlPath(relativePath) {
  return CONTROL_PATH_PATTERNS.some((pattern) => pattern.test(relativePath));
}
