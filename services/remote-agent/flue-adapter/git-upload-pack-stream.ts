const SHA = /^[a-f0-9]{40}$/u;
const PACKET_LENGTH = /^[0-9a-f]{4}$/u;
const CONTROL_LINE = /^(NAK|ACK |shallow )/u;

/** Git protocol v1 upload-pack request for two immutable, already authorized commits. */
export function gitUploadPackRequest(commits: readonly string[]): Uint8Array {
  const wanted = [...new Set(commits)];
  if (
    wanted.length < 1 ||
    wanted.length > 2 ||
    wanted.some((sha) => !SHA.test(sha))
  ) {
    throw new Error("github.checkout.invalid_pinned_commit");
  }
  const packet = (line: string) =>
    `${(new TextEncoder().encode(line).length + 4).toString(16).padStart(4, "0")}${line}`;
  return new TextEncoder().encode(
    wanted
      .map((sha, index) =>
        packet(`want ${sha}${index === 0 ? " side-band-64k ofs-delta" : ""}\n`)
      )
      .join("") +
      packet("deepen 1\n") +
      "0000" +
      packet("done\n")
  );
}

/** Strip pkt-line/sideband framing while preserving backpressure and binary pack bytes. */
export function gitUploadPackBytes(
  source: ReadableStream<Uint8Array>,
  onBytes: (count: number) => void
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let chunk: Uint8Array = new Uint8Array(0);
  let offset = 0;
  let started = false;
  let total = 0;
  const decoder = new TextDecoder();

  async function exact(length: number): Promise<Uint8Array | null> {
    const output = new Uint8Array(length);
    let written = 0;
    while (written < length) {
      if (offset === chunk.length) {
        const next = await reader.read();
        if (next.done) {
          return written === 0 ? null : neverComplete();
        }
        chunk = next.value;
        offset = 0;
        continue;
      }
      const count = Math.min(length - written, chunk.length - offset);
      output.set(chunk.subarray(offset, offset + count), written);
      offset += count;
      written += count;
    }
    return output;
  }

  async function nextPacket(): Promise<Uint8Array | null> {
    for (;;) {
      const prefix = await exact(4);
      if (!prefix) {
        return null;
      }
      const hex = decoder.decode(prefix);
      if (!PACKET_LENGTH.test(hex)) {
        throw new Error("github.checkout.invalid_git_packet");
      }
      const length = Number.parseInt(hex, 16);
      if (length === 0) {
        continue;
      }
      if (length < 5 || length > 65_520) {
        throw new Error("github.checkout.invalid_git_packet");
      }
      return (await exact(length - 4)) ?? neverComplete();
    }
  }

  function packPayload(body: Uint8Array): Uint8Array | null {
    if (body[0] === 2) {
      return null; // Git progress, not object data.
    }
    if (body[0] === 3) {
      throw new Error("github.checkout.git_remote_rejected");
    }
    if (body[0] === 1) {
      return body.subarray(1);
    }
    if (CONTROL_LINE.test(decoder.decode(body))) {
      return null;
    }
    throw new Error("github.checkout.unexpected_git_response");
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const body = await nextPacket();
        if (!body) {
          if (!started) {
            throw new Error("github.checkout.empty_git_pack");
          }
          onBytes(total);
          controller.close();
          return;
        }
        const data = packPayload(body);
        if (!data) {
          continue;
        }
        if (!started && decoder.decode(data.subarray(0, 4)) !== "PACK") {
          throw new Error("github.checkout.invalid_git_pack");
        }
        started = true;
        total += data.byteLength;
        if (total > 512 * 1024 * 1024) {
          throw new Error("github.checkout.git_pack_too_large");
        }
        controller.enqueue(data);
        return;
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
}

function neverComplete(): never {
  throw new Error("github.checkout.incomplete_git_packet");
}
