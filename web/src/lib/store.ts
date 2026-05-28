import { create } from "zustand";
import type { Graph, Snapshot } from "@/types/graph";

export type View = "dashboard" | "graph" | "diff";

export type Filter = {
  showDriftOnly: boolean;
  showOrphansOnly: boolean;
  type: string | null;
  vpcId: string | null;
};

interface State {
  view: View;
  setView: (v: View) => void;

  snapshots: Snapshot[];
  setSnapshots: (s: Snapshot[]) => void;

  selectedSnapshotId: string | null;
  setSelectedSnapshotId: (id: string | null) => void;

  graph: Graph | null;
  setGraph: (g: Graph | null) => void;

  filter: Filter;
  setFilter: (patch: Partial<Filter>) => void;

  selectedArn: string | null;
  setSelectedArn: (arn: string | null) => void;

  diffPair: { base: string | null; head: string | null };
  setDiffPair: (patch: Partial<{ base: string | null; head: string | null }>) => void;

  region: string | null;
  setRegion: (r: string) => void;

  availableRegions: string[];
  setAvailableRegions: (r: string[]) => void;
}

export const useStore = create<State>((set) => ({
  view: "dashboard",
  setView: (v) => set({ view: v }),

  snapshots: [],
  setSnapshots: (s) => set({ snapshots: s }),

  selectedSnapshotId: null,
  setSelectedSnapshotId: (id) => set({ selectedSnapshotId: id }),

  graph: null,
  setGraph: (g) => set({ graph: g }),

  filter: { showDriftOnly: false, showOrphansOnly: false, type: null, vpcId: null },
  setFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),

  selectedArn: null,
  setSelectedArn: (arn) => set({ selectedArn: arn }),

  diffPair: { base: null, head: null },
  setDiffPair: (patch) => set((s) => ({ diffPair: { ...s.diffPair, ...patch } })),

  region: null,
  setRegion: (r) => set({ region: r }),

  availableRegions: [],
  setAvailableRegions: (r) => set({ availableRegions: r }),
}));
