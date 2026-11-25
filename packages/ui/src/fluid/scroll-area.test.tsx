import { cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScrollArea } from "./scroll-area";

afterEach(cleanup);

describe("ScrollArea", () => {
  it("attaches both viewportProps.ref and viewportRef to the viewport", () => {
    const viewportPropsRef = createRef<HTMLDivElement>();
    const viewportRef = createRef<HTMLDivElement>();
    const { container } = render(
      <ScrollArea
        viewportProps={{ ref: viewportPropsRef }}
        viewportRef={viewportRef}
      >
        <div>Rows</div>
      </ScrollArea>
    );

    const viewport = container.querySelector(
      '[data-slot="scroll-area-viewport"]'
    );
    expect(viewport).toBeInstanceOf(HTMLDivElement);
    expect(viewportPropsRef.current).toBe(viewport);
    expect(viewportRef.current).toBe(viewport);
  });

  it("runs callback ref cleanups and clears object refs on unmount", () => {
    const cleanup = vi.fn();
    const callbackRef = vi.fn(() => cleanup);
    const viewportRef = createRef<HTMLDivElement>();
    const { unmount } = render(
      <ScrollArea
        viewportProps={{ ref: callbackRef }}
        viewportRef={viewportRef}
      >
        <div>Rows</div>
      </ScrollArea>
    );

    expect(callbackRef).toHaveBeenCalledWith(expect.any(HTMLDivElement));
    unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(callbackRef).not.toHaveBeenCalledWith(null);
    expect(viewportRef.current).toBeNull();
  });

  it("calls callback refs without a cleanup with null on unmount", () => {
    const callbackRef = vi.fn();
    const { unmount } = render(
      <ScrollArea viewportProps={{ ref: callbackRef }}>
        <div>Rows</div>
      </ScrollArea>
    );

    expect(callbackRef).toHaveBeenLastCalledWith(expect.any(HTMLDivElement));
    unmount();
    expect(callbackRef).toHaveBeenLastCalledWith(null);
  });
});
