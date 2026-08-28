import { describe, expect, it } from "vitest";
import * as actualZod from "zod/v4";
import * as z from "../src/lazy-zod";

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

    const identified = z.string().meta({
      description: "identified",
      id: "openmeld-lazy-zod-identity-test",
    });
    expect(identified.parse("OpenMeld")).toBe("OpenMeld");
    expect(actualZod.globalRegistry.get(identified)).toMatchObject({
      description: "identified",
      id: "openmeld-lazy-zod-identity-test",
    });
    expect(identified.toJSONSchema()).toMatchObject({
      description: "identified",
      id: "openmeld-lazy-zod-identity-test",
    });

    const removedBeforeResolution = z.string().meta({
      description: "removed",
      id: "openmeld-lazy-zod-removed-identity-test",
    });
    actualZod.globalRegistry.remove(removedBeforeResolution);
    expect(removedBeforeResolution.parse("OpenMeld")).toBe("OpenMeld");
    expect(
      actualZod.toJSONSchema(actualZod.globalRegistry).schemas
    ).not.toHaveProperty("openmeld-lazy-zod-removed-identity-test");
    actualZod.globalRegistry.clear();

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

  it("preserves unknown-property and object-integrity behavior", () => {
    const actualSchema = actualZod.string().min(1);
    const lazySchema = z.string().min(1);

    expect(JSON.stringify(lazySchema)).toBe(JSON.stringify(actualSchema));

    Object.preventExtensions(actualSchema);
    Object.preventExtensions(lazySchema);

    expect(Object.isExtensible(lazySchema)).toBe(false);
    expect(Reflect.ownKeys(lazySchema)).toEqual(Reflect.ownKeys(actualSchema));
    expect(Object.getPrototypeOf(lazySchema)).toBe(
      Object.getPrototypeOf(actualSchema)
    );
    expect(lazySchema.parse("OpenMeld")).toBe("OpenMeld");

    const actualFrozenSchema = actualZod.number().int();
    const lazyFrozenSchema = z.number().int();
    Object.freeze(actualFrozenSchema);
    Object.freeze(lazyFrozenSchema);

    expect(Object.isFrozen(lazyFrozenSchema)).toBe(true);
    expect(Reflect.ownKeys(lazyFrozenSchema)).toEqual(
      Reflect.ownKeys(actualFrozenSchema)
    );
    expect(lazyFrozenSchema.parse(1)).toBe(1);
  });

  it("does not replay registry metadata after removal or clearing", () => {
    const registry = actualZod.registry<{ owner: string }>();
    const removedSchema = z.string().register(registry, {
      owner: "OpenMeld",
    });

    registry.remove(removedSchema);
    removedSchema.parse("OpenMeld");
    expect(registry.has(removedSchema)).toBe(false);

    const clearedSchema = z.string().register(registry, {
      owner: "OpenMeld",
    });
    registry.clear();
    clearedSchema.parse("OpenMeld");
    expect(registry.has(clearedSchema)).toBe(false);
  });

  it("matches Zod's handling of mutable factory inputs", () => {
    const values = ["ready", "blocked"];
    const actualSchema = actualZod.enum(values);
    const lazySchema = z.enum(values);

    values[0] = "changed";

    expect(lazySchema.safeParse("ready").success).toBe(
      actualSchema.safeParse("ready").success
    );
    expect(lazySchema.safeParse("changed").success).toBe(
      actualSchema.safeParse("changed").success
    );

    const actualShape: Record<string, actualZod.ZodType> = {
      id: actualZod.string(),
    };
    const lazyShape: Record<string, actualZod.ZodType> = { id: z.string() };
    const actualObjectSchema = actualZod.strictObject(actualShape);
    const lazyObjectSchema = z.strictObject(lazyShape);

    actualShape.name = actualZod.string();
    lazyShape.name = z.string();

    expect(lazyObjectSchema.parse({ id: "1", name: "OpenMeld" })).toEqual(
      actualObjectSchema.parse({ id: "1", name: "OpenMeld" })
    );
  });
});
