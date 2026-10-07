import { createCloudComputerApi } from "@openmeld/api-client";
import { cloudComputerOperationSchema } from "@openmeld/schemas";
import { resolveBaseUrl } from "../config/base-url";
import { resolveRuntimeContext } from "../runtime/context";
import { createPresenter } from "../runtime/presenter/index";
import { createCliApiClientFoundation } from "../space/api-client-foundation";

export async function runCloudComputer(input: {
  operation?: string;
  view?: string;
}) {
  const runtime = await resolveRuntimeContext({ view: input.view });
  const presenter = createPresenter(runtime);
  const api = createCloudComputerApi(
    createCliApiClientFoundation(await resolveBaseUrl())
  );
  const response = input.operation
    ? await api.execute(
        cloudComputerOperationSchema.parse(JSON.parse(input.operation))
      )
    : await api.read();
  presenter.data({ code: "computer.cloud.completed", payload: response });
}
