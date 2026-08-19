import type { EventProperties, UserProperties } from "./types";

export interface BrowserSnippetOptions {
  endpoint: string;
  workspaceId?: string;
  apiKey?: string;
  debug?: boolean;
  userId?: string;
  properties?: UserProperties;
  trackEvent?: { name: string; properties?: EventProperties };
}

export function browserSnippet(options: BrowserSnippetOptions): string {
  const endpoint = options.endpoint.replace(/\/+$/, "");
  const workspaceId = options.workspaceId ?? "live";
  const apiKey = options.apiKey ?? "YOUR_API_KEY";
  const debug = options.debug ?? true;
  const userId = options.userId ?? "USER_ID";
  const properties: UserProperties = options.properties ?? {
    name: "User Name",
    email: "user@example.com",
    platform: "WEB",
  };

  const trackCall = options.trackEvent
    ? `\n    anykpi.track(${JSON.stringify(options.trackEvent.name)}, ${JSON.stringify(
        options.trackEvent.properties ?? {}
      )});`
    : "";

  return `<script>
  !function(){
    var anykpi = window.anykpi = window.anykpi || [];
    function enqueue(method) {
      return function() {
        anykpi.push([method].concat([].slice.call(arguments)));
      };
    }
    anykpi.init = anykpi.init || enqueue("init");
    anykpi.identify = anykpi.identify || enqueue("identify");
    anykpi.track = anykpi.track || enqueue("track");
    anykpi.init({
      endpoint: ${JSON.stringify(endpoint)},
      workspaceId: ${JSON.stringify(workspaceId)},
      apiKey: ${JSON.stringify(apiKey)},
      debug: ${debug ? "true" : "false"}
    });
    anykpi.identify({
      userId: ${JSON.stringify(userId)},
      properties: ${JSON.stringify(properties)}
    });${trackCall}
  }();
</script>
<script src="${endpoint}/sdk.js" async></script>`;
}
