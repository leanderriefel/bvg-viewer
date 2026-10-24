import { createFileRoute } from "@tanstack/react-router";

import { respondWithTransit } from "@/server/transit/http";
import { getTransitCollector } from "@/server/transit/service";

export const Route = createFileRoute("/api/transit")({
  server: {
    handlers: {
      GET: ({ request }) =>
        respondWithTransit(getTransitCollector().getSnapshot(), request),
    },
  },
});
