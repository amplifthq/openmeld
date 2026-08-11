import { outJsonLine } from "../../ui/io";
import { formatMessage, type MessageKey } from "../messages";
import type {
  Presenter,
  PresenterEventKind,
  PresenterEventOptions,
  PresenterFactoryInput,
} from "./types";

export function createAgentPresenter(input: PresenterFactoryInput): Presenter {
  const messageOverrides = input.context.viewCustomization?.messages?.agent;
  const envelopeMode =
    input.context.viewCustomization?.render?.agent?.envelopeMode ?? "verbose";

  return {
    view: "agent",
    event: (
      kind: PresenterEventKind,
      key: MessageKey,
      params?: Record<string, unknown>,
      options?: PresenterEventOptions
    ) => {
      const message = formatMessage("agent", key, params, messageOverrides);
      emitEnvelope(envelopeMode, {
        type: kind,
        code: options?.code ?? key,
        message,
        ...(params ? { data: params } : {}),
      });
    },
    line: (inputLine: {
      code: string;
      text: string;
      data?: Record<string, unknown>;
    }) => {
      emitEnvelope(envelopeMode, {
        type: "line",
        code: inputLine.code,
        text: inputLine.text,
        ...(inputLine.data ? { data: inputLine.data } : {}),
      });
    },
    data: (inputData: { code: string; payload: unknown }) => {
      emitEnvelope(envelopeMode, {
        type: "result",
        code: inputData.code,
        payload: inputData.payload,
      });
    },
  };
}

function emitEnvelope(
  mode: "verbose" | "compact",
  value: {
    type: string;
    code: string;
    message?: string;
    text?: string;
    data?: Record<string, unknown>;
    payload?: unknown;
  }
): void {
  if (mode === "compact") {
    outJsonLine({
      t: value.type,
      c: value.code,
      ...(value.message ? { m: value.message } : {}),
      ...(value.text ? { x: value.text } : {}),
      ...(value.data ? { d: value.data } : {}),
      ...(value.payload === undefined ? {} : { p: value.payload }),
    });
    return;
  }

  outJsonLine(value);
}
