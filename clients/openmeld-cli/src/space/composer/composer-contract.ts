import type { SpacePanelKind } from "../panel/space-panel-definition";

export type ComposerIntent =
  | {
      kind: "quit";
    }
  | {
      kind: "buffer.updated";
      nextBufferText: string;
    }
  | {
      kind: "submit";
      nextBufferText: string;
      text: string;
    }
  | {
      kind: "submit.rejected";
      nextBufferText: string;
      reason: string;
    }
  | {
      kind: "command.panel.open";
      nextBufferText: string;
      panelKind: SpacePanelKind;
    };
