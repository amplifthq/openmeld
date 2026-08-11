import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import type { LocalComponentsReleaseManifest } from "@openmeld/schemas/types";

export const REQUIRED_SERVICE_UPDATE_RELEASE_MANIFEST = {
  schemaVersion: 1,
  updatedAt: "2026-06-18T00:00:00.000Z",
  components: {
    cli: {
      commandContractVersion:
        "openmeld-cli-command-contract-2026-05-local-components-v1",
      packageVersion: "999.0.0",
      updatePolicy: "available",
      reason: "Test fixture for required OpenMeld Service update policy.",
    },
    service: {
      bundleHash:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      bundleVersion: "999.0.0",
      runtimeContractEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
      serviceContractVersion: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
      updatePolicy: "required",
      reason: "Test fixture for required OpenMeld Service update policy.",
    },
    skills: {
      bundleHash:
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      skillContractVersion: "openmeld-skills-contract-2026-05-required-v1",
      skillIds: ["openmeld-cli"],
      updatePolicy: "available",
      reason: "Test fixture for required OpenMeld Service update policy.",
    },
  },
} satisfies LocalComponentsReleaseManifest;
