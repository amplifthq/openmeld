import { localFolderPickerRpcInputSchema } from "@openmeld/schemas";
import type {
  DaemonServiceLane,
  LocalFolderPickerResult,
  LocalFolderPickerRpcInput,
} from "@openmeld/schemas/types";
import type { selectRuntimeTransportLocalFolders } from "../dispatch/infrastructure/runtime-transport/runtime-transport-client";
import type { CoreBindings } from "../lib/bindings";
import { createCoreRpcHttpError } from "../rpc/errors";

type CurrentLocalFolderPickerTarget = {
  deviceId: string;
  runtimeLane: DaemonServiceLane;
};

type LocalFolderPickerRpcDependencies = {
  requireOwnerUserId: (context: LocalFolderPickerRpcInput["context"]) => string;
  resolveCurrentTarget: (input: {
    env: CoreBindings;
    userId: string;
  }) => Promise<CurrentLocalFolderPickerTarget>;
  selectFolders: typeof selectRuntimeTransportLocalFolders;
};

export function createLocalFolderPickerRpc(
  dependencies: LocalFolderPickerRpcDependencies
) {
  return {
    async selectFolders(
      env: CoreBindings,
      input: LocalFolderPickerRpcInput
    ): Promise<LocalFolderPickerResult> {
      const parsed = localFolderPickerRpcInputSchema.safeParse(input);
      if (!parsed.success) {
        throw createCoreRpcHttpError({
          code: "local.folder_picker.invalid_request",
          reason:
            parsed.error.issues[0]?.message ??
            "The Local Folder Picker request is invalid.",
          status: 400,
        });
      }

      const ownerUserId = dependencies.requireOwnerUserId(parsed.data.context);
      const target = await dependencies.resolveCurrentTarget({
        env,
        userId: ownerUserId,
      });
      if (parsed.data.expectedDeviceId !== target.deviceId) {
        throw createCoreRpcHttpError({
          code: "local.folder_picker.device_mismatch",
          reason:
            "This folder request targeted a different Computer. Refresh Computers and try again.",
          status: 409,
        });
      }

      return await dependencies.selectFolders({
        deviceId: target.deviceId,
        env,
        ownerUserId,
        request: {
          allowMultiple: parsed.data.allowMultiple,
          expectedDeviceId: target.deviceId,
          purpose: parsed.data.purpose,
        },
        runtimeLane: target.runtimeLane,
      });
    },
  };
}
