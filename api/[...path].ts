import type { IncomingMessage, ServerResponse } from "node:http";

const DEFAULT_API_URL = "http://178.95.25.53:3000";

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function pipeResponse(response: globalThis.Response, output: ServerResponse) {
  if (!response.body) {
    output.end();
    return;
  }

  const reader = response.body.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      output.write(Buffer.from(chunk.value));
    }
  } finally {
    reader.releaseLock();
    output.end();
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const protocol = req.headers["x-forwarded-proto"] ?? "https";
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `${protocol}://${host}`);
  const path = url.pathname.replace(/^\/api/, "");
  const upstream = (process.env["API_URL"] ?? DEFAULT_API_URL).replace(/\/$/, "");
  const target = `${upstream}${path}${url.search}`;
  const method = req.method ?? "GET";
  const isBodyRequest = method !== "GET" && method !== "HEAD";

  try {
    const response = await fetch(target, {
      method,
      headers: isBodyRequest ? { "content-type": "application/json" } : undefined,
      body: isBodyRequest ? await readBody(req) : undefined,
    });

    res.statusCode = response.status;
    res.setHeader(
      "content-type",
      response.headers.get("content-type") ?? "application/octet-stream",
    );
    res.setHeader("cache-control", response.headers.get("cache-control") ?? "no-cache");
    if (path === "/events") {
      res.setHeader("connection", "keep-alive");
      res.setHeader("x-accel-buffering", "no");
    }

    await pipeResponse(response, res);
  } catch {
    res.statusCode = 502;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Não foi possível alcançar a API." }));
  }
}
