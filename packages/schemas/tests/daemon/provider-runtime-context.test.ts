import { describe, expect, it } from "vitest";
import {
  MAX_PROFILE_WORKING_DIRECTORY_LENGTH,
  providerDispatchRuntimeContextSchema,
} from "../../src/index";

describe("provider dispatch runtime context schema", () => {
  it("accepts a provider runtime working directory", () => {
    const parsed = providerDispatchRuntimeContextSchema.safeParse({
      providerRuntimeWorkingDirectory: "/tmp/provider-runtime",
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects an empty provider runtime working directory", () => {
    const parsed = providerDispatchRuntimeContextSchema.safeParse({
      providerRuntimeWorkingDirectory: "   ",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects provider runtime working directory values longer than the profile working directory limit", () => {
    const parsed = providerDispatchRuntimeContextSchema.safeParse({
      providerRuntimeWorkingDirectory: `/tmp/${"x".repeat(MAX_PROFILE_WORKING_DIRECTORY_LENGTH)}`,
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects provider runtime working directory values containing NUL bytes", () => {
    const parsed = providerDispatchRuntimeContextSchema.safeParse({
      providerRuntimeWorkingDirectory: "/tmp/provider-runtime\u0000blocked",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects unknown fields", () => {
    const parsed = providerDispatchRuntimeContextSchema.safeParse({
      providerRuntimeWorkingDirectory: "/tmp/provider-runtime",
      runtimeWorkingDirectory: "/tmp/legacy",
    });

    expect(parsed.success).toBe(false);
  });
});
