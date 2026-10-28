import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
export function requestHandler({ rpcUrl, fetchRpc = fetch } = {}) {
  const root = resolve("web");
  const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
  };
  return async (req, res) => {
    try {
      const path = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname
      );
      if (path === "/rpc" && rpcUrl) {
        if (req.method !== "POST") {
          res.writeHead(405, { Allow: "POST" });
          return res.end("Use JSON-RPC POST");
        }
        // JSON-only requests prevent cross-origin simple-form submissions to
        // the local unlocked demo accounts; no cross-origin CORS is enabled.
        if (!req.headers["content-type"]?.startsWith("application/json")) {
          res.writeHead(415);
          return res.end("Expected application/json");
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 1024 * 1024) {
            res.writeHead(413);
            return res.end("RPC request too large");
          }
          chunks.push(chunk);
        }
        try {
          const upstream = await fetchRpc(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: Buffer.concat(chunks),
            signal: AbortSignal.timeout(15000),
          });
          const body = Buffer.from(await upstream.arrayBuffer());
          res.writeHead(upstream.status, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          });
          return res.end(body);
        } catch {
          res.writeHead(502, { "Content-Type": "application/json" });
          return res.end(
            JSON.stringify({ error: "Local blockchain unavailable" })
          );
        }
      }
      const file =
        path === "/ethers.js"
          ? resolve("node_modules/ethers/dist/ethers.min.js")
          : resolve(
              root,
              "." +
                (path === "/"
                  ? "/index.html"
                  : path === "/qr.js"
                  ? "/vendor/qrcode.js"
                  : path)
            );
      if (path !== "/ethers.js" && !file.startsWith(root + "/"))
        throw new Error("Invalid path");
      const data = await readFile(file);
      res.writeHead(200, {
        "Content-Type": types[extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  };
}
export function serve(
  port = Number(process.env.PORT || 4173),
  { rpcUrl } = {}
) {
  const server = http.createServer(requestHandler({ rpcUrl }));
  server.listen(port, process.env.HOST || "127.0.0.1", () =>
    console.log(`TicketMonster: http://127.0.0.1:${port}`)
  );
  return server;
}
if (process.argv[1]?.endsWith("/serve.mjs")) serve();
