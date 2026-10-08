import { expect, it, vi } from "vitest";
import { createPilotAccountStreams } from "../src/main/pilot-account-stream";

const id = "10000000-0000-4000-8000-000000000001";

it.each([
  "close",
  "closeAll",
] as const)("%s cancels account streams waiting for compatibility admission", async (method) => {
  const admitted = Promise.withResolvers<void>();
  const cookie = vi.fn(() => {
    throw new Error("Canceled streams must not read credentials");
  });
  const streams = createPilotAccountStreams({
    installed: true,
    webOrigin: "http://127.0.0.1:1",
    webBuild: "a".repeat(64),
    ensureCompatible: () => admitted.promise,
    cookie,
  });
  const emit = vi.fn();
  const opening = streams.open({ id, organizationId: "organization-a" }, emit);
  streams[method](id);
  admitted.resolve();
  await expect(opening).resolves.toBeUndefined();
  expect(cookie).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
  expect(() => streams.ping(id)).toThrow("not open");
});

it("reserves pending IDs and releases them after admission fails", async () => {
  const admitted = Promise.withResolvers<void>();
  const streams = createPilotAccountStreams({
    installed: true,
    webOrigin: "http://127.0.0.1:1",
    webBuild: "a".repeat(64),
    ensureCompatible: () => admitted.promise,
    cookie: () => "",
  });
  const request = { id, organizationId: "organization-a" };
  const opening = streams.open(request, () => undefined);
  await expect(streams.open(request, () => undefined)).rejects.toThrow(
    "already open"
  );
  const rejected = expect(opening).rejects.toThrow("Admission failed");
  admitted.reject(new Error("Admission failed"));
  await rejected;
  await expect(streams.open(request, () => undefined)).rejects.toThrow(
    "Admission failed"
  );
});
