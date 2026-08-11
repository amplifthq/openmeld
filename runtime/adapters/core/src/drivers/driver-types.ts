import type { AgentControllerProcessSignalTarget } from "../agent-controller-process.js";

export type CliDriverLineEvent = {
  line: string;
};

export type CliDriverLineDecision = {
  complete?: boolean;
  terminateProcess?: boolean;
};

export type CliDriverLifecycleEvent =
  | {
      phase: "process_spawned";
      processId: number | null;
      signalTarget: AgentControllerProcessSignalTarget;
      tsMs: number;
    }
  | {
      phase: "stdin_closed";
      processId: number | null;
      tsMs: number;
    }
  | {
      phase: "first_stdout";
      processId: number | null;
      tsMs: number;
    }
  | {
      phase: "first_stderr";
      processId: number | null;
      tsMs: number;
    }
  | {
      phase: "timeout_triggered";
      processId: number | null;
      tsMs: number;
    }
  | {
      exitCode: number | null;
      phase: "process_exit";
      processId: number | null;
      signal: NodeJS.Signals | null;
      signalTarget: AgentControllerProcessSignalTarget;
      tsMs: number;
    };

export type CliDriverLifecycleTelemetry = {
  exitCode: number | null;
  exitObservedAtMs: number | null;
  exitSignal: NodeJS.Signals | null;
  firstStderrAtMs: number | null;
  firstStdoutAtMs: number | null;
  processId: number | null;
  processSpawnedAtMs: number | null;
  stdinClosedAtMs: number | null;
  timeoutTriggeredAtMs: number | null;
};

export type CliDriverProcessControlEvent = {
  phase: "process_exit" | "process_spawned";
  processId: number | null;
  signalTarget: AgentControllerProcessSignalTarget;
};

export type CliDriverInvocation = {
  allowNonZeroExit?: boolean;
  args: string[];
  bin: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  inputText?: string;
  onLifecycleEvent?: (event: CliDriverLifecycleEvent) => void;
  onProcessControlEvent?: (event: CliDriverProcessControlEvent) => void;
  onStderrLine?: (
    event: CliDriverLineEvent
  ) => CliDriverLineDecision | undefined;
  onStdoutLine?: (
    event: CliDriverLineEvent
  ) => CliDriverLineDecision | undefined;
  shell?: boolean;
  // Explicit watchdog only. OpenMeld Wake execution must not pass a hard-coded
  // default here; provider terminal output, failures, cancellation, or
  // stale-progress policy own normal task completion.
  timeoutMs?: number | null;
};

export type CliDriverInvocationResult = {
  exitCode: number;
  lifecycle: CliDriverLifecycleTelemetry;
  signal: NodeJS.Signals | null;
  stderrText: string;
  stdoutText: string;
};

export type HttpResponsesDriverStreamingMode = "final" | "stream";

export type HttpResponsesDriverRequest = {
  body: Record<string, unknown>;
  endpoint: string;
  headers: Record<string, string>;
  method: "GET" | "POST";
  streamingMode: HttpResponsesDriverStreamingMode;
  timeoutMs: number;
};

export type HttpResponsesDriverUsage = {
  completionTokens?: number;
  promptTokens?: number;
  totalTokens?: number;
};

export type HttpResponsesDriverChunk = {
  deltaText: string;
  seq: number;
  tsMs: number;
};

export type HttpResponsesDriverResult = {
  chunks?: HttpResponsesDriverChunk[];
  outputText: string;
  providerResponseId?: string;
  usage?: HttpResponsesDriverUsage;
};
