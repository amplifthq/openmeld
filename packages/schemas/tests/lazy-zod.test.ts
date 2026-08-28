import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as actualZod from "zod/v4";
import * as z from "../src/lazy-zod";

const STARTUP_CRITICAL_SCHEMA_MODULES = [
  "daemon/control-plane.ts",
  "daemon/dispatch-queue.ts",
  "daemon/local-project-control.ts",
  "daemon/runtime-transport.ts",
  "daemon/task-result.ts",
  "http/agent-activity.ts",
  "http/agent-execution-readiness.ts",
  "http/agent-profile-binding.ts",
  "http/auth-rpc.ts",
  "http/center-agent-context-manifest.ts",
  "http/center-agent-routines.ts",
  "http/center-agent-tasks.ts",
  "http/center-agent.ts",
  "http/connector-connections.ts",
  "http/inbox.ts",
  "http/local-runtimes.ts",
  "http/organization-documents.ts",
  "http/organization-join-link.ts",
  "http/organization-skills.ts",
  "http/profiles.ts",
  "http/space-dispatch-trace.ts",
  "http/space-files.ts",
  "http/space-members.ts",
  "local-components.ts",
  "prepare/session.ts",
  "protocol/agent-interaction.ts",
  "runtime/agent-task-coordination.ts",
  "runtime/remote-agent-turn-envelope.ts",
  "runtime/remote-agent-worker.ts",
] as const;

const SCHEMAS_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/schemas"
);
const LAZY_ZOD_IMPORT_PATTERN =
  /import \* as z from "\.\.\/(?:\.\.\/)?lazy-zod";/u;
const EAGER_ZOD_RUNTIME_IMPORT_PATTERN = /import \* as z from "zod\/v4";/u;

describe("lazy Zod facade", () => {
  it("defers factories and chained builders until parsing", () => {
    let constructionCount = 0;
    const schema = z
      .lazySchema(() => {
        constructionCount += 1;
        return actualZod.string();
      })
      .trim()
      .min(1)
      .max(32);

    expect(constructionCount).toBe(0);
    expect(schema.parse(" OpenMeld ")).toBe("OpenMeld");
    expect(schema.safeParse("  ").success).toBe(false);
    expect(constructionCount).toBe(1);
  });

  it("keeps nested object construction lazy and preserves validation", () => {
    const schema = z.strictObject({
      child: z.strictObject({
        id: z.string().trim().min(1),
      }),
      status: z.enum(["ready", "blocked"]),
    });

    expect(
      schema.parse({ child: { id: " child-1 " }, status: "ready" })
    ).toEqual({
      child: { id: "child-1" },
      status: "ready",
    });
    expect(
      schema.safeParse({ child: { id: "" }, status: "ready" }).success
    ).toBe(false);
  });

  it("preserves object methods, metadata properties, and identity checks", () => {
    const registry = actualZod.registry<{ owner: string }>();
    const schema = z
      .strictObject({ id: z.string() })
      .extend({ name: z.string() })
      .describe("member");

    expect(schema.description).toBe("member");
    expect(schema.shape).toHaveProperty("name");
    expect(schema).toBeInstanceOf(actualZod.ZodObject);
    expect(schema.meta()).toMatchObject({ description: "member" });
    expect(actualZod.globalRegistry.get(schema)).toMatchObject({
      description: "member",
    });
    expect(schema.register(registry, { owner: "OpenMeld" })).toBe(schema);
    expect(registry.get(schema)).toEqual({ owner: "OpenMeld" });
    expect(schema.apply((value) => value)).toBe(schema);
    expect(schema.apply((value) => value.description)).toBe("member");
    expect(schema.toJSONSchema()).toMatchObject({
      properties: {
        id: { type: "string" },
        name: { type: "string" },
      },
      type: "object",
    });
    expect(schema.parse({ id: "1", name: "OpenMeld" })).toEqual({
      id: "1",
      name: "OpenMeld",
    });

    const registered = z.string();
    registered.register(actualZod.globalRegistry, {
      description: "registered",
    });
    expect(registered.meta()).toMatchObject({ description: "registered" });
    expect(registered.description).toBe("registered");
    expect(registered.toJSONSchema()).toMatchObject({
      description: "registered",
    });

    const tagged = z.string().meta({ description: "tagged" });
    expect(actualZod.globalRegistry.get(tagged)).toMatchObject({
      description: "tagged",
    });
    expect(tagged.description).toBe("tagged");

    const unbranded = z.string();
    expect(unbranded.brand()).toBe(unbranded);
    const finite = z.number();
    expect(finite.finite()).toBe(finite);
  });

  it("forwards public number and date constraint properties", () => {
    const numberSchema = z.number().int().min(1).max(10);
    const bigintSchema = z.coerce.bigint().min(1n).max(10n);
    const minDate = new Date("2026-01-01T00:00:00.000Z");
    const maxDate = new Date("2026-12-31T23:59:59.999Z");
    const dateSchema = z.coerce.date().min(minDate).max(maxDate);

    expect(numberSchema.minValue).toBe(1);
    expect(numberSchema.maxValue).toBe(10);
    expect(numberSchema.isInt).toBe(true);
    expect(numberSchema.isFinite).toBe(true);
    expect(bigintSchema.minValue).toBe(1n);
    expect(bigintSchema.maxValue).toBe(10n);
    expect(dateSchema.minDate).toEqual(minDate);
    expect(dateSchema.maxDate).toEqual(maxDate);
  });

  it("keeps profiled Core startup schema modules on the lazy facade", () => {
    for (const modulePath of STARTUP_CRITICAL_SCHEMA_MODULES) {
      const source = readFileSync(
        path.join(SCHEMAS_DIRECTORY, modulePath),
        "utf8"
      );

      expect(source, modulePath).toMatch(LAZY_ZOD_IMPORT_PATTERN);
      expect(source, modulePath).not.toMatch(EAGER_ZOD_RUNTIME_IMPORT_PATTERN);
    }
  });
});
