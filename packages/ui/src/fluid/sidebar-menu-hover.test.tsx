import { act, cleanup, render } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { FluidNavMenu, FluidNavMenuItem } from "./nav-menu";

const hover = vi.hoisted(() => ({
  set: (_index: number | null): void => undefined,
}));
vi.mock("#hooks/use-proximity-hover", async () => {
  const { useState } = await import("react");
  const stable = {
    itemRects: [],
    sessionRef: { current: 0 },
    handlers: {},
    registerItem: () => undefined,
  };
  return {
    useProximityHover: () => {
      const [activeIndex, setActiveIndex] = useState<number | null>(null);
      hover.set = setActiveIndex;
      return { ...stable, activeIndex, setActiveIndex };
    },
  };
});
afterEach(cleanup);

it("updates only the departed and entered rows when hover moves through a long menu", () => {
  const commits = new Map<string, number>();
  const ids = Array.from({ length: 100 }, (_, index) => String(index));
  render(
    <FluidNavMenu activeValue={null} aria-label="Long menu">
      {ids.map((id, index) => (
        <Profiler
          id={id}
          key={id}
          onRender={(id) => {
            commits.set(id, (commits.get(id) ?? 0) + 1);
          }}
        >
          <FluidNavMenuItem index={index} value={String(index)}>
            <a href={`#${index}`}>Space {index}</a>
          </FluidNavMenuItem>
        </Profiler>
      ))}
    </FluidNavMenu>
  );
  act(() => hover.set(0));
  commits.clear();
  act(() => hover.set(1));
  expect([...commits.keys()].sort()).toEqual(["0", "1"]);
});
