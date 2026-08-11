import app from "../../src/index";

// biome-ignore lint/performance/noBarrelFile: This Worker entrypoint must export the Durable Object class for local smoke tests.
export { Space } from "../../../core/src/space/transport/do/space";

export default {
  fetch(request: Request, env: CloudflareBindings, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
};
