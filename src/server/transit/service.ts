import path from "node:path";

import { TransitCollector } from "./collector";
import { createTransitHistory } from "./history";
import type { TransitHistory } from "./history";
import { createTransitStorage } from "./storage";

// A persistent Node process owns the collector. Keep one process per egress IP:
// independent serverless instances do not share this upstream rate limit or disk.
const shared = globalThis as typeof globalThis & {
  berlinTransitCollector?: TransitCollector;
  berlinTransitHistory?: TransitHistory;
};

function transitDirectory(): string {
  return (
    process.env.TRANSIT_DATA_DIR ?? path.join(process.cwd(), ".data", "transit")
  );
}

export function getTransitHistory(): TransitHistory {
  shared.berlinTransitHistory ??= createTransitHistory(transitDirectory());
  return shared.berlinTransitHistory;
}

export function getTransitCollector(): TransitCollector {
  // Development reloads must retire the old scheduler rather than keep its class alive.
  const previous = shared.berlinTransitCollector;
  if (previous?.constructor === TransitCollector) {
    return previous;
  }
  previous?.stop();
  const collector = new TransitCollector({
    storage: createTransitStorage(transitDirectory()),
  });
  shared.berlinTransitCollector = collector;
  collector.start();
  return collector;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    shared.berlinTransitCollector?.stop();
    delete shared.berlinTransitCollector;
  });
}
