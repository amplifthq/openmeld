import { readFile, stat } from "node:fs/promises";
import { postSpaceWorkHandoff } from "@openmeld/api-client";
import { spaceWorkHandoffSchema } from "@openmeld/schemas";
import {
  emitMutationOutput,
  prepareSpaceFilesContext,
  type SpaceFilesCommandInput,
} from "./files-command";

export async function runSpaceWorkHandoff(
  input: SpaceFilesCommandInput & {
    manifest: string;
    target: string;
    clientMessageId: string;
    thread?: string;
  }
) {
  const context = await prepareSpaceFilesContext(
    input,
    "handing off selected work"
  );
  if (!context) {
    return;
  }
  if ((await stat(input.manifest)).size > 128 * 1024) {
    throw new Error("The handoff manifest is too large.");
  }
  const handoff = spaceWorkHandoffSchema.parse(
    JSON.parse(await readFile(input.manifest, "utf8"))
  );
  const result = await postSpaceWorkHandoff(context.spaceApi, {
    spaceId: input.space,
    requestContext: context.requestContext,
    spacePassword: input.password,
    handoff,
    targetProfileId: input.target,
    clientMessageId: input.clientMessageId,
    threadId: input.thread,
  });
  emitMutationOutput({
    presenter: context.presenter,
    json: input.json,
    code: "space.files.handoff",
    text: "Handoff posted. Check the message for the Agent's actual Wake status.",
    payload: result,
  });
}
