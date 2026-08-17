import { isCancel, select } from "@clack/prompts";
import { createSetupProgressReporter } from "../../src/ui/setup-progress";

// Expect's pseudo-terminal reports a one-column viewport to Bun on macOS.
// Pin a normal terminal width so this smoke exercises prompt ownership rather
// than Clack's emergency one-character wrapping path.
Object.defineProperty(process.stdout, "columns", {
  configurable: true,
  value: 120,
});

const progress = createSetupProgressReporter({
  presenter: {
    line: (line: { text: string }) => {
      process.stdout.write(`LINE:${line.text}\n`);
    },
  } as never,
  runtime: {
    interactive: true,
    resolvedView: "human",
    viewMode: "human",
  } as never,
});
const step = progress.startStep({
  code: "smoke.setup.service",
  text: "Preparing OpenMeld Service.",
});

await new Promise((resolve) => setTimeout(resolve, 150));
const choice = await select({
  message: "What do you want to do?",
  options: [
    { label: "Sign in now", value: "sign_in" },
    { label: "Cancel", value: "cancel" },
  ],
});

if (isCancel(choice)) {
  step.cancel();
  process.stdout.write('RESULT:{"status":"cancelled"}\n');
} else {
  step.complete("OpenMeld Service is ready.");
  process.stdout.write(
    `RESULT:${JSON.stringify({ status: "selected", choice })}\n`
  );
}
