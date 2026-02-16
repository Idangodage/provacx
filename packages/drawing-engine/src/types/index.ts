/**
 * Smart Drawing Types
 *
 * Core type definitions for the drawing system.
 */

import type { ReactNode } from 'react';

// Re-export wall types
export * from './wall';

// Re-export room types
export * from './room';

// Re-export editing types
export * from './editing';

// =============================================================================
// Geometry Types
// =============================================================================

export interface Point2D {
  x: number;
  y: number;
}

export type DisplayUnit = 'mm' | 'cm' | 'm' | 'ft-in';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface Transform2D {
  position: Point2D;
  rotation: number;
  scale: number;
}

// =============================================================================
// Spline Types (AutoCAD-like)
// =============================================================================

export type SplineType = 'catmullRom' | 'bezier' | 'bspline' | 'nurbs';
export type SplineMethod = 'catmull-rom' | 'bezier' | 'b-spline' | 'nurbs';
export type SplineFitMethod = 'fit-points' | 'control-vertices';
export type KnotParameterization = 'uniform' | 'chord' | 'centripetal' | 'custom';

export interface SplineSettings {
  type?: SplineType;
  method: SplineMethod;
  fitMethod: SplineFitMethod;
  tension: number;
  continuity: number;
  bias: number;
  closed: boolean;
  degree: number;
  fitTolerance: number;
  knotParameterization: KnotParameterization;
  weights?: number[];
  samplesPerSegment?: number;
  showControlPoints: boolean;
  showControlPolygon: boolean;
  showFitPoints: boolean;
  showTangentHandles: boolean;
}

export interface SplineControlPoint {
  position: Point2D;
  tangentIn?: Point2D;
  tangentOut?: Point2D;
  weight?: number;
  isCorner?: boolean;
}

// =============================================================================
// Drawing Elements
// =============================================================================

export type SketchType =
  | 'line'
  | 'construction-line'
  | 'polyline'
  | 'polygon'
  | 'rectangle'
  | 'circle'
  | 'ellipse'
  | 'arc'
  | 'spline'
  | 'revision-cloud'
  | 'freehand'
  | 'pencil';

export type DrawingTool =
  | 'select'
  | 'pan'
  | 'wall'
  | 'room'
  | 'dimension'
  | 'text'
  | 'eraser'
  | 'calibrate'
  | 'line'
  | 'construction-line'
  | 'polyline'
  | 'polygon'
  | 'rectangle'
  | 'circle'
  | 'ellipse'
  | 'arc'
  | 'spline'
  | 'revision-cloud'
  | 'pencil';

export interface Dimension2D {
  id: string;
  type: 'linear' | 'aligned' | 'angular' | 'radius' | 'diameter' | 'area';
  points: Point2D[];
  value: number;
  unit: 'mm' | 'cm' | 'm' | 'in' | 'ft';
  text?: string;
  textPosition: Point2D;
  visible: boolean;
}

export interface Annotation2D {
  id: string;
  type: 'text' | 'leader' | 'callout';
  position: Point2D;
  text: string;
  leaderPoints?: Point2D[];
  visible: boolean;
}

export interface Sketch2D {
  id: string;
  type: SketchType;
  points: Point2D[];
  closed?: boolean;
  radius?: number;
  rx?: number;
  ry?: number;
  strokeWidth?: number;
  splineSettings?: SplineSettings;
  controlPoints?: SplineControlPoint[];
  knotVector?: number[];
}

export interface Guide {
  id: string;
  type: 'horizontal' | 'vertical';
  offset: number;
}

// =============================================================================
// Symbol Types
// =============================================================================

export interface Symbol {
  id: string;
  name: string;
  category: string;
  icon: ReactNode;
  svgPath?: string;
  viewBox?: { width: number; height: number };
  defaultWidth: number;
  defaultHeight: number;
  tags: string[];
  favorite?: boolean;
}

export interface SymbolCategory {
  id: string;
  name: string;
  icon: ReactNode;
  symbols: symbol[];
}

export interface SymbolInstance2D {
  id: string;
  symbolId: string;
  position: Point2D;
  rotation: number;
  scale: number;
  flipped: boolean;
  properties: Record<string, unknown>;
}

// =============================================================================
// Import/Calibration Types
// =============================================================================

export type SourceType = 'pdf' | 'image' | 'dxf' | 'ifc' | 'sketch';

export interface CalibrationPoint {
  id: string;
  pixelPoint: Point2D;
  realWorldDistance?: number;
}

export interface ImportedDrawing {
  id: string;
  name: string;
  sourceType: SourceType;
  dataUrl: string;
  originalWidth: number;
  originalHeight: number;
  scale: number;
  rotation: number;
  opacity: number;
  locked: boolean;
  calibrationPoints?: CalibrationPoint[];
}

export interface DetectedElement {
  id: string;
  type: 'wall' | 'door' | 'window' | 'room' | 'text' | 'dimension';
  confidence: number;
  points: Point2D[];
  boundingBox: { x: number; y: number; width: number; height: number };
  metadata?: Record<string, unknown>;
  accepted: boolean;
}

// =============================================================================
// Layer Types
// =============================================================================

export interface DrawingLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  color?: string;
  elements: string[];
}

// =============================================================================
// Page Configuration
// =============================================================================

export interface PageConfig {
  width: number;
  height: number;
  orientation: 'portrait' | 'landscape';
}

export interface PageLayout {
  id: string;
  label: string;
  width: number;
  height: number;
  orientation: 'portrait' | 'landscape';
}

// =============================================================================
// History Types
// =============================================================================

import type { Wall } from './wall';
import type { Room } from './room';

export interface HistorySnapshot {
  detectedElements: DetectedElement[];
  dimensions: Dimension2D[];
  annotations: Annotation2D[];
  sketches: Sketch2D[];
  symbols: SymbolInstance2D[];
  walls: Wall[];
  rooms: Room[];
}

export interface HistoryEntry {
  id: string;
  timestamp: number;
  action: string;
  snapshot: HistorySnapshot;
}
