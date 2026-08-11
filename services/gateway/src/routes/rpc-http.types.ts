export type CoreRpcWorker = Service<
  typeof import("../../../core/src/index").GatewayRpcEntrypoint
>;

export type RpcHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
