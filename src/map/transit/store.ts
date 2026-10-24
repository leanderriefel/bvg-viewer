import { create } from "zustand";

import {
  advanceReplayTime,
  constrainReplayTime,
  historyEntryAt,
} from "@/map/transit/history";
import type { ReplaySpeed, TransitHistoryEntry } from "@/map/transit/history";
import { TRANSIT_PRODUCTS } from "@/map/transit/model";
import type { TransitProduct, TransitSnapshot } from "@/map/transit/model";
import type { TransitRoute } from "@/map/transit/route";

interface TransitState {
  snapshot: TransitSnapshot | null;
  liveSnapshot: TransitSnapshot | null;
  mode: "live" | "replay";
  clockTime: number;
  playing: boolean;
  speed: ReplaySpeed;
  history: TransitHistoryEntry[];
  historyStatus: "loading" | "ready" | "error";
  historyError: string | null;
  replayStatus: "idle" | "loading" | "ready" | "error";
  replayError: string | null;
  enabled: boolean;
  filters: Record<TransitProduct, boolean>;
  selectedId: string | null;
  followedId: string | null;
  selectedRoute: TransitRoute | null;
  routeStatus: "idle" | "loading" | "ready" | "error";
  error: string | null;
  status: "loading" | "live" | "error";
  setEnabled: (enabled: boolean) => void;
  toggleProduct: (product: TransitProduct) => void;
  selectVehicle: (selectedId: string | null) => void;
  followVehicle: (id: string | null) => void;
  stopFollowing: () => void;
  setSelectedRoute: (route: TransitRoute | null) => void;
  setRouteStatus: (status: TransitState["routeStatus"]) => void;
  receive: (snapshot: TransitSnapshot) => void;
  fail: (error: string) => void;
  receiveHistory: (history: TransitHistoryEntry[]) => void;
  failHistory: (error: string) => void;
  seekReplay: (time: number) => void;
  playReplay: () => void;
  pauseReplay: () => void;
  setReplaySpeed: (speed: ReplaySpeed) => void;
  backToLive: () => void;
  advanceClock: (now: number, elapsed: number) => void;
  receiveReplay: (snapshot: TransitSnapshot) => void;
  failReplay: (at: number, error: string) => void;
  retryReplay: () => void;
}

// Positions stay in memory: persisting them as preferences would revive stale
// vehicles on a later visit. The server owns the durable snapshot history.
export const useTransitStore = create<TransitState>()((set) => ({
  snapshot: null,
  liveSnapshot: null,
  mode: "live",
  clockTime: 0,
  playing: false,
  speed: 1,
  history: [],
  historyStatus: "loading",
  historyError: null,
  replayStatus: "idle",
  replayError: null,
  enabled: true,
  filters: Object.fromEntries(
    TRANSIT_PRODUCTS.map((product) => [product, true])
  ) as Record<TransitProduct, boolean>,
  selectedId: null,
  followedId: null,
  selectedRoute: null,
  routeStatus: "idle",
  error: null,
  status: "loading",
  setEnabled: (enabled) =>
    set((state) => ({
      enabled,
      followedId: enabled ? state.followedId : null,
      playing: enabled && state.playing,
    })),
  toggleProduct: (product) =>
    set((state) => {
      const followed = state.snapshot?.vehicles.find(
        (vehicle) => vehicle.id === state.followedId
      );
      return {
        filters: { ...state.filters, [product]: !state.filters[product] },
        followedId:
          followed?.product === product && state.filters[product]
            ? null
            : state.followedId,
      };
    }),
  selectVehicle: (selectedId) =>
    set((state) => ({
      selectedId,
      followedId: selectedId === state.followedId ? state.followedId : null,
    })),
  followVehicle: (followedId) =>
    set((state) => {
      const vehicle = state.snapshot?.vehicles.find(
        (candidate) => candidate.id === followedId
      );
      return {
        followedId,
        selectedId: followedId ?? state.selectedId,
        enabled: followedId ? true : state.enabled,
        filters: vehicle
          ? { ...state.filters, [vehicle.product]: true }
          : state.filters,
      };
    }),
  stopFollowing: () => set({ followedId: null }),
  setSelectedRoute: (selectedRoute) => set({ selectedRoute }),
  setRouteStatus: (routeStatus) => set({ routeStatus }),
  receive: (snapshot) =>
    set((state) => ({
      liveSnapshot: snapshot,
      snapshot: state.mode === "live" ? snapshot : state.snapshot,
      error: null,
      status: "live",
    })),
  fail: (error) => set({ error, status: "error" }),
  receiveHistory: (history) =>
    set((state) =>
      state.mode === "replay"
        ? state
        : {
            history,
            historyStatus: "ready",
            historyError: null,
          }
    ),
  failHistory: (historyError) => set({ historyStatus: "error", historyError }),
  seekReplay: (time) =>
    set((state) => {
      const at = constrainReplayTime(state.history, time);
      if (at === null) {
        return state;
      }
      const entry = historyEntryAt(state.history, at);
      const snapshot =
        state.mode === "replay" && state.snapshot?.updatedAt === entry?.at
          ? state.snapshot
          : null;
      return {
        mode: "replay",
        clockTime: at,
        playing: false,
        snapshot,
        replayStatus: snapshot ? "ready" : "loading",
        replayError: null,
        enabled: true,
        followedId: null,
        selectedRoute: null,
        routeStatus: "idle",
      };
    }),
  playReplay: () =>
    set((state) => {
      const [first] = state.history;
      const last = state.history.at(-1);
      if (!(first && last) || first.at === last.at) {
        return state;
      }
      const time =
        state.mode === "live" || state.clockTime >= last.at
          ? first.at
          : state.clockTime;
      const entry = historyEntryAt(state.history, time);
      const snapshot =
        state.mode === "replay" && state.snapshot?.updatedAt === entry?.at
          ? state.snapshot
          : null;
      return {
        mode: "replay",
        clockTime: time,
        playing: true,
        snapshot,
        replayStatus: snapshot ? "ready" : "loading",
        replayError: null,
        enabled: true,
        selectedRoute: state.mode === "live" ? null : state.selectedRoute,
        followedId: state.mode === "live" ? null : state.followedId,
      };
    }),
  pauseReplay: () => set({ playing: false }),
  setReplaySpeed: (speed) => set({ speed }),
  backToLive: () =>
    set((state) => ({
      mode: "live",
      clockTime: Date.now(),
      playing: false,
      snapshot: state.liveSnapshot,
      replayStatus: "idle",
      replayError: null,
      selectedId: null,
      followedId: null,
      selectedRoute: null,
      routeStatus: "idle",
    })),
  advanceClock: (now, elapsed) =>
    set((state) => {
      if (state.mode === "live") {
        return { clockTime: now };
      }
      if (!state.playing || state.replayStatus !== "ready") {
        return state;
      }
      const clockTime = advanceReplayTime(
        state.history,
        state.clockTime,
        elapsed * state.speed
      );
      const entry = historyEntryAt(state.history, clockTime);
      const snapshot =
        state.snapshot?.updatedAt === entry?.at ? state.snapshot : null;
      return {
        clockTime,
        snapshot,
        replayStatus: snapshot ? "ready" : "loading",
        playing: clockTime < (state.history.at(-1)?.at ?? clockTime),
      };
    }),
  receiveReplay: (snapshot) =>
    set((state) =>
      state.mode === "replay" &&
      historyEntryAt(state.history, state.clockTime)?.at === snapshot.updatedAt
        ? { snapshot, replayStatus: "ready", replayError: null }
        : state
    ),
  failReplay: (at, replayError) =>
    set((state) =>
      state.mode === "replay" &&
      historyEntryAt(state.history, state.clockTime)?.at === at
        ? { replayStatus: "error", replayError, playing: false }
        : state
    ),
  retryReplay: () => set({ replayStatus: "loading", replayError: null }),
}));
