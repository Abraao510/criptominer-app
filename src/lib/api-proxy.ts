const DEFAULT_API_URL = "http://178.95.25.53:3000";

export async function proxyApi(request: Request, path: string): Promise<Response> {
  const incomingUrl = new URL(request.url);
  const upstream = (process.env["API_URL"] ?? DEFAULT_API_URL).replace(/\/$/, "");
  const target = `${upstream}${path}${incomingUrl.search}`;
  const isBodyRequest = request.method !== "GET" && request.method !== "HEAD";

  try {
    const init: RequestInit = { method: request.method };
    if (isBodyRequest) {
      init.headers = { "content-type": "application/json" };
      init.body = await request.text();
    }
    const response = await fetch(target, init);

    const headers = new Headers(response.headers);
    headers.set("cache-control", response.headers.get("cache-control") ?? "no-cache");
    if (path === "/events") {
      headers.set("content-type", "text/event-stream");
      headers.set("connection", "keep-alive");
    }

    return new Response(response.body, { status: response.status, headers });
  } catch {
    return Response.json({ error: "Não foi possível alcançar a API." }, { status: 502 });
  }
}
