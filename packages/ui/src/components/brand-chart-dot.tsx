import type { CSSProperties } from "react";
import type { BrandChartColors } from "#lib/brand-chart-colors";

export function BrandChartDot({ colors }: { colors: BrandChartColors }) {
  return (
    <span
      aria-hidden="true"
      className="size-2 shrink-0 rounded-full bg-(--brand-chart-light) dark:bg-(--brand-chart-dark)"
      style={
        {
          "--brand-chart-light": colors.light[0],
          "--brand-chart-dark": colors.dark[0],
        } as CSSProperties
      }
    />
  );
}
