import { createServer } from "./mcpServer.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

(async () => {
  const server = await createServer();

  // Choose transport by ENV var
  if (process.env.HTTP === "1") {
        const { SSEServerTransport } =
      await import("@modelcontextprotocol/sdk/server/sse.js");
    const http = await import("node:http");

    const httpServer = http.createServer((req, res) => {
      if (req.method === "GET") {
        const transport = new SSEServerTransport("/message", res);
        server.connect(transport);
      } else if (req.method === "POST") {
        // Handle POST requests for SSE transport
        res.writeHead(405, { "Content-Type": "text/plain" });
        res.end("Method not allowed");
      }
    });

    httpServer.listen(1111, () => {
      console.log("SSE MCP server running on :1111");
    });
  } else {
    await server.connect(new StdioServerTransport());
  }
})();