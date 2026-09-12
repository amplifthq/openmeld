import { describe, expect, it } from "vitest";
import { resolveGatewayStructuredRpcErrorResponse } from "../src/routes/rpc-http.helpers";

describe("plugin errors across Worker RPC", () => {
  it.each([
    [403, "plugin.caller_forbidden"],
    [403, "plugin.connection_unavailable"],
    [409, "plugin.access_changed"],
    [503, "plugin.runtime_unavailable"],
  ] as const)("preserves %s %s for CLI and Web callers", (status, code) => {
    // Worker RPC retains the standard Error message, not custom properties.
    const message = "Review this account in Plugins.";
    const err = new Error(
      `HTTP ${status}: ${JSON.stringify({ ok: false, error: { code, message } })}`
    );
    expect(
      resolveGatewayStructuredRpcErrorResponse({
        err,
        requestId: "plugin-smoke",
      })
    ).toEqual({ status, code, message, requestId: "plugin-smoke" });
  });
});
