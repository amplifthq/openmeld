import { describe, expect, it, vi } from "vitest";
import { callCoreRpc } from "../agent-core/core-rpc";

describe("callCoreRpc", () => {
  it("invokes Cloudflare RPC methods directly on their service binding", async () => {
    const directMethod = vi.fn(async (input: unknown) => ({ input, ok: true }));
    Object.defineProperty(directMethod, "call", {
      value: () => {
        throw new Error(
          'The RPC receiver does not implement the method "centerAgentListRoutines".'
        );
      },
    });
    const binding = {
      centerAgentListRoutines: directMethod,
    };
    await expect(
      callCoreRpc(
        binding,
        "centerAgentListRoutines",
        { requestId: "request-1" },
        (rpcBinding, input) => rpcBinding.centerAgentListRoutines(input)
      )
    ).resolves.toEqual({
      input: { requestId: "request-1" },
      ok: true,
    });
    expect(directMethod).toHaveBeenCalledTimes(1);
  });

  it("preserves receiver errors from nested RPC calls", async () => {
    const binding = {
      centerAgentListRoutines: (_input: unknown) =>
        Promise.reject(
          new Error(
            'The RPC receiver does not implement the method "resolveActiveMember".'
          )
        ),
    };

    await expect(
      callCoreRpc(binding, "centerAgentListRoutines", {}, (rpcBinding, input) =>
        rpcBinding.centerAgentListRoutines(input)
      )
    ).rejects.toThrow(
      'The RPC receiver does not implement the method "resolveActiveMember".'
    );
  });
});
