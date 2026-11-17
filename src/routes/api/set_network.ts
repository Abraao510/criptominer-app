import { createFileRoute } from "@tanstack/react-router";
import { proxyApi } from "../../lib/api-proxy";

export const Route = createFileRoute("/api/set_network")({
  server: { handlers: { POST: ({ request }) => proxyApi(request, "/set_network") } },
});
