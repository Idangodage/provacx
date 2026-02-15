/**
 * Wall Module
 *
 * Exports all wall-related components, utilities, and types.
 */

export { WallManager } from './WallManager';
export type { WallQueryResult, EndpointQuery } from './WallManager';

export { WallRenderer } from './WallRenderer';
export type { WallRenderOptions } from './WallRenderer';

export { WallPreview } from './WallPreview';

export { RoomConfigPopup } from './RoomConfigPopup';
export type { RoomConfigPopupProps } from './RoomConfigPopup';

export * from './WallGeometry';
export {
  snapToGrid,
  snapToEndpoint,
  applyAngleLock,
  snapWallPoint,
  findWallIntersections,
  // Renamed export to avoid conflict with canvas/snapping.ts
  applyOrthogonalConstraint as applyWallOrthogonalConstraint,
} from './WallSnapping';
