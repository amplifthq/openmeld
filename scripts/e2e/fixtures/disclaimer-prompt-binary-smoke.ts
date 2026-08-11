import { runOnboardingDisclaimerGate } from "../../../clients/openmeld-cli/src/onboarding/disclaimer";

const accepted = await runOnboardingDisclaimerGate({
  runtime: {
    resolvedView: "human",
  } as never,
  presenter: {
    data: () => undefined,
    line: () => undefined,
  } as never,
  interactive: true,
  codePrefix: "smoke.disclaimer",
});

process.stdout.write(`RESULT:${JSON.stringify({ accepted })}\n`);
