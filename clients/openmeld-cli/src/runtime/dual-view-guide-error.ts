import {
  buildDualViewGuideMessage,
  type DualViewGuideInput,
} from "./dual-view-guide";
import { formatDualViewGuideForDisplay } from "./dual-view-guide-display";

export type DualViewGuideErrorInput = {
  code: string;
  guide: DualViewGuideInput;
  hints?: string[];
};

export class DualViewGuideError extends Error {
  readonly code: string;
  readonly guide: DualViewGuideInput;
  readonly hints: string[];

  constructor(input: DualViewGuideErrorInput) {
    super(
      buildDualViewGuideMessage(formatDualViewGuideForDisplay(input.guide))
    );
    this.name = "DualViewGuideError";
    this.code = input.code;
    this.guide = input.guide;
    this.hints = input.hints ?? [];
  }
}
