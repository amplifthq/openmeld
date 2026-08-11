import { describe, expect, it } from "vitest";
import { errorResponseSchema } from "../../src/index";

describe("common error response schema", () => {
  it("accepts minimal error response", () => {
    const result = errorResponseSchema.safeParse({
      ok: false,
      error: {
        code: "validation_error",
        message: "Invalid input",
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data).toEqual({
      ok: false,
      error: {
        code: "validation_error",
        message: "Invalid input",
      },
    });
  });

  it("accepts requestId and details", () => {
    const result = errorResponseSchema.safeParse({
      ok: false,
      requestId: "req_123",
      error: {
        code: "upstream_error",
        message: "Gateway request failed",
        requestId: "req_123",
        details: {
          status: 500,
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts gateway-style nested requestId without top-level requestId", () => {
    const result = errorResponseSchema.safeParse({
      ok: false,
      error: {
        code: "upstream_error",
        message: "Internal server error",
        requestId: "req_nested_1",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects empty error code/message", () => {
    const result = errorResponseSchema.safeParse({
      ok: false,
      error: {
        code: "",
        message: "",
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects ok=true", () => {
    const result = errorResponseSchema.safeParse({
      ok: true,
      error: {
        code: "invalid",
        message: "invalid",
      },
    });

    expect(result.success).toBe(false);
  });
});
