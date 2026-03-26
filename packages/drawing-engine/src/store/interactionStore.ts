import { create } from 'zustand';

import type { Point2D } from '../types';

export interface DrawingInteractionState {
  mousePosition: Point2D;
  setMousePosition: (mousePosition: Point2D) => void;
  resetMousePosition: () => void;
}

const ORIGIN: Point2D = { x: 0, y: 0 };

export const useDrawingInteractionStore = create<DrawingInteractionState>()((set) => ({
  mousePosition: ORIGIN,
  setMousePosition: (mousePosition) =>
    set((state) => (
      state.mousePosition.x === mousePosition.x && state.mousePosition.y === mousePosition.y
        ? state
        : { mousePosition }
    )),
  resetMousePosition: () =>
    set((state) => (
      state.mousePosition.x === 0 && state.mousePosition.y === 0
        ? state
        : { mousePosition: ORIGIN }
    )),
}));
