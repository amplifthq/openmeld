import type { Presenter } from "../runtime/presenter";
import { renderInfoCard, renderTextInfoCard } from "./info-card";

export type HumanErrorCopy = {
  summary: string;
  nextStep: string | null;
};

const TECHNICAL_DETAIL_MARKERS = [
  /\s+Detail:/iu,
  /\s+Details:/iu,
  /\s+For diagnostics[,.:]?/iu,
  /\s+Diagnostic evidence:/iu,
  /\s+Last network error:/iu,
  /\s+Support code:/iu,
];
const ACTION_SENTENCE_RE =
  /^(?:After\b|Check\b|Choose\b|Close\b|Connect\b|Contact\b|Continue\b|Copy\b|Finish\b|Free\b|Go\b|Make sure\b|Open\b|Reconnect\b|Remove\b|Restart\b|Run\b|Select\b|Sign in\b|Start\b|Stop\b|Try\b|Turn off\b|Turn on\b|Update\b|Use\b|Wait\b)/iu;
const SENTENCE_BOUNDARY_RE = /(?<=[.!?])\s+(?=[A-Z`])/u;

export function buildHumanErrorCopy(message: string): HumanErrorCopy {
  const publicMessage = stripTechnicalErrorDetail(message);
  const sentences = splitSentences(publicMessage);
  const summary = sentences[0] ?? "OpenMeld couldn't finish that.";
  const nextStep =
    sentences.slice(1).find((sentence) => ACTION_SENTENCE_RE.test(sentence)) ??
    null;
  return { summary, nextStep };
}

export function renderHumanErrorCard(input: {
  codePrefix: string;
  message: string;
  nextStep?: string | null;
  presenter: Presenter;
  title?: string;
}): void {
  const copy = buildHumanErrorCopy(input.message);
  const explicitNextStep = input.nextStep
    ? buildHumanErrorCopy(input.nextStep)
    : null;
  renderInfoCard({
    codePrefix: input.codePrefix,
    compact: true,
    minContentWidth: 48,
    presenter: input.presenter,
    rows: buildHumanErrorRows({
      ...copy,
      nextStep: explicitNextStep
        ? (explicitNextStep.nextStep ?? explicitNextStep.summary)
        : copy.nextStep,
    }),
    sanitize: true,
    title: input.title ?? "OpenMeld couldn't finish",
  });
}

export function renderHumanTextErrorCard(input: {
  emitLine: (line: string) => void;
  message: string;
  title?: string;
}): void {
  const copy = buildHumanErrorCopy(input.message);
  renderTextInfoCard({
    compact: true,
    emitLine: input.emitLine,
    minContentWidth: 48,
    rows: buildHumanErrorRows(copy),
    sanitize: true,
    title: input.title ?? "OpenMeld couldn't finish",
  });
}

function buildHumanErrorRows(copy: HumanErrorCopy) {
  return [
    { label: "What happened", value: copy.summary },
    ...(copy.nextStep ? [{ label: "Next", value: copy.nextStep }] : []),
  ];
}

function stripTechnicalErrorDetail(message: string): string {
  let end = message.length;
  for (const marker of TECHNICAL_DETAIL_MARKERS) {
    const index = message.search(marker);
    if (index >= 0) {
      end = Math.min(end, index);
    }
  }
  return message.slice(0, end).replaceAll(/\s+/gu, " ").trim();
}

function splitSentences(message: string): string[] {
  return message
    .split(SENTENCE_BOUNDARY_RE)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}
