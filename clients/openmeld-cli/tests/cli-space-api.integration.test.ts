import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { setAuthSession } from "../src/config/auth-session";
import { createCliSpaceApi } from "../src/space/cli-space-api";
import { withTempHome } from "./helpers/fs";

const REQUEST_CONTEXT = {
  actorContext: {
    requestId: "req-cli-space-api-123",
    openMeldProfileId: "human_profile_1",
    profileKind: "human" as const,
    profileName: "Mira",
  },
};

describe("cli-space-api", () => {
  it("composes the shared space api with CLI auth and request-context providers", async () => {
    await withTempHome(async () => {
      const previousForceInsecureToken =
        process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN;
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";

      try {
        await setAuthSession({
          accessToken: "stored-token",
          tokenType: "Bearer",
          authBaseUrl: "http://localhost:8788",
          clientId: "openmeld-cli-dev",
        });

        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
          new Response(
            JSON.stringify({
              spaceId:
                "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
              generatedAt: "2026-04-03T00:00:00.000Z",
              name: "phase-5-room",
              accessMode: "public",
              passwordProtected: false,
              dispatchPolicy: { mode: "mention_only" },
              publicationMode: "collaboration",
              allowedActions: ["post_message", "post_status", "stay_silent"],
              resultArchivePolicy: { mode: "all_final_results" },
              entryBrief: "default",
              dispatchBrief: "default",
              members: {
                totalCount: 2,
                humanCount: 1,
                agentCount: 1,
                liveNowCount: 1,
                liveHumanCount: 1,
                liveAgentCount: 0,
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
        );

        const result = await createCliSpaceApi(
          "http://localhost:8080"
        ).getStatus({
          spaceId:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          requestContext: REQUEST_CONTEXT,
          spacePassword: "pw-123",
        });

        expect(result.name).toBe("phase-5-room");
        expect(fetchSpy).toHaveBeenCalledOnce();
        expect(fetchSpy.mock.calls[0]?.[0]).toBe(
          "http://localhost:8080/v1/spaces/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/status"
        );
        expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
          headers: {
            Authorization: "Bearer stored-token",
            "x-openmeld-request-id": "req-cli-space-api-123",
            "x-openmeld-profile-id": "human_profile_1",
            "x-openmeld-profile-kind": "human",
            "x-openmeld-profile-name": "Mira",
            "x-openmeld-space-password": "pw-123",
          },
        });
      } finally {
        if (previousForceInsecureToken === undefined) {
          Reflect.deleteProperty(
            process.env,
            "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
          );
        } else {
          process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN =
            previousForceInsecureToken;
        }
      }
    });
  });

  it("keeps createCliSpaceApi as the only CLI shared-client composition point", () => {
    const spaceDir = new URL("../src/space", import.meta.url);
    const spaceDirPath = fileURLToPath(spaceDir);
    const deletedWrapperPaths = [
      new URL("../src/space/status-api.ts", import.meta.url),
      new URL("../src/space/members-api.ts", import.meta.url),
      new URL("../src/space/signal-history-api.ts", import.meta.url),
      new URL("../src/space/post-normal-message.ts", import.meta.url),
    ];

    for (const wrapperPath of deletedWrapperPaths) {
      expect(existsSync(wrapperPath)).toBe(false);
    }

    const createSpaceApiMatches: string[] = [];
    for (const filePath of collectTypeScriptFiles(spaceDirPath)) {
      const source = readFileSync(filePath, "utf8");
      if (source.includes("createSpaceApi(")) {
        createSpaceApiMatches.push(filePath.slice(spaceDirPath.length + 1));
      }
    }

    expect(createSpaceApiMatches).toEqual(["cli-space-api.ts"]);
  });
});

function collectTypeScriptFiles(directoryPath: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const absolutePath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(absolutePath));
      continue;
    }
    if (!(entry.isFile() && entry.name.endsWith(".ts"))) {
      continue;
    }
    files.push(absolutePath);
  }
  return files;
}
