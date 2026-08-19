import { afterEach, describe, expect, it } from "vitest";
import { envFallback, resolveCredentials } from "./credentials";

const original = {
  POSTHOG_API_KEY: process.env.POSTHOG_API_KEY,
  POSTHOG_PROJECT_ID: process.env.POSTHOG_PROJECT_ID,
  POSTHOG_HOST: process.env.POSTHOG_HOST,
  MERCURY_API_KEY: process.env.MERCURY_API_KEY,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GITHUB_OWNER: process.env.GITHUB_OWNER,
  GITHUB_REPO: process.env.GITHUB_REPO,
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

  it("resolves a stored Mercury token over the deprecated env fallback", () => {
    process.env.MERCURY_API_KEY = "secret-token:env";
    expect(envFallback("mercury")).toEqual({ apiKey: "secret-token:env" });
    expect(resolveCredentials("mercury", { apiKey: "secret-token:stored" })).toEqual({
      apiKey: "secret-token:stored",
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

  it("falls back to GITHUB_* env when stored config is missing", () => {
    process.env.GITHUB_TOKEN = "ghp_env";
    process.env.GITHUB_OWNER = "fixture-org";
    process.env.GITHUB_REPO = "fixture-app";
    expect(envFallback("github")).toEqual({
      token: "ghp_env",
      owner: "fixture-org",
      repo: "fixture-app",
    });
    expect(
      resolveCredentials("github", { token: "ghp_stored", repo: "acme/app" })
    ).toEqual({
      token: "ghp_stored",
      owner: "fixture-org",
      repo: "acme/app",
    });
  });
});
