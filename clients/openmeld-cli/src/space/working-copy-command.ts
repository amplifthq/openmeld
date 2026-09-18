import { readFile, stat } from "node:fs/promises";
import { createSpaceApi } from "@openmeld/api-client";
import {
  spaceWorkingCopyResultSchema,
  spaceWorkSelectionSchema,
} from "@openmeld/schemas";
import { getAuthSessionState } from "../config/auth-session";
import { resolveOpenMeldRootDir } from "../config/paths";
import { createSpaceWorkingCopies } from "../local-service/file-access/space-working-copy";
import {
  DISPATCH_OWNED_RUNTIME_MODE,
  OPENMELD_DISPATCH_RUNTIME_MODE_ENV,
} from "../runtime/dispatch-runtime-env";
import { readDispatchSpaceActionContextFromEnv } from "../runtime/dispatch-space-action-context";
import { createCliApiClientFoundation } from "./api-client-foundation";
import {
  emitMutationOutput,
  prepareSpaceFilesContext,
  type SpaceFilesCommandInput,
} from "./files-command";
import { downloadWorkingCopyFile } from "./working-copy-download";

export async function runSpaceWorkingCopy(
  input: SpaceFilesCommandInput & {
    action:
      | "prepare"
      | "resume"
      | "status"
      | "commit"
      | "reconcile"
      | "incoming";
    copyId?: string;
    selection?: string;
    directory?: string;
  }
) {
  const context = await prepareSpaceFilesContext(
    input,
    "working with selected Space files"
  );
  if (!context) {
    return;
  }
  const initial = await getAuthSessionState({ validateRemote: false });
  const accountId = initial.session?.user?.id;
  const organizationId = initial.session?.activeOrganization?.id;
  const profileId = context.requestContext.actorContext?.openMeldProfileId;
  if (!(accountId && organizationId && profileId)) {
    throw new Error(
      "Sign in and select an Organization before preparing a working copy."
    );
  }
  const api = createSpaceApi(
    createCliApiClientFoundation(context.baseUrl, {
      expectedOwnerUserId: accountId,
      organizationId,
    })
  );
  const common = {
    spaceId: input.space,
    requestContext: context.requestContext,
    ...(input.password === undefined ? {} : { spacePassword: input.password }),
  };
  const copies = createSpaceWorkingCopies({
    laneRoot: resolveOpenMeldRootDir(),
    scope: {
      accountId,
      organizationId,
      profileId,
      spaceId: input.space,
      baseUrl: context.baseUrl,
    },
    assertCurrentIdentity: async () => {
      if (
        process.env[OPENMELD_DISPATCH_RUNTIME_MODE_ENV] ===
        DISPATCH_OWNED_RUNTIME_MODE
      ) {
        const dispatch = readDispatchSpaceActionContextFromEnv();
        if (
          dispatch.workingCopyId !== input.copyId ||
          dispatch.spaceId !== input.space ||
          dispatch.targetProfileId !== profileId
        ) {
          throw new Error(
            "The working copy does not belong to this active Wake."
          );
        }
      }
      const current = await getAuthSessionState({ validateRemote: false });
      if (
        current.session?.user?.id !== accountId ||
        current.session?.activeOrganization?.id !== organizationId
      ) {
        throw new Error(
          "Your account or Organization changed. Return to the original account to submit these changes."
        );
      }
    },
    transport: {
      read: (fileId, revision) =>
        downloadWorkingCopyFile(api, { ...common, fileId, revision }),
      get: async (fileId) => (await api.getFile({ ...common, fileId })).file,
      write: async (write) =>
        await api.updateFileContent({ ...common, ...write }),
    },
  });
  let result: unknown;
  if (input.action === "prepare") {
    const selection = input.selection ?? "";
    const info = await stat(selection);
    if (!info.isFile() || info.size > 128 * 1024) {
      throw new Error(
        "The selection must be a JSON file no larger than 128 KB."
      );
    }
    result = await copies.prepare(
      spaceWorkSelectionSchema.parse(
        JSON.parse(await readFile(selection, "utf8"))
      ),
      input.directory ?? ""
    );
  } else if (input.action === "incoming") {
    result = await copies.incoming(input.copyId ?? "", input.directory ?? "");
  } else {
    result = await copies[input.action](input.copyId ?? "");
  }
  emitMutationOutput({
    presenter: context.presenter,
    json: input.json,
    code: `space.files.working_copy.${input.action}`,
    text: JSON.stringify(result, null, 2),
    payload: spaceWorkingCopyResultSchema.parse(result),
  });
}
