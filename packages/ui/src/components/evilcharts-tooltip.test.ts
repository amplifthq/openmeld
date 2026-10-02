import { describe, expect, it } from "vitest";
import { tooltipRow, tooltipShell } from "./evilcharts/ui/echarts-tooltip";

describe("Chart tooltip text", () => {
  it("keeps data labels as text without interpreting HTML", () => {
    const element = document.createElement("div");
    const label = '<img src=x onerror="alert(1)">';
    element.innerHTML = tooltipShell({
      label,
      variant: "default",
      roundness: "md",
      body: tooltipRow({
        labelText: label,
        valueText: "<42 & 7>",
        dimmed: "",
        indicatorHtml: "",
      }),
    });
    expect(element.querySelector("img")).toBeNull();
    expect(element.textContent).toContain(label);
    expect(element.textContent).toContain("<42 & 7>");
  });
});
