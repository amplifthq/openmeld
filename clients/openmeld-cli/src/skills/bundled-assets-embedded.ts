// Bun-only island: binary-distribution source for the bundled skills.
//
// Each file is embedded into the single binary at compile time via Bun's
// `with { type: "file" }` import. This module is excluded from the npm/tsdown
// build (tsdown marks it external) and from tsc only through the ambient decls
// in bun-embed.d.ts; it is resolved solely by `bun build --compile`.
//
// Invariant: EMBEDDED_SKILL_FILES must list every file under skills/. A
// build-time / unit check compares this list against the on-disk tree so a new
// skill file cannot silently drop out of the binary.

import onboarding from "../../skills/openmeld-cli/playbooks/agent-onboarding.md" with {
  type: "file",
};
import spaceOps from "../../skills/openmeld-cli/playbooks/space-ops.md" with {
  type: "file",
};
import commands from "../../skills/openmeld-cli/references/commands.md" with {
  type: "file",
};
import runtimeResolution from "../../skills/openmeld-cli/references/runtime-resolution.md" with {
  type: "file",
};
import skill from "../../skills/openmeld-cli/SKILL.md" with { type: "file" };
import readme from "../../skills/README.md" with { type: "file" };
import type { BundledSkillAsset } from "./bundled-assets";
import { sortBundledSkillAssets } from "./bundled-assets-fs";

const EMBEDDED_SKILL_FILES: ReadonlyArray<{
  relativePath: string;
  handle: string;
}> = [
  { relativePath: "README.md", handle: readme },
  { relativePath: "openmeld-cli/SKILL.md", handle: skill },
  {
    relativePath: "openmeld-cli/playbooks/agent-onboarding.md",
    handle: onboarding,
  },
  { relativePath: "openmeld-cli/playbooks/space-ops.md", handle: spaceOps },
  { relativePath: "openmeld-cli/references/commands.md", handle: commands },
  {
    relativePath: "openmeld-cli/references/runtime-resolution.md",
    handle: runtimeResolution,
  },
];

export const EMBEDDED_SKILL_RELATIVE_PATHS: readonly string[] =
  EMBEDDED_SKILL_FILES.map((file) => file.relativePath);

type BunFileReader = {
  file(path: string): { arrayBuffer(): Promise<ArrayBuffer> };
};

export async function loadEmbeddedBundledSkillAssets(): Promise<
  BundledSkillAsset[]
> {
  const bun = (globalThis as unknown as { Bun: BunFileReader }).Bun;
  const assets: BundledSkillAsset[] = [];
  for (const file of EMBEDDED_SKILL_FILES) {
    const content = Buffer.from(await bun.file(file.handle).arrayBuffer());
    assets.push({ relativePath: file.relativePath, content });
  }
  return sortBundledSkillAssets(assets);
}
