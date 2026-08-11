import { describe, expect, it, vi } from "vitest";
import {
  resolveNamedSpaceId,
  resolveNewSpaceId,
  resolveSpaceStub,
} from "../src/rpc/space-ref";
import type { Space } from "../src/space/transport/do/space";

function createNamespaceMock() {
  const uniqueId = { kind: "unique-id" } as unknown as DurableObjectId;
  const namedId = { kind: "named-id" } as unknown as DurableObjectId;
  const parsedId = { kind: "parsed-id" } as unknown as DurableObjectId;
  const stubById = { kind: "stub-id" } as unknown as DurableObjectStub<Space>;

  const namespace = {
    idFromName: vi.fn(() => namedId),
    newUniqueId: vi.fn(() => uniqueId),
    idFromString: vi.fn(() => parsedId),
    get: vi.fn(() => stubById),
    getByName: vi.fn(),
  } as unknown as DurableObjectNamespace<Space>;

  return {
    namespace,
    namedId,
    uniqueId,
    parsedId,
    stubById,
  };
}

describe("space-ref helpers", () => {
  it("always uses newUniqueId for creation (name does not affect ID)", () => {
    const noName = createNamespaceMock();
    const named = createNamespaceMock();

    const noNameResolved = resolveNewSpaceId(noName.namespace);
    const namedResolved = resolveNewSpaceId(named.namespace, "alpha-space");

    expect(noNameResolved).toBe(noName.uniqueId);
    expect(namedResolved).toBe(named.uniqueId);
    expect(noName.namespace.idFromName).not.toHaveBeenCalled();
    expect(named.namespace.idFromName).not.toHaveBeenCalled();
  });

  it("uses idFromName for explicitly named deterministic spaces", () => {
    const { namedId, namespace } = createNamespaceMock();

    const resolved = resolveNamedSpaceId(namespace, "center-agent-dm:name");

    expect(resolved).toBe(namedId);
    expect(namespace.idFromName).toHaveBeenCalledWith("center-agent-dm:name");
    expect(namespace.newUniqueId).not.toHaveBeenCalled();
  });

  it("uses idFromString + get for 64-char hex ids", () => {
    const { namespace, parsedId, stubById } = createNamespaceMock();
    const hexId = "a".repeat(64);

    const resolved = resolveSpaceStub(namespace, hexId);

    expect(resolved).toBe(stubById);
    expect(namespace.idFromString).toHaveBeenCalledWith(hexId);
    expect(namespace.get).toHaveBeenCalledWith(parsedId);
    expect(namespace.getByName).not.toHaveBeenCalled();
  });

  it("returns null for non-hex values", () => {
    const { namespace } = createNamespaceMock();

    const resolved = resolveSpaceStub(namespace, "space-name");

    expect(resolved).toBeNull();
    expect(namespace.idFromString).not.toHaveBeenCalled();
    expect(namespace.getByName).not.toHaveBeenCalled();
  });
});
