/**
 * Canvas Hooks
 *
 * Custom React hooks for canvas interactions and drawing operations.
 * Following industry best practices with tool/mode-specific hooks.
 */

// Keyboard handling
export { useCanvasKeyboard, type UseCanvasKeyboardOptions } from './useCanvasKeyboard';

// Tool mode hooks
export { useSelectMode, type UseSelectModeOptions } from './useSelectMode';

// Pan handling
export { useMiddlePan, type UseMiddlePanOptions, type MiddlePanState } from './useMiddlePan';

// Wall tool
export { useWallTool, type UseWallToolOptions, type UseWallToolResult } from './useWallTool';

// Room tool
export { useRoomTool, type UseRoomToolOptions, type UseRoomToolResult } from './useRoomTool';

// Dimension tool
export { useDimensionTool, type UseDimensionToolOptions } from './useDimensionTool';

// Symbol placement tool
export {
  useSymbolPlacementTool,
  type UseSymbolPlacementToolOptions,
  type UseSymbolPlacementToolResult,
  type PlacementState,
  type WallSnapInfo,
} from './useSymbolPlacementTool';

// Offset tool
export { useOffsetTool, type UseOffsetToolOptions, type UseOffsetToolResult } from './useOffsetTool';

// Trim tool
export { useTrimTool, type UseTrimToolOptions, type UseTrimToolResult } from './useTrimTool';

// Extend tool
export { useExtendTool, type UseExtendToolOptions, type UseExtendToolResult } from './useExtendTool';
