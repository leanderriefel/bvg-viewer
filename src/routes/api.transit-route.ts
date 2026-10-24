import { createFileRoute } from "@tanstack/react-router";

import { respondWithTripRoute } from "@/server/transit/trips";

export const Route = createFileRoute("/api/transit-route")({
  server: { handlers: { GET: ({ request }) => respondWithTripRoute(request) } },
});
