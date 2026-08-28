import type { ModelCatalog } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";

const selectMock = vi.hoisted(() => vi.fn());
const MODEL_CATALOG = vi.hoisted(
  (): ModelCatalog => ({
    schemaVersion: 1,
    updatedAt: "2026-07-06T00:00:00.000Z",
    agentControllers: {
      codex: {
        defaultModelId: "gpt-5.5",
        models: [
          {
            id: "gpt-5.5",
            displayName: "GPT-5.5",
            unavailable: false,
            supportedReasoningLevels: ["low", "medium", "high"],
            minCliVersion: null,
          },
          {
            id: "gpt-5.4-mini",
            displayName: "GPT-5.4 Mini",
            unavailable: false,
            supportedReasoningLevels: ["low", "medium"],
            minCliVersion: null,
          },
        ],
      },
    },
  })
);

vi.mock("@clack/prompts", () => ({
  cancel: vi.fn(),
  confirm: vi.fn(),
  isCancel: (value: unknown) => value === "__cancel__",
  multiselect: vi.fn(),
  select: (...args: unknown[]) => selectMock(...args),
}));

vi.mock("../src/runtime/context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/runtime/context")>();
  return {
    ...actual,
    resolveRuntimeContext: vi.fn(async () => ({
      interactive: true,
      resolvedView: "human",
      viewMode: "human",
    })),
  };
});

vi.mock("../src/system/model-catalog-read-session", () => ({
  createModelCatalogReadSession: () => ({
    read: async () => MODEL_CATALOG,
  }),
}));

import { runProfileUpdate } from "../src/commands/profile";
import { setAuthSession } from "../src/config/auth-session";
import { resetOpenMeldProfilesSessionCacheForTests } from "../src/config/openmeld-profiles-api";
import { withCapturedStdio, withTempHome } from "./helpers/fs";
import { createTestProfileHandle } from "./helpers/openmeld-profile-fixture";

const INTERACTIVE_MODEL_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const OPENCODE_PERMISSION_PROFILE_ID =
  "agt_22222222-2222-4222-8222-222222222222";

describe("profile update interactive prompts", () => {
  afterEach(() => {
    selectMock.mockReset();
    resetOpenMeldProfilesSessionCacheForTests();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("adds model and reasoning level to the interactive update menu and applies the existing model patch path", async () => {
    await withTempHome(async () => {
      await bootstrapAuthSession();
      selectMock
        .mockResolvedValueOnce("model_selection")
        .mockResolvedValueOnce("gpt-5.4-mini")
        .mockResolvedValueOnce("medium");

      const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
        const url = String(input);
        const method = String(init?.method ?? "GET").toUpperCase();

        if (url.endsWith("/api/auth/get-session")) {
          return createJsonResponse(createSessionPayload());
        }
        if (url.endsWith("/v1/profiles/resolve")) {
          return createJsonResponse({
            ok: true,
            profile: createProfilePayload({
              openMeldProfileId: INTERACTIVE_MODEL_PROFILE_ID,
              profileName: "Interactive Model Bot",
              profileKind: "agent",
            }),
          });
        }
        if (
          url.endsWith(
            `/v1/agent-profiles/${INTERACTIVE_MODEL_PROFILE_ID}/primary-binding`
          ) &&
          method === "GET"
        ) {
          return createJsonResponse(
            createPrimaryBindingPayload({
              agentProfileId: INTERACTIVE_MODEL_PROFILE_ID,
              modelSelection: {
                modelId: "gpt-5.5",
                reasoningLevel: "low",
              },
            })
          );
        }
        if (
          url.endsWith(
            `/v1/agent-profiles/${INTERACTIVE_MODEL_PROFILE_ID}/primary-binding/model-selection`
          ) &&
          method === "PATCH"
        ) {
          return createJsonResponse({
            binding: createPrimaryBindingPayload({
              agentProfileId: INTERACTIVE_MODEL_PROFILE_ID,
              modelSelection: {
                modelId: "gpt-5.4-mini",
                reasoningLevel: "medium",
              },
            }).binding,
            grantsClaimSuccess: false,
            outcome: "reused",
            reasonCodes: ["agent_profile_binding.command_eligible"],
            routable: true,
            status: "accepted",
          });
        }
        return createJsonResponse(
          { ok: false, error: "unexpected request", method, url },
          500
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      await withCapturedStdio(async () => {
        await runProfileUpdate({
          entryChecksHandled: true,
          profile: INTERACTIVE_MODEL_PROFILE_ID,
          view: "human",
        });
      });

      expect(selectMock.mock.calls[0]?.[0]).toMatchObject({
        message: "What do you want to update?",
      });
      const updatePrompt = selectMock.mock.calls[0]?.[0] as
        | { options?: Array<{ label: string }> }
        | undefined;
      expect(updatePrompt?.options?.map((option) => option.label)).toContain(
        "Model and reasoning level"
      );

      const modelPatchCall = fetchMock.mock.calls.find(([request, init]) => {
        return (
          String(request).endsWith(
            `/v1/agent-profiles/${INTERACTIVE_MODEL_PROFILE_ID}/primary-binding/model-selection`
          ) &&
          String((init as RequestInit | undefined)?.method ?? "GET") === "PATCH"
        );
      });
      expect(modelPatchCall).toBeTruthy();
      expect(
        JSON.parse(
          String((modelPatchCall?.[1] as RequestInit | undefined)?.body ?? "{}")
        )
      ).toEqual({
        modelId: "gpt-5.4-mini",
        reasoningLevel: "medium",
      });
    });
  });

  it("keeps unsupported controller permission mode disabled through the shared resolver", async () => {
    await withTempHome(async () => {
      await bootstrapAuthSession();
      selectMock.mockResolvedValueOnce("agent_controller_permission_mode");

      const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
        const url = String(input);
        const method = String(init?.method ?? "GET").toUpperCase();

        if (url.endsWith("/api/auth/get-session")) {
          return createJsonResponse(createSessionPayload());
        }
        if (url.endsWith("/v1/profiles/resolve")) {
          return createJsonResponse({
            ok: true,
            profile: createProfilePayload({
              openMeldProfileId: OPENCODE_PERMISSION_PROFILE_ID,
              profileName: "OpenCode Bot",
              profileKind: "agent",
            }),
          });
        }
        if (
          url.endsWith(
            `/v1/agent-profiles/${OPENCODE_PERMISSION_PROFILE_ID}/primary-binding`
          ) &&
          method === "GET"
        ) {
          return createJsonResponse(
            createPrimaryBindingPayload({
              agentControllerRef: "builtin:opencode",
              agentProfileId: OPENCODE_PERMISSION_PROFILE_ID,
            })
          );
        }
        return createJsonResponse(
          { ok: false, error: "unexpected request", method, url },
          500
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        withCapturedStdio(async () => {
          await runProfileUpdate({
            entryChecksHandled: true,
            profile: OPENCODE_PERMISSION_PROFILE_ID,
            view: "human",
          });
        })
      ).rejects.toThrow(
        "Agent Controller Permission Mode is not supported by builtin:opencode."
      );
      expect(selectMock).toHaveBeenCalledTimes(1);
      expect(
        fetchMock.mock.calls.some(([request, init]) => {
          return (
            String(request).includes("agent-controller-permission-mode") &&
            String((init as RequestInit | undefined)?.method ?? "GET") ===
              "PATCH"
          );
        })
      ).toBe(false);
    });
  });
});

async function bootstrapAuthSession(): Promise<void> {
  process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
  await setAuthSession({
    accessToken: "token-1",
    tokenType: "Bearer",
    authBaseUrl: "https://auth.openmeld.ai",
    clientId: "openmeld-cli",
  });
}

function createSessionPayload() {
  return {
    session: { id: "session-1" },
    user: {
      id: "user-1",
      email: "you@company.com",
      name: "Felix",
    },
  };
}

function createProfilePayload(input: {
  openMeldProfileId: string;
  profileName?: string;
  profileKind: "human" | "agent" | "system";
}) {
  return {
    openMeldProfileId: input.openMeldProfileId,
    profileName: input.profileName ?? input.openMeldProfileId,
    profileHandle: createTestProfileHandle(
      input.profileName ?? input.openMeldProfileId,
      input.profileKind
    ),
    profileKind: input.profileKind,
    isDefault: input.profileKind === "human",
    status: "active",
    ownerUserId: "user-1",
    source: "cli_create",
    createdByUserId: "user-1",
    creatorProfileId: null,
    lastUsedAt: null,
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z",
  };
}

function createPrimaryBindingPayload(input: {
  agentControllerRef?: string;
  agentProfileId: string;
  modelSelection?: {
    modelId: string;
    reasoningLevel?: string;
  };
}) {
  return {
    binding: {
      agentProfileId: input.agentProfileId,
      authoritySource: "binding_truth",
      bindingId: `binding_${input.agentProfileId}`,
      bindingState: "enabled_primary",
      dispatchEligibility: {
        reasonCodes: ["agent_profile_binding.command_eligible"],
        routable: true,
        status: "routable",
      },
      executionTarget: {
        agentControllerRef: input.agentControllerRef ?? "builtin:codex",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime_test",
        },
      },
      grantsClaimSuccess: false,
      ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
      reasonCodes: ["agent_profile_binding.command_eligible"],
      resolutionSource: "binding_truth",
      routable: true,
    },
    grantsClaimSuccess: false,
    status: "found",
  };
}

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}
