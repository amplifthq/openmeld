import { WorkspaceProxy as CloudflareWorkspaceProxy } from "@cloudflare/computer";

export const COMPUTER_PLUGIN_PATH = /^\/connections\/([a-f0-9]{64})(\/.*)?$/u;

export const COMPUTER_GIT_PATH =
  /^\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9][A-Za-z0-9_.-]{0,99})\/([A-Za-z0-9][A-Za-z0-9_.-]{0,99})\.git\/(info\/refs|git-upload-pack)$/u;

/** Keep upstream filesystem/RPC handling. Add only the native Git stream
 * routed by the SDK's container-local HTTP interception to its owning DO. */
export class WorkspaceProxy extends CloudflareWorkspaceProxy {
  override async fetch(request: Request): Promise<Response> {
    if (
      COMPUTER_GIT_PATH.test(new URL(request.url).pathname) ||
      COMPUTER_PLUGIN_PATH.test(new URL(request.url).pathname)
    ) {
      const namespace = (this.env as Record<string, DurableObjectNamespace>)[
        this.ctx.props.binding
      ];
      if (!namespace) {
        return new Response("Computer binding is unavailable.", {
          status: 503,
        });
      }
      return await namespace
        .get(namespace.idFromString(this.ctx.props.id))
        .fetch(request);
    }
    return await super.fetch(request);
  }
}
