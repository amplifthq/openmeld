import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const effectSpies = vi.hoisted(() => ({
  layout: vi.fn(),
  passive: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useEffect: effectSpies.passive,
    useLayoutEffect: effectSpies.layout,
  };
});

import { DitherAvatarBackground } from "#components/dither-avatar-background";

describe("DitherAvatarBackground effect timing", () => {
  it("schedules canvas drawing before the browser paints", () => {
    renderToStaticMarkup(
      <DitherAvatarBackground
        seed="openmeld-dither-profile-avatar:v1:center-agent:profile-1"
        size={24}
      />
    );

    expect(effectSpies.layout).toHaveBeenCalledOnce();
    expect(effectSpies.passive).not.toHaveBeenCalled();
  });
});
