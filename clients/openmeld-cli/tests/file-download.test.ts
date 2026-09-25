import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveFileDownload } from "../src/files/download";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "openmeld-files-download-"));
  directories.push(directory);
  return { directory, destination: join(directory, "file.bin") };
}

function stream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

describe("Files download", () => {
  it("does not replace an existing file without force", async () => {
    const { directory, destination } = await fixture();
    await writeFile(destination, "original");
    await expect(
      saveFileDownload({
        bytes: stream(new TextEncoder().encode("replacement")),
        destination,
        force: false,
        sizeBytes: 11,
      })
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(destination, "utf8")).toBe("original");
    expect(await readdir(directory)).toEqual(["file.bin"]);
  });

  it("keeps the previous file when the remote stream is incomplete", async () => {
    const { directory, destination } = await fixture();
    await writeFile(destination, "original");
    await expect(
      saveFileDownload({
        bytes: stream(new TextEncoder().encode("short")),
        destination,
        force: true,
        sizeBytes: 10,
      })
    ).rejects.toThrow("incomplete");
    expect(await readFile(destination, "utf8")).toBe("original");
    expect(await readdir(directory)).toEqual(["file.bin"]);
  });

  it("publishes complete bytes with force", async () => {
    const { destination } = await fixture();
    await writeFile(destination, "original");
    expect(
      await saveFileDownload({
        bytes: stream(new TextEncoder().encode("replacement")),
        destination,
        force: true,
        sizeBytes: 11,
      })
    ).toBe(11);
    expect(await readFile(destination, "utf8")).toBe("replacement");
  });
});
