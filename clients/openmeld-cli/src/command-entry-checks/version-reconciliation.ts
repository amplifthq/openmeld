import type {
  CliVersionVerdict,
  ServiceVersionVerdict,
} from "@openmeld/schemas";
import { compareSemver } from "../config/version-state";
import type { CliUpdateAssessment } from "./cli-update-assessment";
import {
  describeServerRequiredVersionUnavailableReason,
  type ServerRequiredVersionAssessment,
} from "./server-required-version-assessment";

/**
 * The two accounts of "what CLI version should this computer be running" can
 * disagree (W-REL-DOCTOR): the release channel (npm registry / R2
 * `cli/manifest.json`) and Core's compiled release manifest are published
 * independently. `kind` names which side of that disagreement (if any) is
 * true right now; `message` is the one-line, human-readable verdict.
 */
/**
 * Reconciles the release-channel view of the CLI version
 * (`assessCliUpdate`) against the server-required view
 * (`assessServerRequiredVersion`) into a single verdict.
 *
 * This is the merge step that the incident this ticket fixes was missing:
 * before it, the CLI only ever printed the channel view, so a stuck release
 * channel looked identical to "everything is fine" even while Core's own
 * release manifest already required a newer version.
 */
export function reconcileCliVersionView(input: {
  channel: CliUpdateAssessment;
  server: ServerRequiredVersionAssessment;
}): CliVersionVerdict {
  const { channel, server } = input;

  if (!server.available) {
    return {
      kind: "server_unavailable",
      message: `Server-required version check is unavailable (${describeServerRequiredVersionUnavailableReason(server)}); showing the release channel view only.`,
    };
  }

  const channelLatest = channel.checked ? channel.latestVersion : null;
  if (!channelLatest) {
    return {
      kind: "channel_unavailable",
      message: `Release-channel version check did not run in this environment; the server currently reports ${server.cli.latestPackageVersion ?? "no"} version as latest for the CLI.`,
    };
  }

  const serverLatest = server.cli.latestPackageVersion;
  if (!serverLatest) {
    return {
      kind: "server_unavailable",
      message:
        "Server-required version check returned no CLI version data; showing the release channel view only.",
    };
  }

  // "Required" only has teeth when the server projection actually marks the
  // CLI as requiring an update; short of that, `latestPackageVersion` is
  // merely what the server currently publishes as latest, not a mandate.
  const serverRequired =
    server.cli.status === "update_required" ? serverLatest : null;

  if (serverRequired && compareSemver(serverRequired, channelLatest) > 0) {
    return {
      kind: "channel_behind",
      message: `Server requires ${serverRequired} but the release channel only has ${channelLatest} — the release channel is behind. Wait for OpenMeld to publish ${serverRequired}; re-running setup will not help.`,
    };
  }

  if (compareSemver(channelLatest, serverLatest) > 0) {
    return {
      kind: "channel_ahead",
      message: `The release channel already publishes ${channelLatest}, ahead of what the server currently expects (${serverLatest}) — the server-side release manifest may not be stamped yet.`,
    };
  }

  if (compareSemver(serverLatest, channelLatest) > 0) {
    return {
      kind: "channel_behind",
      message: `Server expects ${serverLatest}; the release channel has ${channelLatest} — the server-side manifest may be ahead.`,
    };
  }

  return {
    kind: "aligned",
    message: `Release channel and server agree: OpenMeld CLI ${channelLatest} is current.`,
  };
}

/**
 * The server visor's opinion on the installed OpenMeld Service (daemon)
 * version, alongside the locally observed installed version. Service has no
 * independent "release channel" the way the CLI package does (its bundle
 * ships inside each CLI release), so this is a simpler installed-vs-server
 * comparison rather than a three-way channel reconciliation.
 */
export function reconcileServiceVersionView(input: {
  installedVersion: string | null;
  server: ServerRequiredVersionAssessment;
}): ServiceVersionVerdict {
  if (!input.server.available) {
    return {
      kind: "server_unavailable",
      message: `Server-required version check is unavailable (${describeServerRequiredVersionUnavailableReason(input.server)}); showing the installed version only.`,
    };
  }

  const { service } = input.server;
  const installed = input.installedVersion ?? service.installedVersion;
  switch (service.status) {
    case "update_required": {
      const target = service.requiredVersion ?? service.latestVersion;
      return {
        kind: "update_required",
        message: `Server requires OpenMeld Service ${target ?? "a newer version"} (installed: ${installed ?? "unknown"}). Run \`openmeld service update\`.`,
      };
    }
    case "update_available":
      return {
        kind: "update_available",
        message: `OpenMeld Service ${service.latestVersion ?? "a newer version"} is available (installed: ${installed ?? "unknown"}).`,
      };
    case "current":
      return {
        kind: "aligned",
        message: `OpenMeld Service ${installed ?? "installed version"} matches what the server expects.`,
      };
    default:
      return {
        kind: "unknown",
        message: "Server-reported OpenMeld Service update status is unknown.",
      };
  }
}
