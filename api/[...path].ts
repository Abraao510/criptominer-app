const DEFAULT_API_URL = "http://178.95.25.53:3000";

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "");
  const upstream = (process.env.API_URL ?? DEFAULT_API_URL).replace(/\/$/, "");
  const target = `${upstream}${path}${url.search}`;

  const isBodyRequest = req.method !== "GET" && req.method !== "HEAD";

  try {
    const response = await fetch(target, {
      method: req.method,
      headers: isBodyRequest ? { "content-type": "application/json" } : undefined,
      body: isBodyRequest ? await req.text() : undefined,
    });

    const headers: Record<string, string> = {
      "content-type": response.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": response.headers.get("cache-control") ?? "no-cache",
    };

    return new Response(response.body, { status: response.status, headers });
  } catch {
    return new Response(JSON.stringify({ error: "Não foi possível alcançar a API." }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
}
