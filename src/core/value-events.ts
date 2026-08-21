/**
 * Persist the value-event mapping. Client-safe matching lives in
 * vanity-events.ts so the /connect picker does not import the database.
 */

import { upsertConfig } from "./upsert";
import {
  VALUE_EVENTS_CONFIG_KEY,
  parseValueEventMapping,
  vanityWarningForMapping,
  type ValueEventMapping,
} from "./vanity-events";

export async function saveValueEvents(
  workspaceId: string,
  input: unknown
): Promise<{ mapping: ValueEventMapping; warning: string | null }> {
  const mapping = parseValueEventMapping(input);
  await upsertConfig({
    key: VALUE_EVENTS_CONFIG_KEY,
    value: JSON.stringify(mapping),
    workspaceId,
  });
  return {
    mapping,
    warning: vanityWarningForMapping(mapping),
  };
}
