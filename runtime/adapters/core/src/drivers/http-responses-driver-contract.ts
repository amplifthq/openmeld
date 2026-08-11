import type {
  HttpResponsesDriverRequest,
  HttpResponsesDriverResult,
} from "./driver-types.js";

export type HttpResponsesDriver = {
  execute(
    request: HttpResponsesDriverRequest
  ): Promise<HttpResponsesDriverResult>;
};

export class HttpResponsesDriverNotImplementedError extends Error {
  readonly code = "driver.http.not_implemented";

  constructor(
    message = "driver.http.not_implemented: no http responses driver implementation is configured"
  ) {
    super(message);
    this.name = "HttpResponsesDriverNotImplementedError";
  }
}

export function createNotImplementedHttpResponsesDriver(): HttpResponsesDriver {
  return {
    execute(): Promise<HttpResponsesDriverResult> {
      return Promise.reject(new HttpResponsesDriverNotImplementedError());
    },
  };
}
