import { createFileRoute } from "@tanstack/react-router";
import { proxyApi } from "../../lib/api-proxy";

export const Route = createFileRoute("/api/status")({
  server: { handlers: { GET: ({ request }) => proxyApi(request, "/status") } },
});
