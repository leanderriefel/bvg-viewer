import type { TransitHistory } from "./history";

export async function respondWithTransitHistory(
  history: TransitHistory,
  request: Request
): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  const query = new URL(request.url).searchParams;
  const requestedAt = query.get("at");
  try {
    if (requestedAt === null) {
      return Response.json(await history.list(), { headers });
    }
    if (
      !/^\d{1,16}$/u.test(requestedAt) ||
      !Number.isSafeInteger(Number(requestedAt))
    ) {
      return Response.json(
        { error: "Invalid saved timestamp." },
        { status: 400, headers }
      );
    }
    const snapshot = await history.load(Number(requestedAt));
    return snapshot
      ? Response.json(snapshot, { headers })
      : Response.json(
          { error: "This saved snapshot is no longer available." },
          { status: 404, headers }
        );
  } catch {
    return Response.json(
      { error: "Saved transport history is unavailable." },
      { status: 503, headers }
    );
  }
}
