import { createFileRoute } from "@tanstack/react-router";
import { proxyApi } from "../../lib/api-proxy";

export const Route = createFileRoute("/api/network")({
  server: { handlers: { POST: ({ request }) => proxyApi(request, "/network") } },
});
