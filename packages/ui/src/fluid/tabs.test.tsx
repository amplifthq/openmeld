import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TabItem, Tabs, TabsList } from "./tabs";

afterEach(cleanup);

describe("Tabs", () => {
  it("uses the configurable control-group radius instead of pill geometry", () => {
    render(
      <Tabs defaultValue="library">
        <TabsList>
          <TabItem label="Library" value="library" />
          <TabItem label="Recents" value="recents" />
        </TabsList>
      </Tabs>
    );

    const tabList = screen.getByRole("tablist");
    expect(tabList.className).toContain("rounded-lg");
    expect(tabList.className).not.toContain("rounded-xl");
  });
});
