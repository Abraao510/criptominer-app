import { createFileRoute } from "@tanstack/react-router";
import { proxyApi } from "../../lib/api-proxy";

export const Route = createFileRoute("/api/network")({
  server: {
    handlers: {
      GET: ({ request }) => proxyApi(request, "/network"),
      POST: ({ request }) => proxyApi(request, "/network"),
    },
  },
});
