import { afterEach, describe, expect, it } from "vitest";
import { envFallback, resolveCredentials } from "./credentials";

const original = {
  POSTHOG_API_KEY: process.env.POSTHOG_API_KEY,
  POSTHOG_PROJECT_ID: process.env.POSTHOG_PROJECT_ID,
  POSTHOG_HOST: process.env.POSTHOG_HOST,
};

afterEach(() => {
  for (const [name, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("connector credential resolution", () => {
  it("uses env as a deprecated fallback when stored config is missing", () => {
    process.env.POSTHOG_API_KEY = "phx_env";
    process.env.POSTHOG_PROJECT_ID = "proj_env";
    expect(envFallback("posthog")).toEqual({
      apiKey: "phx_env",
      projectId: "proj_env",
    });
    expect(resolveCredentials("posthog")).toEqual({
      apiKey: "phx_env",
      projectId: "proj_env",
    });
  });

  it("lets stored config win over env so rotation takes effect", () => {
    process.env.POSTHOG_API_KEY = "phx_env";
    process.env.POSTHOG_PROJECT_ID = "proj_env";
    expect(
      resolveCredentials("posthog", {
        apiKey: "phx_stored",
        projectId: "proj_stored",
      })
    ).toEqual({
      apiKey: "phx_stored",
      projectId: "proj_stored",
    });
  });
});
