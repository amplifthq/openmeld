import type { MessageKey } from "../messages";
import type { ResolvedCliView, RuntimeContext } from "../types";

export type PresenterEventKind = "info" | "success" | "error";

export type PresenterEventOptions = {
  code?: string;
};

export type Presenter = {
  view: ResolvedCliView;
  event: (
    kind: PresenterEventKind,
    key: MessageKey,
    params?: Record<string, unknown>,
    options?: PresenterEventOptions
  ) => void;
  line: (input: {
    code: string;
    text: string;
    data?: Record<string, unknown>;
  }) => void;
  data: (input: { code: string; payload: unknown }) => void;
};

export type PresenterFactoryInput = {
  context: RuntimeContext;
};
