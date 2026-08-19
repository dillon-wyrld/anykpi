import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as getOpenApi } from "@/app/api/openapi/route";
import { POST as postMcp } from "@/app/api/mcp/route";
import { GET as getLlms } from "@/app/llms.txt/route";

const root = resolve(__dirname, "../..");

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** OpenAPI paths named in prose, e.g. GET /api/v1/overview */
function namedRoutes(text: string): string[] {
  const matches = text.match(/\/api\/v1\/[A-Za-z0-9_/{}.-]+/g) ?? [];
  return unique(matches.map((path) => path.replace(/[.,;:]+$/, "")));
}

/**
 * MCP tool ids: backtick-quoted snake_case in the MCP section only,
 * so field names like view_url elsewhere are not treated as tools.
 */
function sectionBody(text: string, heading: string): string {
  const start = text.indexOf(`## ${heading}`);
  expect(start, `expected a ## ${heading} section`).toBeGreaterThan(-1);
  const fromHeading = text.slice(start);
  const next = fromHeading.slice(`## ${heading}`.length).search(/\n## /);
  return next === -1
    ? fromHeading
    : fromHeading.slice(0, `## ${heading}`.length + next);
}

function namedTools(text: string): string[] {
  const section = sectionBody(text, "MCP");
  const matches = [...section.matchAll(/`([a-z]+_[a-z0-9_]+)`/g)];
  return unique(matches.map((m) => m[1]));
}

function toolNamesFromSource(src: string): string[] {
  return unique(
    [...src.matchAll(/name:\s*"([a-z]+_[a-z0-9_]+)"/g)].map((m) => m[1])
  );
}

async function openApiPaths(): Promise<Set<string>> {
  const response = await getOpenApi(
    new NextRequest("http://localhost:3000/api/openapi")
  );
  const spec = (await response.json()) as { paths?: Record<string, unknown> };
  return new Set(Object.keys(spec.paths ?? {}));
}

async function mcpToolNames(): Promise<Set<string>> {
  const listed = await postMcp(
    new NextRequest("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    })
  );
  const body = (await listed.json()) as {
    result?: { tools?: { name?: string }[] };
  };
  const httpNames = (body.result?.tools ?? [])
    .map((tool) => tool.name)
    .filter((name): name is string => Boolean(name));

  const stdioSrc = readFileSync(resolve(root, "src/mcp/server.ts"), "utf8");
  const httpSrc = readFileSync(resolve(root, "src/app/api/mcp/route.ts"), "utf8");

  return new Set([
    ...httpNames,
    ...toolNamesFromSource(stdioSrc),
    ...toolNamesFromSource(httpSrc),
  ]);
}

async function llmsTxt(): Promise<string> {
  const response = await getLlms();
  expect(response.status).toBe(200);
  return response.text();
}

describe("GET /llms.txt", () => {
  it("returns concise text/plain instructions", async () => {
    const response = await getLlms();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/plain/);
    const body = await response.text();
    expect(body.length).toBeGreaterThan(400);
    expect(body.length).toBeLessThan(8000);
    expect(body).toContain("ANYKPI");
    expect(body).toMatch(/public-read/i);
    expect(body).toMatch(/view_url/);
    expect(body).toMatch(/no unauthenticated first-key endpoint/i);
    expect(body).toMatch(/ANYKPI_API_KEY/);
  });
});

describe("llms.txt does not drift from OpenAPI or MCP tools", () => {
  it("every named route exists in the OpenAPI spec and every named tool exists in the MCP tools list", async () => {
    const paths = await openApiPaths();
    const tools = await mcpToolNames();

    expect(paths.size).toBeGreaterThan(0);
    expect(tools.size).toBeGreaterThan(0);

    const text = await llmsTxt();
    const routes = namedRoutes(text);
    const mcpTools = namedTools(text);

    expect(routes.length).toBeGreaterThan(0);
    expect(mcpTools.length).toBeGreaterThan(0);

    for (const route of routes) {
      expect(paths, `llms.txt names ${route} which is not in OpenAPI`).toContain(
        route
      );
    }

    for (const tool of mcpTools) {
      expect(
        tools,
        `llms.txt names ${tool} which is not in the MCP tools list`
      ).toContain(tool);
    }
  });

  it("AGENTS.md names only routes and tools that exist", async () => {
    const agents = readFileSync(resolve(root, "AGENTS.md"), "utf8");
    const paths = await openApiPaths();
    const tools = await mcpToolNames();

    for (const route of namedRoutes(agents)) {
      expect(paths, `AGENTS.md names ${route} which is not in OpenAPI`).toContain(
        route
      );
    }

    for (const tool of namedTools(agents)) {
      expect(
        tools,
        `AGENTS.md names ${tool} which is not in the MCP tools list`
      ).toContain(tool);
    }

    expect(agents).toMatch(/no unauthenticated first-key endpoint/i);
    expect(agents).toContain("/llms.txt");
  });
});
