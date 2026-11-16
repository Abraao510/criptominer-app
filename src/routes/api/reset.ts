import { createFileRoute } from "@tanstack/react-router";
import { proxyApi } from "../../lib/api-proxy";

export const Route = createFileRoute("/api/reset")({
  server: { handlers: { POST: ({ request }) => proxyApi(request, "/reset") } },
});
