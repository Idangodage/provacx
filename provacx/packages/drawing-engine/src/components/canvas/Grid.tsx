'use client';

import React, { useMemo } from 'react';

import type { Point2D } from '../../types';

import { getAdaptiveSteps } from './scale';

export interface GridProps {
  pageWidth: number;
  pageHeight: number;
  zoom: number;
  panOffset: Point2D;
  gridSize?: number;
  showGrid?: boolean;
  originOffset?: Point2D;
  viewportWidth?: number;
  viewportHeight?: number;
  minorLineColor?: string;
  majorLineColor?: string;
}

const DEFAULT_MINOR_COLOR = 'rgba(148, 163, 184, 0.25)';
const DEFAULT_MAJOR_COLOR = 'rgba(100, 116, 139, 0.4)';

export const Grid: React.FC<GridProps> = ({
  pageWidth,
  pageHeight,
  zoom,
  panOffset,
  gridSize = 20,
  showGrid = true,
  originOffset = { x: 0, y: 0 },
  viewportWidth = 0,
  viewportHeight = 0,
  minorLineColor = DEFAULT_MINOR_COLOR,
  majorLineColor = DEFAULT_MAJOR_COLOR,
}) => {
  if (!showGrid || pageWidth <= 0 || pageHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return null;
  }

  const scale = Math.max(zoom, 0.01);
  const steps = useMemo(() => getAdaptiveSteps(scale, gridSize), [scale, gridSize]);

  const pageLeft = originOffset.x + (-panOffset.x) * scale;
  const pageTop = originOffset.y + (-panOffset.y) * scale;
  const pageWidthPx = pageWidth * scale;
  const pageHeightPx = pageHeight * scale;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const snapPx = (value: number) => Math.round(value * dpr) / dpr;
  const snappedLeft = snapPx(pageLeft);
  const snappedTop = snapPx(pageTop);
  const snappedWidth = Math.max(1, snapPx(pageLeft + pageWidthPx) - snappedLeft);
  const snappedHeight = Math.max(1, snapPx(pageTop + pageHeightPx) - snappedTop);

  const background = useMemo(() => {
    const layers: Array<{ image: string; size: string }> = [];

    if (steps.showMinor) {
      layers.push(
        {
          image: `linear-gradient(to right, ${minorLineColor} 1px, transparent 1px)`,
          size: `${steps.minorStepPx}px 100%`,
        },
        {
          image: `linear-gradient(to bottom, ${minorLineColor} 1px, transparent 1px)`,
          size: `100% ${steps.minorStepPx}px`,
        }
      );
    }

    layers.push(
      {
        image: `linear-gradient(to right, ${majorLineColor} 1px, transparent 1px)`,
        size: `${steps.majorStepPx}px 100%`,
      },
      {
        image: `linear-gradient(to bottom, ${majorLineColor} 1px, transparent 1px)`,
        size: `100% ${steps.majorStepPx}px`,
      }
    );

    return {
      image: layers.map((layer) => layer.image).join(', '),
      size: layers.map((layer) => layer.size).join(', '),
      repeat: layers.map(() => 'repeat').join(', '),
      position: layers.map(() => '0 0').join(', '),
    };
  }, [steps, minorLineColor, majorLineColor]);

  return (
    <div
      style={{
        position: 'absolute',
        left: snappedLeft,
        top: snappedTop,
        width: snappedWidth,
        height: snappedHeight,
        pointerEvents: 'none',
        zIndex: 1,
        overflow: 'hidden',
        backgroundImage: background.image,
        backgroundSize: background.size,
        backgroundRepeat: background.repeat,
        backgroundPosition: background.position,
      }}
    />
  );
};

export default Grid;
