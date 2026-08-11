import type { RuntimeContext } from "../runtime/context";
import type { Presenter } from "../runtime/presenter";
import { createDelayedSpinner } from "./delayed-spinner";
import {
  formatElapsedTime,
  MIN_VISIBLE_ELAPSED_TIME_MS,
  resolveElapsedTimeMs,
} from "./elapsed-time";
import { sanitizeTerminalDisplayText } from "./terminal-safe-text";

type SetupProgressLineState = "pending" | "success" | "failed";
type SetupProgressStepState = "started" | "completed" | "failed";

export type SetupProgressStepHandle = {
  cancel: () => void;
  complete: (message?: string) => void;
  detail: (input: { code?: string; text: string }) => void;
  fail: (message?: string) => void;
};

export type SetupProgressReporter = {
  detail: (input: {
    code: string;
    data?: Record<string, unknown>;
    text: string;
  }) => void;
  line: (input: {
    code: string;
    data?: Record<string, unknown>;
    state: SetupProgressLineState;
    text: string;
  }) => void;
  startStep: (input: {
    code: string;
    data?: Record<string, unknown>;
    text: string;
  }) => SetupProgressStepHandle;
};

export function createSetupProgressReporter(input: {
  presenter: Presenter;
  runtime: RuntimeContext;
}): SetupProgressReporter {
  const mode = resolveSetupProgressRenderMode(input.runtime);

  return {
    detail: (detail) => {
      if (mode === "agent") {
        emitAgentProgressLine({
          presenter: input.presenter,
          code: detail.code,
          state: "started",
          text: formatSetupProgressActiveText(detail.text),
          data: detail.data,
        });
        return;
      }

      input.presenter.line({
        code: detail.code,
        text: `  ${formatSetupProgressActiveText(detail.text)}`,
      });
    },
    line: (line) => {
      if (mode === "agent") {
        emitAgentProgressLine({
          presenter: input.presenter,
          code: line.code,
          state: line.state,
          text:
            line.state === "pending"
              ? formatSetupProgressActiveText(line.text)
              : formatSetupProgressResultText(line.text),
          data: line.data,
        });
        return;
      }

      emitHumanProgressLine({
        presenter: input.presenter,
        state: line.state,
        text:
          line.state === "pending"
            ? formatSetupProgressActiveText(line.text)
            : formatSetupProgressResultText(line.text),
        code: line.code,
      });
    },
    startStep: (step) => {
      const startedText = formatSetupProgressActiveText(step.text);
      const startedAtMs = Date.now();

      if (mode === "agent") {
        emitAgentProgressLine({
          presenter: input.presenter,
          code: step.code,
          state: "started",
          text: startedText,
          data: step.data,
        });
        return createAgentStepHandle({
          code: step.code,
          data: step.data,
          presenter: input.presenter,
          startedAtMs,
          startedText,
        });
      }

      if (mode === "human_tty") {
        return createHumanTtyStepHandle({
          presenter: input.presenter,
          code: step.code,
          startedText,
          startedAtMs,
        });
      }

      emitHumanProgressLine({
        presenter: input.presenter,
        code: step.code,
        state: "pending",
        text: startedText,
      });
      return createHumanStaticStepHandle({
        code: step.code,
        presenter: input.presenter,
        startedAtMs,
      });
    },
  };
}

export function formatSetupProgressActiveText(text: string): string {
  const normalized = formatSetupProgressResultText(text).replaceAll(
    /\.+$/g,
    ""
  );
  return `${normalized}...`;
}

function createAgentStepHandle(input: {
  code: string;
  data?: Record<string, unknown>;
  presenter: Presenter;
  startedAtMs: number;
  startedText: string;
}): SetupProgressStepHandle {
  let closed = false;
  return {
    cancel: () => {
      closed = true;
    },
    complete: (message) => {
      if (closed) {
        return;
      }
      closed = true;
      const durationMs = resolveElapsedTimeMs(input.startedAtMs);
      emitAgentProgressLine({
        presenter: input.presenter,
        code: `${input.code}.completed`,
        state: "completed",
        text: message
          ? formatSetupProgressResultText(message)
          : input.startedText,
        data: withStepDuration(input.data, durationMs),
      });
    },
    detail: (detail) => {
      if (closed) {
        return;
      }
      emitAgentProgressLine({
        presenter: input.presenter,
        code: detail.code ?? `${input.code}.detail`,
        state: "started",
        text: formatSetupProgressActiveText(detail.text),
        data: input.data,
      });
    },
    fail: (message) => {
      if (closed) {
        return;
      }
      closed = true;
      const durationMs = resolveElapsedTimeMs(input.startedAtMs);
      emitAgentProgressLine({
        presenter: input.presenter,
        code: `${input.code}.failed`,
        state: "failed",
        text: message
          ? formatSetupProgressResultText(message)
          : input.startedText,
        data: withStepDuration(input.data, durationMs),
      });
    },
  };
}

function createHumanTtyStepHandle(input: {
  code: string;
  presenter: Presenter;
  startedAtMs: number;
  startedText: string;
}): SetupProgressStepHandle {
  const spinner = createDelayedSpinner({
    enabled: true,
    message: input.startedText,
  });
  spinner.start();
  let closed = false;

  return {
    cancel: () => {
      if (closed) {
        return;
      }
      closed = true;
      spinner.fail();
    },
    complete: (message) => {
      if (closed) {
        return;
      }
      closed = true;
      const durationMs = resolveElapsedTimeMs(input.startedAtMs);
      const resultText = message
        ? withHumanStepDuration(
            formatSetupProgressResultText(message),
            durationMs
          )
        : null;
      spinner.complete();
      if (message) {
        emitHumanProgressLine({
          presenter: input.presenter,
          code: `${input.code}.completed`,
          state: "success",
          text: resultText ?? "",
        });
      }
    },
    detail: (detail) => {
      if (closed) {
        return;
      }
      spinner.message(formatSetupProgressActiveText(detail.text));
    },
    fail: (message) => {
      if (closed) {
        return;
      }
      closed = true;
      const durationMs = resolveElapsedTimeMs(input.startedAtMs);
      spinner.fail();
      if (message) {
        emitHumanProgressLine({
          presenter: input.presenter,
          code: `${input.code}.failed`,
          state: "failed",
          text: withHumanStepDuration(
            formatSetupProgressResultText(message),
            durationMs
          ),
        });
      }
    },
  };
}

function createHumanStaticStepHandle(input: {
  code: string;
  presenter: Presenter;
  startedAtMs: number;
}): SetupProgressStepHandle {
  let closed = false;
  return {
    cancel: () => {
      closed = true;
    },
    complete: (message) => {
      if (closed) {
        return;
      }
      closed = true;
      const durationMs = resolveElapsedTimeMs(input.startedAtMs);
      if (message) {
        emitHumanProgressLine({
          presenter: input.presenter,
          code: `${input.code}.completed`,
          state: "success",
          text: withHumanStepDuration(
            formatSetupProgressResultText(message),
            durationMs
          ),
        });
      }
    },
    detail: (detail) => {
      if (closed) {
        return;
      }
      input.presenter.line({
        code: detail.code ?? `${input.code}.detail`,
        text: `  ${formatSetupProgressActiveText(detail.text)}`,
      });
    },
    fail: (message) => {
      if (closed) {
        return;
      }
      closed = true;
      const durationMs = resolveElapsedTimeMs(input.startedAtMs);
      if (message) {
        emitHumanProgressLine({
          presenter: input.presenter,
          code: `${input.code}.failed`,
          state: "failed",
          text: withHumanStepDuration(
            formatSetupProgressResultText(message),
            durationMs
          ),
        });
      }
    },
  };
}

function resolveSetupProgressRenderMode(
  runtime: RuntimeContext
): "agent" | "human_static" | "human_tty" {
  if (runtime.resolvedView === "agent") {
    return "agent";
  }
  // `curl | sh` makes stdin non-TTY, but progress animation only needs a TTY
  // stdout. Keep prompt interactivity separate from progress rendering.
  if (process.stdout.isTTY === true) {
    return "human_tty";
  }
  return "human_static";
}

function emitAgentProgressLine(input: {
  code: string;
  data?: Record<string, unknown>;
  presenter: Presenter;
  state: SetupProgressLineState | SetupProgressStepState;
  text: string;
}): void {
  input.presenter.line({
    code: input.code,
    text: input.text,
    data: {
      ...(input.data ?? {}),
      message: input.text,
      state: input.state,
    },
  });
}

function emitHumanProgressLine(input: {
  code: string;
  presenter: Presenter;
  state: SetupProgressLineState;
  text: string;
}): void {
  const marker = resolveHumanProgressMarker(input.state);
  input.presenter.line({
    code: input.code,
    text: `${marker} ${input.text}`,
  });
}

function resolveHumanProgressMarker(state: SetupProgressLineState): string {
  if (state === "success") {
    return "✓";
  }
  if (state === "failed") {
    return "!";
  }
  return "•";
}

function formatSetupProgressResultText(text: string): string {
  return sanitizeTerminalDisplayText(text, "single-line").trim();
}

function withStepDuration(
  data: Record<string, unknown> | undefined,
  durationMs: number
): Record<string, unknown> | undefined {
  if (durationMs < MIN_VISIBLE_ELAPSED_TIME_MS) {
    return data;
  }
  return { ...(data ?? {}), durationMs };
}

function withHumanStepDuration(text: string, durationMs: number): string {
  if (durationMs < MIN_VISIBLE_ELAPSED_TIME_MS) {
    return text;
  }
  return `${text} · ${formatElapsedTime(durationMs)}`;
}
