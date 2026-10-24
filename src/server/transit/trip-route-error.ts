export class TripRouteError extends Error {
  readonly status: number;
  readonly retryAfter: number | null;

  constructor(message: string, status = 503, retryAfter: number | null = null) {
    super(message);
    this.name = "TripRouteError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
