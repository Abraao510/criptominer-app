import { createFileRoute } from "@tanstack/react-router";
import { proxyApi } from "../../../lib/api-proxy";

export const Route = createFileRoute("/api/found/delete")({
  server: { handlers: { POST: ({ request }) => proxyApi(request, "/found/delete") } },
});
