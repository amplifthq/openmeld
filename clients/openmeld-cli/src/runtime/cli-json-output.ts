import {
  type CliJsonOutputEnvelope,
  cliJsonOutputEnvelopeSchema,
} from "@openmeld/schemas";
import { outJsonLine } from "../ui/io";

/**
 * Single emit point for the CLI `--json` machine-readable output envelope.
 *
 * The envelope contract is owned by
 * `@openmeld/schemas` (`cliJsonOutputEnvelopeSchema`); the
 * `CliJsonOutputEnvelope` parameter type derives from it, so every call site is
 * compile-time checked against the shared contract instead of hand-writing a
 * shape that can drift (`developing/architecture/shared-contracts.md`: CLI JSON
 * is a shared boundary).
 *
 * The wire bytes are always the original object (key order and domain-owned
 * flattened fields preserved). `safeParse` runs as a fail-open drift guard: a
 * contract gap must never alter or suppress already-published `--json` output,
 * so a validation miss only surfaces as an opt-in diagnostic on stderr under
 * `OPENMELD_DEBUG_CLI_JSON=1` and never touches stdout.
 */
export function emitCliJsonEnvelope(envelope: CliJsonOutputEnvelope): void {
  const validation = cliJsonOutputEnvelopeSchema.safeParse(envelope);
  if (!validation.success && process.env.OPENMELD_DEBUG_CLI_JSON === "1") {
    process.stderr.write(
      `openmeld: --json envelope failed shared contract validation: ${validation.error.message}\n`
    );
  }
  outJsonLine(envelope);
}
