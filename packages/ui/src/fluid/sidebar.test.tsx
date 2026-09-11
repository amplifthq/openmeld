import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./sidebar";
import { type SidebarGeometry, SidebarProvider } from "./sidebar-state";

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function Harness({
  initial = { mode: "expanded", width: 220 },
  onChange,
  static: staticPresentation = false,
  peekOnHover = true,
}: {
  initial?: SidebarGeometry;
  onChange: (next: SidebarGeometry) => void;
  static?: boolean;
  peekOnHover?: boolean;
}) {
  const [geometry, setGeometry] = useState(initial);
  return (
    <SidebarProvider
      geometry={geometry}
      onGeometryChange={(next) => {
        onChange(next);
        setGeometry(next);
      }}
      peekOnHover={peekOnHover}
      static={staticPresentation}
    >
      <Sidebar>
        <a href="#people">People</a>
        <input aria-label="Search" />
        {createPortal(
          <button type="button">Workspace menu action</button>,
          document.body
        )}
      </Sidebar>
    </SidebarProvider>
  );
}

function setup(initial?: SidebarGeometry, peekOnHover = true) {
  const changed = vi.fn();
  const result = render(
    <Harness initial={initial} onChange={changed} peekOnHover={peekOnHover} />
  );
  const rail = screen.getByRole("separator", { name: "Resize app sidebar" });
  rail.setPointerCapture = vi.fn();
  rail.releasePointerCapture = vi.fn();
  rail.hasPointerCapture = () => true;
  const panel = result.container.querySelector<HTMLElement>(
    '[data-sidebar="panel"]'
  );
  if (!panel) {
    throw new Error("Missing panel");
  }
  return { ...result, changed, rail, panel };
}

function pointer(rail: HTMLElement, kind: string, x: number) {
  fireEvent(
    rail,
    new PointerEvent(kind, {
      bubbles: true,
      pointerId: 1,
      pointerType: "mouse",
      clientX: x,
      button: 0,
    })
  );
}

describe("Fluid sidebar interaction contract", () => {
  it("commits drag collapse before removing the edge when hover preview is disabled", () => {
    const { rail, changed } = setup(undefined, false);
    pointer(rail, "pointerdown", 220);
    pointer(rail, "pointermove", 0);
    expect(rail.isConnected).toBe(true);
    pointer(rail, "pointerup", 0);
    expect(changed).toHaveBeenCalledExactlyOnceWith({
      mode: "hidden",
      width: 220,
    });
    expect(screen.queryByRole("button", { name: "Peek sidebar" })).toBeNull();
    expect(
      screen.queryByRole("separator", { name: "Resize app sidebar" })
    ).toBeNull();
  });
  it("keeps one drag captured across all three modes and saves only the final geometry", () => {
    const { rail, changed } = setup();
    pointer(rail, "pointerdown", 220);
    pointer(rail, "pointermove", 60);
    expect(rail.getAttribute("aria-valuetext")).toBe("Icons only");
    pointer(rail, "pointermove", 0);
    expect(rail.getAttribute("aria-valuetext")).toBe("Hidden");
    pointer(rail, "pointermove", 260);
    expect(rail.getAttribute("aria-valuenow")).toBe("260");
    expect(changed).not.toHaveBeenCalled();
    pointer(rail, "pointerup", 260);
    expect(changed).toHaveBeenCalledExactlyOnceWith({
      mode: "expanded",
      width: 260,
    });
  });

  it("does not toggle when capture is cancelled, and treats a click as collapse", () => {
    const { rail, changed, panel } = setup();
    pointer(rail, "pointerdown", 220);
    pointer(rail, "pointercancel", 220);
    expect(changed).not.toHaveBeenCalled();
    pointer(rail, "pointerdown", 220);
    pointer(rail, "pointerup", 221);
    expect(changed).toHaveBeenCalledExactlyOnceWith({
      mode: "hidden",
      width: 220,
    });
    expect(panel.hasAttribute("inert")).toBe(true);
  });

  it("supports keyboard snapping, bounded widths and restoration", () => {
    const { rail } = setup({ mode: "expanded", width: 160 });
    fireEvent.keyDown(rail, { key: "ArrowLeft" });
    expect(rail.getAttribute("aria-valuetext")).toBe("Icons only");
    fireEvent.keyDown(rail, { key: "ArrowLeft" });
    expect(rail.getAttribute("aria-valuetext")).toBe("Hidden");
    fireEvent.keyDown(rail, { key: "ArrowRight" });
    expect(rail.getAttribute("aria-valuetext")).toBe("Icons only");
    fireEvent.keyDown(rail, { key: "ArrowRight" });
    expect(rail.getAttribute("aria-valuenow")).toBe("160");
    fireEvent.keyDown(rail, { key: "End" });
    fireEvent.keyDown(rail, { key: "ArrowRight" });
    expect(rail.getAttribute("aria-valuenow")).toBe("384");
  });

  it("keeps peek transient and accepts owned portal interaction before outside dismissal", () => {
    const { panel, changed } = setup({ mode: "hidden", width: 240 });
    fireEvent.click(screen.getByRole("button", { name: "Peek sidebar" }));
    expect(panel.hasAttribute("inert")).toBe(false);
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Workspace menu action" })
    );
    expect(panel.hasAttribute("inert")).toBe(false);
    fireEvent.pointerDown(document.body);
    expect(panel.hasAttribute("inert")).toBe(true);
    expect(changed).not.toHaveBeenCalled();
  });

  it("ignores shortcuts in editable controls and a static mobile drawer", () => {
    const changed = vi.fn();
    const view = render(<Harness onChange={changed} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "[" });
    expect(changed).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "[" });
    expect(changed).toHaveBeenCalledExactlyOnceWith({
      mode: "hidden",
      width: 220,
    });
    view.unmount();
    changed.mockClear();
    render(<Harness onChange={changed} static />);
    fireEvent.keyDown(window, { key: "[" });
    expect(screen.queryByRole("separator")).toBeNull();
    expect(changed).not.toHaveBeenCalled();
  });

  it("does not indefinitely postpone dismissal while the pointer keeps moving outside", () => {
    vi.useFakeTimers();
    const { panel } = setup({ mode: "hidden", width: 220 });
    fireEvent.click(screen.getByRole("button", { name: "Peek sidebar" }));
    fireEvent.pointerMove(document.body, { clientX: 600, clientY: 400 });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.pointerMove(document.body, { clientX: 620, clientY: 400 });
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(panel.hasAttribute("inert")).toBe(true);
  });
});
