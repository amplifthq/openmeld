import { describe, expect, it, vi } from "vitest";
import app from "../src/index";

const TEST_EXECUTION_CONTEXT = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
  exports: {},
} as unknown as ExecutionContext;

function makeEnv(input?: {
  coreOverrides?: Record<string, unknown>;
  authOverrides?: Record<string, unknown>;
}): {
  env: CloudflareBindings;
  coreRpc: {
    addSpaceMembers: ReturnType<typeof vi.fn>;
    removeSpaceMembers: ReturnType<typeof vi.fn>;
    postSignal: ReturnType<typeof vi.fn>;
    updateSpaceMeta: ReturnType<typeof vi.fn>;
    upsertSpacePassword: ReturnType<typeof vi.fn>;
    putSpaceContract: ReturnType<typeof vi.fn>;
    updateSpaceCursor: ReturnType<typeof vi.fn>;
    getSpaceMeta: ReturnType<typeof vi.fn>;
  };
  authRpc: {
    resolveRequestAuth: ReturnType<typeof vi.fn>;
    resolveProfile: ReturnType<typeof vi.fn>;
    upsertProfileSpaceHistory: ReturnType<typeof vi.fn>;
    querySpaceDeletionTombstones: ReturnType<typeof vi.fn>;
  };
} {
  const coreRpc = {
    addSpaceMembers: vi.fn(async () => ({ addedMembers: [] })),
    removeSpaceMembers: vi.fn(async () => ({ removedMemberIds: [] })),
    postSignal: vi.fn(async () => ({ ok: true })),
    updateSpaceMeta: vi.fn(async () => ({ updated: true })),
    upsertSpacePassword: vi.fn(async () => ({
      spaceId: "demo",
      passwordProtected: true,
    })),
    putSpaceContract: vi.fn(async () => ({ updated: true })),
    updateSpaceCursor: vi.fn(async () => ({ updated: true })),
    getSpaceMeta: vi.fn(async () => ({ spaceId: "demo" })),
  };

  const authRpc = {
    resolveRequestAuth: vi.fn(async () => ({
      ok: true,
      claims: {
        authenticated: true,
        requestId: "req-test",
        profileId: "11111111-1111-4111-8111-111111111111",
        profileKind: "human",
        ownerIds: ["owner-001"],
        authMethod: "session",
      },
    })),
    resolveProfile: vi.fn(async () => ({
      ok: true,
      resolvedProfile: {
        openMeldProfileId: "11111111-1111-4111-8111-111111111111",
        profileName: "Mira",
        profileKind: "human",
        ownerUserId: "owner-001",
      },
    })),
    upsertProfileSpaceHistory: vi.fn(async () => ({
      ok: true,
      item: { status: "active" },
      spaceIndexOverlay: {
        repairAttempted: false,
        status: "applied",
        updated: true,
      },
    })),
    querySpaceDeletionTombstones: vi.fn(async () => ({
      ok: true,
      items: [],
    })),
  };

  Object.assign(coreRpc, input?.coreOverrides);
  Object.assign(authRpc, input?.authOverrides);

  return {
    env: {
      OPENMELD_AUTH_WORKER: authRpc,
      OPENMELD_CORE_WORKER: coreRpc,
    } as unknown as CloudflareBindings,
    coreRpc,
    authRpc,
  };
}

async function readJsonErrorResponse(response: Response): Promise<{
  status: number;
  payload: {
    ok?: boolean;
    error?: { code?: string; message?: string };
  };
}> {
  return {
    status: response.status,
    payload: (await response.json()) as {
      ok?: boolean;
      error?: { code?: string; message?: string };
    },
  };
}

describe("gateway JSON body guardrails", () => {
  it("returns invalid_json for malformed PATCH /v1/spaces/:spaceId/meta bodies", async () => {
    const { env, coreRpc } = makeEnv();
    const response = await app.fetch(
      new Request("http://local/v1/spaces/demo/meta", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: "{",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    const result = await readJsonErrorResponse(response);
    expect(result.status).toBe(400);
    expect(result.payload.ok).toBe(false);
    expect(result.payload.error?.code).toBe("invalid_json");
    expect(result.payload.error?.message).toBe("Invalid JSON");
    expect(coreRpc.updateSpaceMeta).not.toHaveBeenCalled();
  });

  it("returns invalid_json for malformed POST /v1/spaces/:spaceId/signals bodies", async () => {
    const { env, coreRpc } = makeEnv({
      coreOverrides: {
        postSignal: vi.fn(async () => ({ ok: true })),
      },
    });
    const response = await app.fetch(
      new Request("http://local/v1/spaces/demo/signals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "{",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    const result = await readJsonErrorResponse(response);
    expect(result.status).toBe(400);
    expect(result.payload.ok).toBe(false);
    expect(result.payload.error?.code).toBe("invalid_json");
    expect(result.payload.error?.message).toBe("Invalid JSON");
    expect(coreRpc.postSignal).not.toHaveBeenCalled();
  });

  it("returns invalid_json for malformed POST /v1/spaces/:spaceId/members bodies", async () => {
    const { env, coreRpc } = makeEnv();
    const response = await app.fetch(
      new Request("http://local/v1/spaces/demo/members", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "{",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    const result = await readJsonErrorResponse(response);
    expect(result.status).toBe(400);
    expect(result.payload.ok).toBe(false);
    expect(result.payload.error?.code).toBe("invalid_json");
    expect(result.payload.error?.message).toBe("Invalid JSON");
    expect(coreRpc.addSpaceMembers).not.toHaveBeenCalled();
  });

  it("returns invalid_json for malformed POST /v1/spaces/:spaceId/members/remove bodies", async () => {
    const { env, coreRpc } = makeEnv();
    const response = await app.fetch(
      new Request("http://local/v1/spaces/demo/members/remove", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "{",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    const result = await readJsonErrorResponse(response);
    expect(result.status).toBe(400);
    expect(result.payload.ok).toBe(false);
    expect(result.payload.error?.code).toBe("invalid_json");
    expect(result.payload.error?.message).toBe("Invalid JSON");
    expect(coreRpc.removeSpaceMembers).not.toHaveBeenCalled();
  });

  it("returns invalid_json for malformed PUT /v1/spaces/:spaceId/password bodies", async () => {
    const { env, coreRpc } = makeEnv();
    const response = await app.fetch(
      new Request("http://local/v1/spaces/demo/password", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: "{",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    const result = await readJsonErrorResponse(response);
    expect(result.status).toBe(400);
    expect(result.payload.ok).toBe(false);
    expect(result.payload.error?.code).toBe("invalid_json");
    expect(result.payload.error?.message).toBe("Invalid JSON");
    expect(coreRpc.upsertSpacePassword).not.toHaveBeenCalled();
  });

  it("returns invalid_json for malformed PUT /v1/spaces/:spaceId/contract bodies", async () => {
    const { env, coreRpc } = makeEnv();
    const response = await app.fetch(
      new Request("http://local/v1/spaces/demo/contract", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: "{",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    const result = await readJsonErrorResponse(response);
    expect(result.status).toBe(400);
    expect(result.payload.ok).toBe(false);
    expect(result.payload.error?.code).toBe("invalid_json");
    expect(result.payload.error?.message).toBe("Invalid JSON");
    expect(coreRpc.putSpaceContract).not.toHaveBeenCalled();
  });

  it("returns invalid_json for malformed PATCH /v1/spaces/:spaceId/cursors/:profileId bodies", async () => {
    const { env, coreRpc } = makeEnv();
    const response = await app.fetch(
      new Request(
        "http://local/v1/spaces/demo/cursors/11111111-1111-4111-8111-111111111111",
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: "{",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    const result = await readJsonErrorResponse(response);
    expect(result.status).toBe(400);
    expect(result.payload.ok).toBe(false);
    expect(result.payload.error?.code).toBe("invalid_json");
    expect(result.payload.error?.message).toBe("Invalid JSON");
    expect(coreRpc.updateSpaceCursor).not.toHaveBeenCalled();
  });

  it("returns invalid_json for malformed PATCH /v1/profiles/:profileId/spaces/:spaceId bodies", async () => {
    const { env, authRpc } = makeEnv();
    const response = await app.fetch(
      new Request(
        "http://local/v1/profiles/11111111-1111-4111-8111-111111111111/spaces/demo",
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: "{",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    const result = await readJsonErrorResponse(response);
    expect(result.status).toBe(400);
    expect(result.payload.ok).toBe(false);
    expect(result.payload.error?.code).toBe("invalid_json");
    expect(result.payload.error?.message).toBe("Invalid JSON");
    expect(authRpc.upsertProfileSpaceHistory).not.toHaveBeenCalled();
  });

  it("returns invalid_json for malformed POST /v1/spaces/deletion-tombstones/query bodies", async () => {
    const { env, authRpc } = makeEnv();
    const response = await app.fetch(
      new Request("http://local/v1/spaces/deletion-tombstones/query", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "{",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    const result = await readJsonErrorResponse(response);
    expect(result.status).toBe(400);
    expect(result.payload.ok).toBe(false);
    expect(result.payload.error?.code).toBe("invalid_json");
    expect(result.payload.error?.message).toBe("Invalid JSON");
    expect(authRpc.querySpaceDeletionTombstones).not.toHaveBeenCalled();
  });

  it("returns upstream_unreachable with the thrown resolveRequestAuth message", async () => {
    const { env } = makeEnv({
      authOverrides: {
        resolveRequestAuth: vi.fn(() => {
          throw new Error("auth transport crashed");
        }),
      },
    });

    const response = await app.fetch(
      new Request("http://local/v1/spaces/demo/meta", {
        method: "GET",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(502);
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: { code?: string; message?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("upstream_unreachable");
    expect(payload.error?.message).toBe("auth transport crashed");
  });

  it("returns upstream_unreachable with the thrown resolveProfile message", async () => {
    const { env } = makeEnv({
      authOverrides: {
        resolveProfile: vi.fn(() => {
          throw new Error("profile lookup crashed");
        }),
      },
    });

    const response = await app.fetch(
      new Request("http://local/v1/spaces/demo/meta", {
        method: "GET",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(502);
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: { code?: string; message?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("upstream_unreachable");
    expect(payload.error?.message).toBe("profile lookup crashed");
  });
});
