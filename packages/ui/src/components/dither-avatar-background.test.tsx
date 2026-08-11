import { generatePalette } from "@outpacelabs/avatars";
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DitherAvatarBackground } from "#components/dither-avatar-background";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DitherAvatarBackground", () => {
  it("renders a deterministic server-safe background before canvas drawing", () => {
    const seed = "openmeld-dither-profile-avatar:v1:human:profile-1";
    const markup = renderToStaticMarkup(
      <DitherAvatarBackground seed={seed} size={24} />
    );

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('data-slot="dither-avatar-background"');
    expect(markup).toContain(
      `background-color:${generatePalette(seed).colors[0]}`
    );
    expect(markup).toContain('height="24"');
    expect(markup).toContain('width="24"');
  });

  it("draws only the backing resolution needed for a small avatar", () => {
    const fillRect = vi.fn();
    vi.stubGlobal("devicePixelRatio", 3);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillRect,
      fillStyle: "",
      globalCompositeOperation: "source-over",
    } as unknown as CanvasRenderingContext2D);

    const { container } = render(
      <DitherAvatarBackground
        className="opacity-80"
        seed="openmeld-dither-profile-avatar:v1:center-agent:profile-2"
        size={20}
      />
    );
    const canvas = container.querySelector("canvas");

    expect(canvas?.height).toBe(40);
    expect(canvas?.width).toBe(40);
    expect(canvas?.classList.contains("opacity-80")).toBe(true);
    expect(fillRect).toHaveBeenCalled();
  });
});
