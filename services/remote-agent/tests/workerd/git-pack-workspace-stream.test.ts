import { runInDurableObject } from "cloudflare:test";
import { type DurableObjectStorageLike, Workspace } from "@cloudflare/computer";
import { expect, it } from "vitest";
import { gitUploadPackBytes } from "../../flue-adapter/git-upload-pack-stream";
import { env } from "./worker-env";

it("streams Git pack bytes into the durable Computer filesystem without a container proxy", async () => {
  const namespace = (env as { COMPUTER_PROBE: DurableObjectNamespace })
    .COMPUTER_PROBE;
  const stub = namespace.get(namespace.newUniqueId());
  const result = await runInDurableObject(stub, async (_instance, state) => {
    const workspace = new Workspace({
      backends: [],
      sessionId: "pack-stream-probe",
      storage: state.storage as unknown as DurableObjectStorageLike,
    });
    const packet = (body: Uint8Array) => {
      const prefix = new TextEncoder().encode(
        (body.byteLength + 4).toString(16).padStart(4, "0")
      );
      return new Uint8Array([...prefix, ...body]);
    };
    const pack = new Uint8Array(1024 * 1024);
    pack.set(new TextEncoder().encode("PACK"));
    let count = 0;
    const response = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < pack.length; offset += 60_000) {
          controller.enqueue(
            packet(
              new Uint8Array([1, ...pack.subarray(offset, offset + 60_000)])
            )
          );
        }
        controller.close();
      },
    });
    await workspace.fs.mkdir("/computer/transfer", { recursive: true });
    await workspace.fs.writeFile(
      "/computer/transfer/pack.pack",
      gitUploadPackBytes(response, (bytes) => {
        count = bytes;
      })
    );
    const stream = await workspace.fs.readFile("/computer/transfer/pack.pack");
    const written = await new Response(stream).arrayBuffer();
    return {
      count,
      written: written.byteLength,
      header: new TextDecoder().decode(written.slice(0, 4)),
    };
  });
  expect(result).toEqual({
    count: 1024 * 1024,
    written: 1024 * 1024,
    header: "PACK",
  });
});
