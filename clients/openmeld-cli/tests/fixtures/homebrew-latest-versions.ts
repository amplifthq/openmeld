// Captured from https://formulae.brew.sh/api/formula/opencode.json on 2026-07-11.
export const OPENCODE_HOMEBREW_FORMULA_URL =
  "https://formulae.brew.sh/api/formula/opencode.json";

export const OPENCODE_HOMEBREW_FORMULA_RESPONSE = {
  name: "opencode",
  versions: {
    stable: "1.17.15",
    head: null,
    bottle: true,
  },
  aliases: [],
  deprecated: false,
} as const;

// Captured from https://formulae.brew.sh/api/cask/claude-code.json on 2026-07-11.
export const CLAUDE_CODE_HOMEBREW_CASK_URL =
  "https://formulae.brew.sh/api/cask/claude-code.json";

export const CLAUDE_CODE_HOMEBREW_CASK_RESPONSE = {
  token: "claude-code",
  version: "2.1.197",
} as const;

export const CURSOR_HOMEBREW_CASK_URL =
  "https://formulae.brew.sh/api/cask/cursor-cli.json";

export const OPENCODE_TAP_FORMULA_URL =
  "https://raw.githubusercontent.com/anomalyco/homebrew-tap/HEAD/opencode.rb";

export const OPENCODE_TAP_FORMULA_SOURCE = [
  "class Opencode < Formula",
  '  homepage "https://github.com/anomalyco/opencode"',
  '  version "1.18.22"',
  "end",
  "",
].join("\n");

export const GROK_STABLE_VERSION_URL = "https://x.ai/cli/stable";

export const OPENCODE_GITHUB_RELEASES_URL =
  "https://api.github.com/repos/anomalyco/opencode/releases/latest";
