import { centerAgentAvatarSelectionSchema } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import { normalizeCenterAgentAvatarImage } from "../src/lib/center-agent-avatar-image";

describe("Center Agent custom avatar input", () => {
  it("rejects URLs, SVG, and oversized payloads before image processing", () => {
    for (const dataUrl of [
      "https://example.com/image.png",
      "data:image/svg+xml;base64,PHN2Zz4=",
      `data:image/png;base64,${"A".repeat(400_000)}`,
    ]) {
      expect(
        centerAgentAvatarSelectionSchema.safeParse({ kind: "image", dataUrl })
          .success
      ).toBe(false);
    }
  });
  it("rejects mismatched bytes before calling the image service", async () => {
    const info = vi.fn();
    await expect(
      normalizeCenterAgentAvatarImage(
        { kind: "image", dataUrl: "data:image/png;base64,YmFk" },
        { info } as unknown as ImagesBinding
      )
    ).rejects.toThrow("valid PNG or WebP");
    expect(info).not.toHaveBeenCalled();
  });
  it("returns only the normalized WebP bytes from the shared image pipeline", async () => {
    const bytes = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);
    const output = vi.fn().mockResolvedValue({
      contentType: () => "image/webp",
      image: () => new Blob([bytes]).stream(),
    });
    const transform = vi.fn().mockReturnValue({ output });
    const images = {
      info: vi
        .fn()
        .mockResolvedValue({ format: "image/png", width: 256, height: 256 }),
      input: vi.fn().mockReturnValue({ transform }),
    };
    const result = await normalizeCenterAgentAvatarImage(
      { kind: "image", dataUrl: "data:image/png;base64,iVBORw0KGgo=" },
      images as unknown as ImagesBinding
    );
    expect(result).toEqual({
      kind: "image",
      dataUrl: "data:image/webp;base64,UklGRgAAAABXRUJQ",
    });
    expect(output).toHaveBeenCalledWith(
      expect.objectContaining({ anim: false, format: "image/webp" })
    );
  });
  it("rejects an oversized decoded image", async () => {
    const info = vi.fn().mockResolvedValue({ width: 100_000, height: 100_000 });
    await expect(
      normalizeCenterAgentAvatarImage(
        { kind: "image", dataUrl: "data:image/webp;base64,UklGRgAAAABXRUJQ" },
        { info } as unknown as ImagesBinding
      )
    ).rejects.toThrow("valid JPG");
  });
});
