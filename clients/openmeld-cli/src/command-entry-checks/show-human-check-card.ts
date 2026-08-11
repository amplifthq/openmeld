import type { Presenter } from "../runtime/presenter";
import { type InfoCardRow, renderInfoCard } from "../ui/info-card";

export function showHumanCheckCard(input: {
  presenter: Presenter;
  codePrefix: string;
  title: string;
  status: string;
  why?: string | null;
  next: string;
}): void {
  const rows: InfoCardRow[] = [
    {
      label: "Status",
      value: input.status,
    },
  ];
  if (input.why && input.why.trim().length > 0) {
    rows.push({
      label: "Why",
      value: input.why,
    });
  }
  rows.push({
    label: "Next",
    value: input.next,
  });
  renderInfoCard({
    presenter: input.presenter,
    title: input.title,
    codePrefix: input.codePrefix,
    rows,
  });
}
