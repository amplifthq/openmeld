import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const startupTracking = vi.hoisted(() => ({
  currentModule: undefined as string | undefined,
  constructions: [] as string[],
}));

vi.mock("zod/v4", async (importOriginal) => {
  const actual = await importOriginal<typeof import("zod/v4")>();
  const trackFactory =
    (name: string, factory: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) => {
      const stack = new Error(`Unexpected eager ${name} construction`).stack;
      const callSite = stack
        ?.split("\n")
        .find(
          (line) =>
            line.includes("/src/schemas/") && !line.includes("lazy-zod.ts")
        );
      if (
        stack?.includes("lazy-zod.ts") ||
        callSite?.includes("/schemas/daemon/service-connection-evidence.ts:") ||
        stack?.includes("/schemas/http/message-channels.ts") ||
        stack?.includes("/schemas/runtime/message-channel.ts")
      ) {
        startupTracking.constructions.push(
          [name, startupTracking.currentModule, callSite?.trim()]
            .filter(Boolean)
            .join(" ")
        );
      }
      return Reflect.apply(factory, actual, args);
    };
  const track = (name: string, factory: unknown) =>
    trackFactory(name, factory as (...args: unknown[]) => unknown);

  return {
    ...actual,
    array: track("array", actual.array),
    boolean: track("boolean", actual.boolean),
    coerce: {
      ...actual.coerce,
      bigint: track("coerce.bigint", actual.coerce.bigint),
      boolean: track("coerce.boolean", actual.coerce.boolean),
      date: track("coerce.date", actual.coerce.date),
      number: track("coerce.number", actual.coerce.number),
      string: track("coerce.string", actual.coerce.string),
    },
    discriminatedUnion: track("discriminatedUnion", actual.discriminatedUnion),
    email: track("email", actual.email),
    enum: track("enum", actual.enum),
    int: track("int", actual.int),
    iso: {
      ...actual.iso,
      date: track("iso.date", actual.iso.date),
      datetime: track("iso.datetime", actual.iso.datetime),
      duration: track("iso.duration", actual.iso.duration),
      time: track("iso.time", actual.iso.time),
    },
    literal: track("literal", actual.literal),
    never: track("never", actual.never),
    null: track("null", actual.null),
    number: track("number", actual.number),
    object: track("object", actual.object),
    preprocess: track("preprocess", actual.preprocess),
    record: track("record", actual.record),
    strictObject: track("strictObject", actual.strictObject),
    string: track("string", actual.string),
    tuple: track("tuple", actual.tuple),
    undefined: track("undefined", actual.undefined),
    union: track("union", actual.union),
    unknown: track("unknown", actual.unknown),
    url: track("url", actual.url),
  };
});

const schemasDirectory = new URL("../src/schemas/", import.meta.url);
const lazyZodImportPattern =
  /import \* as z from "(?:#lazy-zod|\.\.\/(?:\.\.\/)?lazy-zod)";/u;

function listSchemaModules(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryUrl = new URL(
      entry.isDirectory() ? `${entry.name}/` : entry.name,
      directory
    );
    if (entry.isDirectory()) {
      return listSchemaModules(entryUrl);
    }
    return entry.name.endsWith(".ts") ? [entryUrl] : [];
  });
}

describe("lazy Zod startup boundary", () => {
  it("imports every lazy schema module without constructing its Zod schemas", async () => {
    const v8Error = Error as typeof Error & { stackTraceLimit: number };
    const previousStackTraceLimit = v8Error.stackTraceLimit;
    v8Error.stackTraceLimit = 30;
    startupTracking.constructions.length = 0;

    const lazySchemaModules = listSchemaModules(schemasDirectory).filter(
      (moduleUrl) =>
        lazyZodImportPattern.test(readFileSync(moduleUrl, "utf8")) ||
        moduleUrl.pathname.endsWith(
          "/schemas/daemon/service-connection-evidence.ts"
        ) ||
        moduleUrl.pathname.endsWith("/schemas/http/message-channels.ts") ||
        moduleUrl.pathname.endsWith("/schemas/runtime/message-channel.ts")
    );
    const localComponentsSchemaModule = new URL(
      "../src/schemas/local-components.ts",
      import.meta.url
    );

    try {
      expect(lazySchemaModules.length).toBeGreaterThan(0);
      expect(lazySchemaModules).toContainEqual(localComponentsSchemaModule);

      for (const moduleUrl of lazySchemaModules) {
        startupTracking.currentModule = moduleUrl.pathname;
        await import(/* @vite-ignore */ moduleUrl.href);
      }

      expect(startupTracking.constructions).toEqual([]);
    } finally {
      startupTracking.currentModule = undefined;
      v8Error.stackTraceLimit = previousStackTraceLimit;
    }
  });
});
