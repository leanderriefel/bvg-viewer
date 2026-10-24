import { createFileRoute } from "@tanstack/react-router";

import { respondWithTransitHistory } from "@/server/transit/history-http";
import { getTransitHistory } from "@/server/transit/service";

export const Route = createFileRoute("/api/transit-history")({
  server: {
    handlers: {
      GET: ({ request }) =>
        respondWithTransitHistory(getTransitHistory(), request),
    },
  },
});
