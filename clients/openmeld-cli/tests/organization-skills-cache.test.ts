import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { stringifyOrganizationSkillBundleCanonicalJson } from "@openmeld/schemas";
import type { OrganizationSkillBundle } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  materializeOrganizationSkillRelease,
  serializePortableSkillMarkdown,
} from "../src/organization-skills/cache";
import { withTempHome } from "./helpers/fs";

const bundle: OrganizationSkillBundle = {
  files: [
    {
      content: "Use the exact source.\n",
      encoding: "utf8",
      mediaType: "text/markdown",
      path: "references/source.md",
      size: 22,
    },
    {
      content: "IyEvYmluL3NoCmVjaG8gaGkK",
      encoding: "base64",
      mediaType: "text/x-shellscript",
      path: "scripts/example.sh",
      size: 18,
    },
  ],
  instructions: "# Review\n\nFollow the checklist.",
  portable: {
    allowedTools: "Read, Grep",
    compatibility: "OpenMeld and portable Agent Skills runtimes",
    description: "Review one release consistently.",
    license: "MIT",
    metadata: {
      owner: "Support",
    },
    name: "release-review",
  },
};

describe("Organization Skills cache", () => {
  it("materializes an exact read-only release and reuses verified bytes", async () => {
    await withTempHome(async (home) => {
      const digest = digestBundle(bundle);
      const first = await materializeOrganizationSkillRelease({
        bundle,
        digest,
        organizationId: "org-1",
        releaseId: "release-1",
        skillId: "skill-1",
      });

      expect(first.reused).toBe(false);
      expect(first.cachePath).toBe(
        join(
          home,
          ".openmeld",
          "organization-skills",
          "org-1",
          "skill-1",
          "release-1"
        )
      );
      expect(await readFile(first.skillMarkdownPath, "utf8")).toBe(
        serializePortableSkillMarkdown(bundle)
      );
      expect(
        await readFile(join(first.cachePath, "references/source.md"), "utf8")
      ).toBe("Use the exact source.\n");
      expect(permissionBits((await stat(first.skillMarkdownPath)).mode)).toBe(
        0o444
      );
      expect(
        permissionBits(
          (await stat(join(first.cachePath, "scripts/example.sh"))).mode
        )
      ).toBe(0o444);
      expect(permissionBits((await stat(first.cachePath)).mode)).toBe(0o555);

      const second = await materializeOrganizationSkillRelease({
        bundle,
        digest,
        organizationId: "org-1",
        releaseId: "release-1",
        skillId: "skill-1",
      });
      expect(second).toEqual({
        ...first,
        reused: true,
      });
    });
  });

  it("fails closed when the downloaded bundle does not match the release digest", async () => {
    await withTempHome(async () => {
      await expect(
        materializeOrganizationSkillRelease({
          bundle,
          digest: "0".repeat(64),
          organizationId: "org-1",
          releaseId: "release-1",
          skillId: "skill-1",
        })
      ).rejects.toThrow("digest does not match");
    });
  });
});

function digestBundle(value: OrganizationSkillBundle): string {
  return createHash("sha256")
    .update(stringifyOrganizationSkillBundleCanonicalJson(value))
    .digest("hex");
}

function permissionBits(mode: number): number {
  return mode % 0o1000;
}
