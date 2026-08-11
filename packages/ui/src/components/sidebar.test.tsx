import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "./sidebar";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function getPanel(container: HTMLElement): HTMLElement {
  const panel = container.querySelector<HTMLElement>('[data-slot="sidebar"]');
  if (!panel) {
    throw new Error("sidebar panel not found");
  }
  return panel;
}

function getWrapper(container: HTMLElement): HTMLElement {
  const wrapper = container.querySelector<HTMLElement>(
    '[data-slot="sidebar-wrapper"]'
  );
  if (!wrapper) {
    throw new Error("sidebar wrapper not found");
  }
  return wrapper;
}

function getRail(container: HTMLElement): HTMLButtonElement {
  const rail = container.querySelector<HTMLButtonElement>(
    '[data-slot="sidebar-rail"]'
  );
  if (!rail) {
    throw new Error("sidebar rail not found");
  }
  return rail;
}

function renderSidebar(input: {
  children?: React.ReactNode;
  collapsed?: boolean;
  compact?: boolean;
  compactWidth?: string;
  maxWidth?: string;
  minWidth?: string;
  nested?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  onCompactChange?: (compact: boolean) => void;
  onResizingChange?: (resizing: boolean) => void;
  onWidthChange?: (width: string) => void;
  resizeStep?: number;
  separatorLabel?: string;
  side?: "left" | "right";
  width?: string;
}) {
  return render(
    <SidebarProvider
      compact={input.compact}
      compactWidth={input.compactWidth}
      maxWidth={input.maxWidth}
      minWidth={input.minWidth}
      onCompactChange={input.onCompactChange}
      onOpenChange={input.onCollapsedChange}
      onResizingChange={input.onResizingChange}
      onWidthChange={input.onWidthChange}
      open={input.collapsed === undefined ? undefined : !input.collapsed}
      side={input.side}
      width={input.width}
    >
      <Sidebar side={input.side}>
        <SidebarContent>{input.children ?? <div>body</div>}</SidebarContent>
        <SidebarRail
          nested={input.nested}
          resizeStep={input.resizeStep}
          separatorLabel={input.separatorLabel}
          side={input.side}
        />
      </Sidebar>
    </SidebarProvider>
  );
}

function ControlledAutoCollapseSidebar() {
  const [open, setOpen] = useState(true);
  const [width, setWidth] = useState("180px");

  return (
    <SidebarProvider
      maxWidth="400px"
      minWidth="100px"
      onOpenChange={setOpen}
      onWidthChange={setWidth}
      open={open}
      width={width}
    >
      <Sidebar>
        <SidebarContent>
          <div>body</div>
        </SidebarContent>
        <SidebarRail
          autoCollapse
          autoCollapseThreshold={1}
          expandThreshold={0.1}
        />
      </Sidebar>
    </SidebarProvider>
  );
}

function ControlledTriStateSidebar() {
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState(false);

  return (
    <SidebarProvider
      compact={compact}
      compactWidth="120px"
      maxWidth="400px"
      minWidth="200px"
      onCompactChange={setCompact}
      onOpenChange={setOpen}
      open={open}
      width="288px"
    >
      <Sidebar>
        <SidebarContent>
          <div>body</div>
          <SidebarTrigger>trigger</SidebarTrigger>
        </SidebarContent>
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  );
}

describe("Sidebar family", () => {
  it("applies the controlled width as a CSS length and the --sidebar-width var", () => {
    const { container } = renderSidebar({ width: "18rem" });
    const wrapper = getWrapper(container);
    const panel = getPanel(container);
    expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("18rem");
    expect(panel.style.width).toBe("var(--sidebar-width)");
  });

  it("renders the children content region", () => {
    const { getByText } = renderSidebar({
      children: <div>conversation list</div>,
      width: "16rem",
    });
    expect(getByText("conversation list")).toBeTruthy();
  });

  it("keeps the resize rail hit area outside the sidebar content clipping path", () => {
    const { container } = renderSidebar({ width: "18rem" });
    const panel = getPanel(container);
    const rail = getRail(container);

    expect(panel.className).not.toContain("overflow-hidden");
    expect(rail.className).toContain("w-4");
    expect(rail.className).toContain("after:w-px");
  });

  it("collapses to a narrow icon rail width and marks data-state", () => {
    const { container } = renderSidebar({
      collapsed: true,
      onCollapsedChange: () => undefined,
      width: "20rem",
    });
    const panel = getPanel(container);
    expect(panel.style.width).toBe("var(--sidebar-width-icon)");
    expect(panel.getAttribute("data-state")).toBe("collapsed");
  });

  it("exposes the divider as an accessible separator with aria-value*", () => {
    const { container } = renderSidebar({
      maxWidth: "24rem",
      minWidth: "14rem",
      separatorLabel: "Resize the spaces rail",
      width: "18rem",
    });
    const rail = getRail(container);
    expect(rail.getAttribute("role")).toBe("separator");
    expect(rail.getAttribute("aria-orientation")).toBe("vertical");
    expect(rail.getAttribute("aria-label")).toBe("Resize the spaces rail");
    expect(rail.getAttribute("aria-valuemin")).toBe("224");
    expect(rail.getAttribute("aria-valuenow")).toBe("288");
    expect(rail.getAttribute("aria-valuemax")).toBe("384");
  });

  it("omits aria-value* on the separator while collapsed", () => {
    const { container } = renderSidebar({
      collapsed: true,
      maxWidth: "24rem",
      minWidth: "14rem",
      onCollapsedChange: () => undefined,
      width: "18rem",
    });
    const rail = getRail(container);
    expect(rail.getAttribute("aria-valuenow")).toBeNull();
    expect(rail.getAttribute("aria-valuemin")).toBeNull();
    expect(rail.getAttribute("aria-valuemax")).toBeNull();
  });

  it("restores an in-range aria-valuenow when expanded again", () => {
    const { container } = renderSidebar({
      maxWidth: "24rem",
      minWidth: "14rem",
      width: "18rem",
    });
    const rail = getRail(container);
    const valueNow = Number(rail.getAttribute("aria-valuenow"));
    const valueMin = Number(rail.getAttribute("aria-valuemin"));
    const valueMax = Number(rail.getAttribute("aria-valuemax"));
    expect(valueNow).toBe(288);
    expect(valueNow).toBeGreaterThanOrEqual(valueMin);
    expect(valueNow).toBeLessThanOrEqual(valueMax);
  });

  it("uses the col-resize cursor on the divider and no separate grabber exists", () => {
    const { container } = renderSidebar({ width: "16rem" });
    const rail = getRail(container);
    expect(rail.className).toContain("cursor-col-resize");
    expect(
      container.querySelectorAll('[data-slot="sidebar-rail"]')
    ).toHaveLength(1);
  });

  describe("keyboard resize", () => {
    it("grows width on ArrowRight by resizeStep (left side, handle on right)", () => {
      const onWidthChange = vi.fn();
      const { container } = renderSidebar({
        maxWidth: "400px",
        minWidth: "200px",
        onWidthChange,
        resizeStep: 16,
        width: "288px",
      });
      fireEvent.keyDown(getRail(container), { key: "ArrowRight" });
      expect(onWidthChange).toHaveBeenCalledWith("304px");
    });

    it("shrinks width on ArrowLeft by resizeStep", () => {
      const onWidthChange = vi.fn();
      const { container } = renderSidebar({
        maxWidth: "400px",
        minWidth: "200px",
        onWidthChange,
        resizeStep: 16,
        width: "288px",
      });
      fireEvent.keyDown(getRail(container), { key: "ArrowLeft" });
      expect(onWidthChange).toHaveBeenCalledWith("272px");
    });

    it("inverts arrow direction for a right-side sidebar", () => {
      const onWidthChange = vi.fn();
      const { container } = renderSidebar({
        maxWidth: "400px",
        minWidth: "200px",
        onWidthChange,
        resizeStep: 16,
        side: "right",
        width: "288px",
      });
      fireEvent.keyDown(getRail(container), { key: "ArrowRight" });
      expect(onWidthChange).toHaveBeenCalledWith("272px");
    });

    it("clamps to maxWidth and never overshoots", () => {
      const onWidthChange = vi.fn();
      const { container } = renderSidebar({
        maxWidth: "300px",
        minWidth: "200px",
        onWidthChange,
        resizeStep: 16,
        width: "296px",
      });
      fireEvent.keyDown(getRail(container), { key: "ArrowRight" });
      expect(onWidthChange).toHaveBeenCalledWith("300px");
    });

    it("jumps to min/max on Home/End", () => {
      const onWidthChange = vi.fn();
      const { container } = renderSidebar({
        maxWidth: "400px",
        minWidth: "200px",
        onWidthChange,
        width: "288px",
      });
      const rail = getRail(container);
      fireEvent.keyDown(rail, { key: "Home" });
      expect(onWidthChange).toHaveBeenLastCalledWith("200px");
      fireEvent.keyDown(rail, { key: "End" });
      expect(onWidthChange).toHaveBeenLastCalledWith("400px");
    });

    it("does not resize via arrows while collapsed", () => {
      const onWidthChange = vi.fn();
      const { container } = renderSidebar({
        collapsed: true,
        onCollapsedChange: () => undefined,
        onWidthChange,
        width: "288px",
      });
      fireEvent.keyDown(getRail(container), { key: "ArrowRight" });
      expect(onWidthChange).not.toHaveBeenCalled();
    });

    it("toggles collapse on Enter / Space via onOpenChange", () => {
      const onCollapsedChange = vi.fn();
      const { container } = renderSidebar({
        collapsed: false,
        onCollapsedChange,
        width: "288px",
      });
      const rail = getRail(container);
      fireEvent.keyDown(rail, { key: "Enter" });
      expect(onCollapsedChange).toHaveBeenCalledWith(false);
      fireEvent.keyDown(rail, { key: " " });
      expect(onCollapsedChange).toHaveBeenCalledTimes(2);
    });
  });

  describe("pointer toggle", () => {
    it("fires onOpenChange with false on a clean click", () => {
      const onCollapsedChange = vi.fn();
      const { container } = renderSidebar({
        collapsed: false,
        onCollapsedChange,
        width: "288px",
      });
      const rail = getRail(container);
      fireEvent.pointerDown(rail, { clientX: 100, pointerId: 1 });
      act(() => {
        document.dispatchEvent(
          new PointerEvent("pointerup", { clientX: 100, pointerId: 1 })
        );
      });
      expect(onCollapsedChange).toHaveBeenCalledWith(false);
    });

    it("expands from a collapsed state on a clean click", () => {
      const onCollapsedChange = vi.fn();
      const { container } = renderSidebar({
        collapsed: true,
        onCollapsedChange,
        width: "288px",
      });
      const rail = getRail(container);
      fireEvent.pointerDown(rail, { clientX: 100, pointerId: 1 });
      act(() => {
        document.dispatchEvent(
          new PointerEvent("pointerup", { clientX: 100, pointerId: 1 })
        );
      });
      expect(onCollapsedChange).toHaveBeenCalledWith(true);
    });
  });

  describe("pointer drag (window-edge, left side)", () => {
    it("updates the wrapper CSS variable before pointerup for smooth dragging", () => {
      const onWidthChange = vi.fn();
      const { container } = renderSidebar({
        maxWidth: "400px",
        minWidth: "200px",
        onWidthChange,
        width: "288px",
      });
      const rail = getRail(container);
      const wrapper = getWrapper(container);

      fireEvent.pointerDown(rail, { clientX: 288, pointerId: 1 });
      act(() => {
        document.dispatchEvent(
          new PointerEvent("pointermove", { clientX: 350, pointerId: 1 })
        );
      });

      expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("350px");

      act(() => {
        document.dispatchEvent(
          new PointerEvent("pointerup", { clientX: 350, pointerId: 1 })
        );
      });
    });

    it("emits a new clamped width and toggles onResizingChange around the drag", () => {
      const onWidthChange = vi.fn();
      const onResizingChange = vi.fn();
      const { container } = renderSidebar({
        maxWidth: "400px",
        minWidth: "200px",
        onResizingChange,
        onWidthChange,
        width: "288px",
      });
      const rail = getRail(container);

      fireEvent.pointerDown(rail, { clientX: 288, pointerId: 1 });
      act(() => {
        document.dispatchEvent(
          new PointerEvent("pointermove", { clientX: 350, pointerId: 1 })
        );
        document.dispatchEvent(
          new PointerEvent("pointerup", { clientX: 350, pointerId: 1 })
        );
      });

      expect(onResizingChange).toHaveBeenCalledWith(true);
      expect(onResizingChange).toHaveBeenLastCalledWith(false);
      expect(onWidthChange).toHaveBeenCalledWith("350px");
    });

    it("clamps a drag beyond maxWidth", () => {
      const onWidthChange = vi.fn();
      const { container } = renderSidebar({
        maxWidth: "400px",
        minWidth: "200px",
        onWidthChange,
        width: "288px",
      });
      const rail = getRail(container);
      fireEvent.pointerDown(rail, { clientX: 288, pointerId: 1 });
      act(() => {
        document.dispatchEvent(
          new PointerEvent("pointermove", { clientX: 999, pointerId: 1 })
        );
        document.dispatchEvent(
          new PointerEvent("pointerup", { clientX: 999, pointerId: 1 })
        );
      });
      expect(onWidthChange).toHaveBeenLastCalledWith("400px");
    });

    it("does not toggle collapse after an actual drag", () => {
      const onCollapsedChange = vi.fn();
      const { container } = renderSidebar({
        collapsed: false,
        maxWidth: "400px",
        minWidth: "200px",
        onCollapsedChange,
        width: "288px",
      });
      const rail = getRail(container);
      fireEvent.pointerDown(rail, { clientX: 288, pointerId: 1 });
      act(() => {
        document.dispatchEvent(
          new PointerEvent("pointermove", { clientX: 350, pointerId: 1 })
        );
        document.dispatchEvent(
          new PointerEvent("pointerup", { clientX: 350, pointerId: 1 })
        );
      });
      expect(onCollapsedChange).not.toHaveBeenCalled();
    });

    it("can auto-collapse and expand again during the same pointer drag", () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      const { container } = render(<ControlledAutoCollapseSidebar />);
      const rail = getRail(container);
      fireEvent.pointerDown(rail, { clientX: 180, pointerId: 1 });

      act(() => {
        document.dispatchEvent(
          new PointerEvent("pointermove", { clientX: 80, pointerId: 1 })
        );
      });
      expect(getPanel(container).getAttribute("data-state")).toBe("collapsed");

      act(() => {
        vi.setSystemTime(250);
        document.dispatchEvent(
          new PointerEvent("pointermove", { clientX: 130, pointerId: 1 })
        );
      });
      expect(getPanel(container).getAttribute("data-state")).toBe("expanded");
      expect(
        getWrapper(container).style.getPropertyValue("--sidebar-width")
      ).toBe("130px");

      act(() => {
        document.dispatchEvent(
          new PointerEvent("pointerup", { clientX: 130, pointerId: 1 })
        );
      });
    });
  });

  describe("pointer drag (nested, left side)", () => {
    it("tracks width by pointer delta instead of absolute viewport x", () => {
      const onWidthChange = vi.fn();
      const { container } = renderSidebar({
        maxWidth: "400px",
        minWidth: "200px",
        nested: true,
        onWidthChange,
        width: "288px",
      });
      const rail = getRail(container);

      fireEvent.pointerDown(rail, { clientX: 500, pointerId: 1 });
      act(() => {
        document.dispatchEvent(
          new PointerEvent("pointermove", { clientX: 540, pointerId: 1 })
        );
        document.dispatchEvent(
          new PointerEvent("pointerup", { clientX: 540, pointerId: 1 })
        );
      });

      expect(onWidthChange).toHaveBeenLastCalledWith("328px");
    });
  });

  describe("compact tier", () => {
    it("renders at the compact width and marks data-state when compact", () => {
      const { container } = renderSidebar({
        compact: true,
        compactWidth: "120px",
        onCompactChange: () => undefined,
        width: "288px",
      });
      const panel = getPanel(container);
      expect(panel.style.width).toBe("var(--sidebar-width-compact)");
      expect(panel.getAttribute("data-state")).toBe("compact");
    });

    it("sets the --sidebar-width-compact CSS var from compactWidth", () => {
      const { container } = renderSidebar({
        compact: true,
        compactWidth: "120px",
        onCompactChange: () => undefined,
        width: "288px",
      });
      expect(
        getWrapper(container).style.getPropertyValue("--sidebar-width-compact")
      ).toBe("120px");
    });

    it("reports aria-expanded=true on the trigger while compact, not just while fully expanded", () => {
      const { getByRole } = renderSidebar({
        children: <SidebarTrigger>trigger</SidebarTrigger>,
        compact: true,
        compactWidth: "120px",
        onCompactChange: () => undefined,
        width: "288px",
      });
      expect(
        getByRole("button", { name: "trigger" }).getAttribute("aria-expanded")
      ).toBe("true");
    });

    // Regression for a real bug: SidebarTrigger's onClick calls the
    // context's toggleSidebar directly, a separate code path from the drag
    // handle's click-cycle and the rail's own keyboard cycle. Fixing one
    // without the other left this exact button stuck on a plain 2-way flip.
    it("cycles collapsed -> compact -> full -> collapsed via the dedicated SidebarTrigger button", () => {
      const { getByRole, container } = render(<ControlledTriStateSidebar />);
      const trigger = getByRole("button", { name: "trigger" });
      expect(getPanel(container).getAttribute("data-state")).toBe("collapsed");

      fireEvent.click(trigger);
      expect(getPanel(container).getAttribute("data-state")).toBe("compact");

      fireEvent.click(trigger);
      expect(getPanel(container).getAttribute("data-state")).toBe("expanded");

      fireEvent.click(trigger);
      expect(getPanel(container).getAttribute("data-state")).toBe("collapsed");
    });

    it("cycles collapsed -> compact -> full -> collapsed across three clean clicks", () => {
      const { container } = render(<ControlledTriStateSidebar />);
      const rail = getRail(container);
      expect(getPanel(container).getAttribute("data-state")).toBe("collapsed");

      const click = () => {
        fireEvent.pointerDown(rail, { clientX: 100, pointerId: 1 });
        act(() => {
          document.dispatchEvent(
            new PointerEvent("pointerup", { clientX: 100, pointerId: 1 })
          );
        });
      };

      click();
      expect(getPanel(container).getAttribute("data-state")).toBe("compact");

      click();
      expect(getPanel(container).getAttribute("data-state")).toBe("expanded");

      click();
      expect(getPanel(container).getAttribute("data-state")).toBe("collapsed");
    });

    it("cycles the same way on Enter/Space (keyboard focus on the rail itself)", () => {
      const { container } = render(<ControlledTriStateSidebar />);
      const rail = getRail(container);
      expect(getPanel(container).getAttribute("data-state")).toBe("collapsed");

      fireEvent.keyDown(rail, { key: "Enter" });
      expect(getPanel(container).getAttribute("data-state")).toBe("compact");

      fireEvent.keyDown(rail, { key: " " });
      expect(getPanel(container).getAttribute("data-state")).toBe("expanded");

      fireEvent.keyDown(rail, { key: "Enter" });
      expect(getPanel(container).getAttribute("data-state")).toBe("collapsed");
    });

    it("does not resize via arrow keys while sitting in the compact tier", () => {
      const onWidthChange = vi.fn();
      const { container } = renderSidebar({
        compact: true,
        compactWidth: "120px",
        maxWidth: "400px",
        minWidth: "200px",
        onCompactChange: () => undefined,
        onWidthChange,
        width: "288px",
      });
      const rail = getRail(container);
      fireEvent.keyDown(rail, { key: "ArrowRight" });
      expect(onWidthChange).not.toHaveBeenCalled();
    });
  });
});
