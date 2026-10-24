import path from "node:path";

import { TransitCollector } from "./collector";
import { createTransitStorage } from "./storage";

// A persistent Node process owns the collector. Keep one process per egress IP:
// independent serverless instances do not share this upstream rate limit or disk.
const shared = globalThis as typeof globalThis & {
  berlinTransitCollector?: TransitCollector;
};

export function getTransitCollector(): TransitCollector {
  if (!shared.berlinTransitCollector) {
    shared.berlinTransitCollector = new TransitCollector({
      storage: createTransitStorage(
        process.env.TRANSIT_DATA_DIR ??
          path.join(process.cwd(), ".data", "transit")
      ),
    });
    shared.berlinTransitCollector.start();
  }
  return shared.berlinTransitCollector;
}
