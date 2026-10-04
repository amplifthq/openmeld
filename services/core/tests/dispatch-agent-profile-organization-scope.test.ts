import type { OpenMeldDaemonDispatchQueueMessage } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTargetBindingOrganizationScope } from "../src/dispatch/application/dispatch-execution-service";
import type { CoreBindings } from "../src/lib/bindings";
import { createProjectionPostgresBinding } from "../test-support/postgresql-query.test-support";

describe("dispatch Agent Profile Organization scope", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts a Binding whose Agent Profile belongs to the Space Organization without legacy Wake access", async () => {
    const env = createScopeEnv({
      profileOrganizationId: "org-acme",
      spaceOrganizationId: "org-projection-must-not-be-read",
    });
    const result = await resolveTargetBindingOrganizationScope({
      bindingId: "binding-acme",
      env,
      message: createDispatchMessage({ organizationId: "org-acme" }),
    });

    expect(result).toEqual({ ok: true, organizationId: "org-acme" });
    expect(readPreparedSql(env)).not.toContain("space_index_spaces");
  });

  it("rejects a Binding whose Agent Profile belongs to another Organization even when legacy Wake access remains", async () => {
    const result = await resolveTargetBindingOrganizationScope({
      bindingId: "binding-personal",
      env: createScopeEnv({
        profileOrganizationId: "org-personal",
        spaceOrganizationId: "org-personal",
      }),
      message: createDispatchMessage({ organizationId: "org-acme" }),
    });

    expect(result).toMatchObject({
      errorCode: "agent_profile.organization_mismatch",
      finalStatus: "failed_terminal",
      ok: false,
    });
  });

  it("uses an observable Space Index fallback only for an old producer without the canonical Organization snapshot", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const env = createScopeEnv({
      profileOrganizationId: "org-acme",
      spaceOrganizationId: "org-acme",
    });

    const result = await resolveTargetBindingOrganizationScope({
      bindingId: "binding-acme",
      env,
      message: createDispatchMessage(),
    });

    expect(result).toEqual({ ok: true, organizationId: "org-acme" });
    expect(readPreparedSql(env)).toContain("space_index_spaces");
    expect(log).toHaveBeenCalledWith(
      "[core.openMeldDaemon.dispatch_execution.legacy_space_organization_fallback]",
      {
        bindingId: "binding-acme",
        dispatchId: "dispatch-1",
        event:
          "core.openMeldDaemon.dispatch_execution.legacy_space_organization_fallback",
        queueSchemaVersion: 2,
        sourceEventId: "source-event-1",
        spaceId: "space-acme",
        targetProfileId: "agent-profile-1",
        taskId: "task-1",
      }
    );
  });

  it("logs safe dispatch correlation when the Organization lookup fails", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await resolveTargetBindingOrganizationScope({
      bindingId: "binding-acme",
      env: createFailingScopeEnv(new Error("PostgreSQL lookup failed")),
      message: createDispatchMessage(),
    });

    expect(result).toMatchObject({
      errorCode: "agent_profile.organization_lookup_failed",
      finalStatus: "failed_retryable",
      ok: false,
    });
    expect(log).toHaveBeenCalledWith(
      "[core.openMeldDaemon.dispatch_execution.agent_profile_organization_lookup_failed]",
      {
        bindingId: "binding-acme",
        dispatchId: "dispatch-1",
        error: "PostgreSQL lookup failed",
        event:
          "core.openMeldDaemon.dispatch_execution.agent_profile_organization_lookup_failed",
        sourceEventId: "source-event-1",
        spaceId: "space-acme",
        targetProfileId: "agent-profile-1",
        taskId: "task-1",
      }
    );
  });
});

function createDispatchMessage(input?: {
  organizationId?: string;
}): OpenMeldDaemonDispatchQueueMessage {
  return {
    v: 2,
    dispatchId: "dispatch-1",
    spaceId: "space-acme",
    sourceEventId: "source-event-1",
    targetProfileId: "agent-profile-1",
    taskId: "task-1",
    ...(input?.organizationId ? { organizationId: input.organizationId } : {}),
  } as OpenMeldDaemonDispatchQueueMessage;
}

const scopeQuery = new WeakMap<CoreBindings, () => string>();
function createFailingScopeEnv(error: Error): CoreBindings {
  return {
    OPENMELD_POSTGRESQL: createProjectionPostgresBinding(() => {
      throw error;
    }),
  } as CoreBindings;
}
function createScopeEnv(input: {
  profileOrganizationId: string;
  spaceOrganizationId: string;
}): CoreBindings {
  let queriedSql = "";
  const env = {
    OPENMELD_POSTGRESQL: createProjectionPostgresBinding(({ text }) => {
      queriedSql = text;
      return [
        {
          organization_id: input.spaceOrganizationId,
          profile_organization_id: input.profileOrganizationId,
        },
      ];
    }),
  } as CoreBindings;
  scopeQuery.set(env, () => queriedSql);
  return env;
}
function readPreparedSql(env: CoreBindings): string {
  return scopeQuery.get(env)?.() ?? "";
}
