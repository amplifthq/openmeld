import type { ReactNode } from "react";

export type SettingsDetailListRow = {
  label: string;
  value: ReactNode;
};

export function SettingsDetailList({
  rows,
}: {
  rows: readonly SettingsDetailListRow[];
}) {
  return (
    <dl className="grid gap-0 overflow-hidden rounded-md border border-border/70 text-xs sm:grid-cols-[9rem_minmax(0,1fr)]">
      {rows.map((row, index) => {
        const isLast = index === rows.length - 1;
        return (
          <div className="contents" key={row.label}>
            <dt
              className={
                isLast
                  ? "px-3 py-2 text-muted-foreground"
                  : "border-border/70 border-b px-3 py-2 text-muted-foreground"
              }
            >
              {row.label}
            </dt>
            <dd
              className={
                isLast
                  ? "min-w-0 break-words px-3 py-2 font-medium text-foreground"
                  : "min-w-0 break-words border-border/70 border-b px-3 py-2 font-medium text-foreground"
              }
            >
              {row.value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
