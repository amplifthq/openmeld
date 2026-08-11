import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "../../..");

const ACTIVE_MENTION_BOUNDARY_FILES = [
  "clients/openmeld-cli/src/space/composer-submission-adapter.ts",
  "clients/openmeld-cli/src/space/shell/pi-tui/pi-tui-composer-autocomplete-provider.ts",
  "clients/openmeld-cli/src/space/connect.ts",
  "clients/openmeld-cli/src/space/transcript/transcript-render.ts",
  "clients/openmeld-cli/src/ui/output.ts",
  "clients/openmeld-cli/src/commands/agents.ts",
  "clients/openmeld-cli/src/commands/agents-text.ts",
  "clients/web/src/components/landing-page/first-section-demo/space/space-members-card.tsx",
  "clients/web/src/components/landing-page/first-section-demo/space/space-system-feed.tsx",
  "packages/schemas/src/schemas/http/space-mention-label.ts",
  "packages/schemas/src/schemas/http/space-members.ts",
  "packages/schemas/src/schemas/protocol/message-envelope.ts",
  "packages/space/src/authoring/mention-suggestions.ts",
  "packages/space/src/authoring/send-target-projection.ts",
  "packages/space/src/authoring/composer-submission.ts",
  "packages/space/src/authoring/typed-submission.ts",
  "packages/space/src/target-identity/target-catalog.ts",
  "packages/space/src/target-identity/mention-resolution.ts",
] as const;

const FORBIDDEN_PATTERNS = [
  /\bwakeToken\b/u,
  /\bwakeLabel\b/u,
  /Wake with/u,
  /bare wake/iu,
  /@<wakeToken>/u,
] as const;

describe("mention label boundary", () => {
  it("does not reintroduce legacy handle terms into active mention paths", () => {
    const failures: string[] = [];

    for (const relativePath of ACTIVE_MENTION_BOUNDARY_FILES) {
      const absolutePath = resolve(REPO_ROOT, relativePath);
      const fileText = readFileSync(absolutePath, "utf8");

      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(fileText)) {
          failures.push(`${relativePath} -> ${pattern}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
