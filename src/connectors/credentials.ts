/**
 * Resolve connector credentials from stored config, with env as a
 * deprecated read-only fallback when stored config is missing a field.
 *
 * Stored config (from /connect or `anykpi connect`) wins per field.
 * Do not log the returned object.
 */

import type { SourceConfig } from "@/core/sources";

function pickDefined(values: Record<string, string | undefined>): SourceConfig {
  const out: SourceConfig = {};
  for (const [key, value] of Object.entries(values)) {
    if (value && value.length > 0) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * @deprecated Env vars are a read-only fallback. Store config via /connect
 * or `anykpi connect`.
 */
export function envFallback(source: string): SourceConfig {
  switch (source) {
    case "posthog":
      return pickDefined({
        apiKey: process.env.POSTHOG_API_KEY,
        projectId: process.env.POSTHOG_PROJECT_ID,
        host: process.env.POSTHOG_HOST,
      });
    case "mixpanel":
      return pickDefined({
        projectId: process.env.MIXPANEL_PROJECT_ID,
        apiSecret: process.env.MIXPANEL_API_SECRET,
      });
    case "amplitude":
      return pickDefined({
        apiKey: process.env.AMPLITUDE_API_KEY,
        secretKey: process.env.AMPLITUDE_SECRET_KEY,
      });
    case "stripe":
      return pickDefined({
        apiKey: process.env.STRIPE_API_KEY,
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
      });
    case "revenuecat":
      return pickDefined({
        apiKey: process.env.REVENUECAT_API_KEY,
        projectId: process.env.REVENUECAT_PROJECT_ID,
      });
    case "mercury":
      return pickDefined({
        apiKey: process.env.MERCURY_API_KEY,
      });
    case "github":
      return pickDefined({
        token: process.env.GITHUB_TOKEN,
        owner: process.env.GITHUB_OWNER,
        repo: process.env.GITHUB_REPO,
      });
    default:
      return {};
  }
}

export function resolveCredentials(
  source: string,
  config?: SourceConfig
): SourceConfig {
  return { ...envFallback(source), ...config };
}
