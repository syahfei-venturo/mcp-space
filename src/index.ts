import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SpaceVenturoClient } from "./client.js";
import { buildRegistry } from "./registry.js";
import { SecureSandbox } from "./sandbox.js";

async function main() {
  const client = new SpaceVenturoClient();
  const registry = buildRegistry(client);

  const server = new McpServer({
    name: "mcp-space",
    version: "1.0.0",
  });

  // ── Tool 1: search ────────────────────────────────────────────────────────
  //
  // Searches the function registry by keyword.
  // Returns matching function names, descriptions, and parameter schemas.
  // Use this first to discover what functions are available.

  server.tool(
    "search",
    "Search available Space Venturo APIs (sprint issues, tasks, etc) by keyword. Call this first to discover functionality.",
    {
      query: z.string().describe("Keyword to search (e.g. 'issue', 'task', 'sprint')"),
      limit: z.number().int().min(1).max(20).optional().describe("Max results to return (default: 10)"),
    },
    async ({ query, limit = 10 }) => {
      const keywords = query.toLowerCase().trim().split(/\s+/);
      const results = registry
        .filter((f) => {
          const searchableText = `${f.name} ${f.description} ${Object.keys(f.params).join(" ")}`.toLowerCase();
          // Match if ALL keywords are found anywhere in the searchable text
          return keywords.every(kw => searchableText.includes(kw));
        })
        .slice(0, limit)
        .map((f) => ({
          name: f.name,
          description: f.description,
          destructive: f.destructive ?? false,
          params: Object.fromEntries(
            Object.entries(f.params).map(([k, v]) => [
              k,
              {
                type: v.type,
                description: v.description,
                required: v.required,
                ...(v.enum ? { enum: v.enum } : {}),
              },
            ])
          ),
        }));

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No functions matched "${query}". Try broader terms like: issue, sprint, task, update, delete.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    }
  );

  // ── Tool 2: execute ───────────────────────────────────────────────────────
  //
  // Executes arbitrary JavaScript code with all registry functions injected
  // as async functions in scope. Supports multi-step operations in one call.

  server.tool(
    "execute",
    `Execute JavaScript code with all Space Venturo API functions available as async functions in scope.
Use \`search\` first to discover function names and their parameter schemas.
All registry functions can be called directly: e.g. \`await get_sprint_issues()\`, \`await create_issue({...})\`.
Destructive functions still require \`confirm: true\` in their params.
Use \`return\` to return a value — the result will be serialized as JSON.`,
    {
      code: z.string().describe(
        "JavaScript code to execute. All registry functions are available as async functions. Use `return` to return a value."
      ),
    },
    async ({ code }) => {
      try {
        const sandbox = new SecureSandbox(client, registry);
        const result = await sandbox.execute(code);

        return {
          content: [
            {
              type: "text",
              text: result === null || result === undefined
                ? "Success (no content returned)."
                : JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${msg}` }],
        };
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`MCP Space Venturo v1.0.0 running on stdio (2 tools: search + execute, ${registry.length} functions registered)`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
