import { createFileRoute } from "@tanstack/react-router";
import { proxyApi } from "../../lib/api-proxy";

export const Route = createFileRoute("/api/stop")({
  server: { handlers: { POST: ({ request }) => proxyApi(request, "/stop") } },
});
