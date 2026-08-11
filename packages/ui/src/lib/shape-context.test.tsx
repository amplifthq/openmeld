import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ROUNDED_SHAPE_RADIUS_PX,
  ShapeProvider,
  type ShapeVariant,
  useShape,
  useShapeContext,
} from "#lib/shape-context";

afterEach(cleanup);

function ShapeConsumer() {
  const shapeClasses = useShape();
  const { setShape, shape } = useShapeContext();

  return (
    <button
      data-background-class={shapeClasses.bg}
      data-item-class={shapeClasses.item}
      data-merged-radius={shapeClasses.mergedRadius}
      data-shape={shape}
      onClick={() => setShape("rounded")}
      type="button"
    >
      Use rounded corners
    </button>
  );
}

describe("ShapeProvider", () => {
  it("defaults to Linear's rounded control geometry", () => {
    render(
      <ShapeProvider>
        <ShapeConsumer />
      </ShapeProvider>
    );

    const control = screen.getByRole("button", {
      name: "Use rounded corners",
    });
    expect(DEFAULT_ROUNDED_SHAPE_RADIUS_PX).toBe(8);
    expect(control.getAttribute("data-shape")).toBe("rounded");
    expect(control.getAttribute("data-item-class")).toBe("rounded-md");
    expect(control.getAttribute("data-background-class")).toBe("rounded-md");
    expect(control.getAttribute("data-merged-radius")).toBe("8");
  });

  it("supports a client-controlled shape without owning persistence", () => {
    const onShapeChange = vi.fn<(shape: ShapeVariant) => void>();
    const view = render(
      <ShapeProvider onShapeChange={onShapeChange} shape="square">
        <ShapeConsumer />
      </ShapeProvider>
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Use rounded corners" })
    );

    expect(onShapeChange).toHaveBeenCalledWith("rounded");
    expect(
      screen
        .getByRole("button", { name: "Use rounded corners" })
        .getAttribute("data-shape")
    ).toBe("square");

    view.rerender(
      <ShapeProvider onShapeChange={onShapeChange} shape="rounded">
        <ShapeConsumer />
      </ShapeProvider>
    );

    expect(
      screen
        .getByRole("button", { name: "Use rounded corners" })
        .getAttribute("data-shape")
    ).toBe("rounded");
  });

  it("accepts one numeric radius for future custom corner values", () => {
    render(
      <ShapeProvider roundedRadiusPx={12} shape="rounded">
        <ShapeConsumer />
      </ShapeProvider>
    );

    expect(
      screen
        .getByRole("button", { name: "Use rounded corners" })
        .getAttribute("data-merged-radius")
    ).toBe("12");
  });
});
