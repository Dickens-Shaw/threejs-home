import { create } from "zustand";

export const useViewStore = create((set) => ({
  mode: "assembled",
  selectedId: null,
  hoveredId: null,
  hidden: {},
  partStats: {},
  layoutsReady: false,
  layoutMeta: { dark: null, light: null },
  frameToken: 0,

  setMode: (mode) =>
    set((state) => (state.mode === mode ? state : { mode })),

  setSelectedId: (selectedId) =>
    set({
      selectedId,
    }),

  setHoveredId: (hoveredId) =>
    set({
      hoveredId,
    }),

  toggleHidden: (id) =>
    set((state) => ({
      hidden: {
        ...state.hidden,
        [id]: !state.hidden[id],
      },
    })),

  setPartStat: (id, stat) =>
    set((state) => ({
      partStats: {
        ...state.partStats,
        [id]: stat,
      },
    })),

  setLayoutsReady: (layoutsReady) =>
    set({
      layoutsReady,
    }),

  setLayoutMeta: (theme, meta) =>
    set((state) => ({
      layoutMeta: {
        ...state.layoutMeta,
        [theme]: meta,
      },
    })),

  requestFrame: (id) =>
    set((state) => ({
      selectedId: id,
      frameToken: state.frameToken + 1,
    })),
}));
