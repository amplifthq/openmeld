import * as z from "../../lazy-zod";
import { computerFileAccessUpdateRequestSchema } from "../daemon/computer-file-access";
import { localFolderPickerRequestSchema } from "../daemon/local-folder-picker";
import { localProjectControlDiscoverProjectsRpcInputSchema } from "../daemon/local-project-control";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { daemonExecutionCompatibilitySchema } from "../daemon/runtime-transport";
import { daemonServiceLaneSchema } from "../daemon/service-contract";
import { START_BOUNDED_ID_SCHEMA } from "../start/shared";
import { localRuntimeComputerSchema } from "./local-runtimes";

// An explicit target is local Service identity, never an AgentComputer or a
// guess based on the owner's default Binding. Core verifies account ownership.
export const peopleComputerTargetSchema = z.strictObject({
  deviceId: START_BOUNDED_ID_SCHEMA,
  runtimeLane: daemonServiceLaneSchema,
});
export const peopleComputerProjectDiscoveryRpcInputSchema =
  localProjectControlDiscoverProjectsRpcInputSchema.extend(
    peopleComputerTargetSchema.shape
  );

export const peopleComputerFileAccessReadRpcInputSchema =
  peopleComputerTargetSchema.extend({
    context: openMeldRequestContextSchema,
  });
export const peopleComputerFolderPickerBodySchema =
  localFolderPickerRequestSchema.omit({ expectedDeviceId: true });
export const peopleComputerFolderPickerRpcInputSchema =
  peopleComputerTargetSchema.extend({
    context: openMeldRequestContextSchema,
    ...peopleComputerFolderPickerBodySchema.shape,
  });
export const peopleComputerFileAccessUpdateBodySchema =
  computerFileAccessUpdateRequestSchema.omit({ expectedDeviceId: true });
export const peopleComputerFileAccessUpdateRpcInputSchema =
  peopleComputerFileAccessReadRpcInputSchema.extend(
    peopleComputerFileAccessUpdateBodySchema.shape
  );

export const peopleComputerConnectionSchema = z.strictObject({
  status: z.enum(["connected", "disconnected", "unknown"]),
  reasonCodes: z.array(z.string().min(1).max(256)),
  sessions: z.array(
    peopleComputerTargetSchema.extend({
      lastHeartbeatMs: z.number().int().nonnegative(),
      serviceVersion: z.string().nullable(),
      executionCompatibility: daemonExecutionCompatibilitySchema,
      controls: z
        .strictObject({
          localAgentControl: z.strictObject({
            refreshCatalog: z.boolean(),
            setEnabled: z.boolean(),
            manageInstallations: z.boolean(),
            manageInstallationsSafely: z.boolean(),
            setProfileWorkspace: z.boolean(),
          }),
          openMeldToolsControl: z.strictObject({
            requestUpdate: z.boolean(),
            setAutomaticUpdates: z.boolean(),
          }),
          computerFileAccess: z
            .strictObject({
              readPolicy: z.boolean(),
              updatePolicy: z.boolean(),
            })
            .optional(),
          localFolderPicker: z
            .strictObject({ selectFolders: z.boolean() })
            .optional(),
          localProjectControl: z
            .strictObject({ discoverProjects: z.boolean() })
            .optional(),
        })
        .optional(),
      serviceUpdate: z.strictObject({
        wakeBlocked: z.boolean(),
        reasonCodes: z.array(z.string()),
      }),
    })
  ),
});

export const peopleComputerSchema = localRuntimeComputerSchema
  .omit({ connectionStatus: true, isCurrent: true, executionTargets: true })
  .extend({
    identityStatus: z.enum(["enrolled", "unconfirmed"]),
    connection: peopleComputerConnectionSchema,
    executionTargets: z.array(
      localRuntimeComputerSchema.shape.executionTargets.element.omit({
        isCurrent: true,
      })
    ),
  });

export const peopleComputersResponseSchema = z.strictObject({
  generatedAt: z.iso.datetime({ offset: true }),
  computers: z.array(peopleComputerSchema),
});
