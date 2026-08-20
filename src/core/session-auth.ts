/**
 * Read-path gate that accepts a signed browser session.
 *
 * Writes always fall through to the key-only `gate` in auth.ts so
 * destructive operations stay attributable to a presented key (ANY-38).
 */

import {
  authResponse,
  gate as keyGate,
  resolveWorkspace,
  type AuthorizeOptions,
  type RequestLike,
} from "./auth";
import { authFromSession, readBrowserSession } from "./session";

export async function gate(
  request: RequestLike,
  options: AuthorizeOptions = {}
): Promise<Awaited<ReturnType<typeof keyGate>>> {
  if (options.write !== true) {
    const session = readBrowserSession(request);
    if (session) {
      const auth = authFromSession(session, options.workspace ?? undefined);
      const resolved = resolveWorkspace(auth, options.workspace, false);
      if ("ok" in resolved && resolved.ok === false) {
        return { ok: false, response: authResponse(resolved) };
      }
      return {
        ok: true,
        auth,
        workspace: (resolved as { workspace: string }).workspace,
      };
    }
  }

  return keyGate(request, options);
}
