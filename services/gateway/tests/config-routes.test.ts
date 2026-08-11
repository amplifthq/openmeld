import { describe, expect, it, vi } from "vitest";
import app from "../src/index";

type CoreRpcMock = {
  getModelCatalog: ReturnType<typeof vi.fn>;
};

type AuthRpcMock = {
  resolveProfile: ReturnType<typeof vi.fn>;
  resolveRequestAuth: ReturnType<typeof vi.fn>;
};

const TEST_EXECUTION_CONTEXT = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
  exports: {},
} as unknown as ExecutionContext;

const VALID_MODEL_CATALOG = {
  schemaVersion: 1,
  updatedAt: "2026-06-18T00:00:00.000Z",
  agentControllers: {
    codex: {
      defaultModelId: "gpt-5.5",
      models: [
        {
          id: "gpt-5.5",
          displayName: "GPT-5.5",
          unavailable: false,
          supportedReasoningLevels: ["low", "medium", "high", "xhigh"],
          minCliVersion: null,
        },
      ],
    },
  },
};

function makeEnv(input?: {
  authOverrides?: Partial<AuthRpcMock>;
  coreOverrides?: Partial<CoreRpcMock>;
}) {
  const coreRpc: CoreRpcMock = {
    getModelCatalog: vi.fn(async () => VALID_MODEL_CATALOG),
    ...(input?.coreOverrides ?? {}),
  };

  const authRpc: AuthRpcMock = {
    resolveRequestAuth: vi.fn(async () => ({
      ok: false,
      code: "auth.unauthenticated",
      message: "authentication required",
    })),
    resolveProfile: vi.fn(),
    ...(input?.authOverrides ?? {}),
  };

  return {
    authRpc,
    coreRpc,
    env: {
      OPENMELD_AUTH_WORKER: authRpc,
      OPENMELD_CORE_WORKER: coreRpc,
    } as unknown as CloudflareBindings,
  };
}

describe("config routes", () => {
  it("serves the model catalog without requiring auth or service liveness", async () => {
    const { authRpc, coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request("http://local/v1/config/model-catalog"),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(VALID_MODEL_CATALOG);
    expect(coreRpc.getModelCatalog).toHaveBeenCalledOnce();
    expect(authRpc.resolveRequestAuth).not.toHaveBeenCalled();
    expect(authRpc.resolveProfile).not.toHaveBeenCalled();
  });
});
