import Anykpi, { browserSnippet, identify, init, track } from "@anykpi/sdk";
import type { AnykpiConfig, EventProperties, User } from "@anykpi/sdk";

const config: AnykpiConfig = {
  endpoint: "http://localhost:3000",
  workspaceId: "live",
  apiKey: "consumer-key",
  debug: false,
};

const client: Anykpi = init(config);
const user: User = { userId: "consumer-user", properties: { name: "Consumer" } };
const properties: EventProperties = { source: "tsc" };

void identify(user);
void track("sdk_consumer_event", properties);
void client.track("sdk_consumer_event", properties);

const snippet: string = browserSnippet({
  endpoint: config.endpoint,
  workspaceId: config.workspaceId,
  apiKey: config.apiKey,
});

export const proof: string = snippet;
