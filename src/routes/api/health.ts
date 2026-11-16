import { createFileRoute } from "@tanstack/react-router";
import { proxyApi } from "../../lib/api-proxy";

export const Route = createFileRoute("/api/health")({
  server: { handlers: { GET: ({ request }) => proxyApi(request, "/health") } },
});
