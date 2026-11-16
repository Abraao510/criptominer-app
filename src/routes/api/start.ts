import { createFileRoute } from "@tanstack/react-router";
import { proxyApi } from "../../lib/api-proxy";

export const Route = createFileRoute("/api/start")({
  server: { handlers: { POST: ({ request }) => proxyApi(request, "/start") } },
});
