'use client';

'use client';

import React, { useMemo } from 'react';
import type { Point2D } from '../../types';

interface GridProps {
  pageWidth: number;
  pageHeight: number;
  zoom: number;
  panOffset: Point2D;
  showGrid?: boolean;
  originOffset?: Point2D;
  minorLineColor?: string;
  majorLineColor?: string;
}

const DEFAULT_MINOR_COLOR = 'rgba(148, 163, 184, 0.25)';
const DEFAULT_MAJOR_COLOR = 'rgba(100, 116, 139, 0.4)';

const PX_PER_INCH = 96;
const MM_PER_INCH = 25.4;
const PX_TO_MM = MM_PER_INCH / PX_PER_INCH;
const MM_TO_PX = PX_PER_INCH / MM_PER_INCH;

const getMajorStepMm = (scale: number) => {
  if (scale < 1.25) return 20;
  if (scale < 2.5) return 10;
  if (scale < 4.5) return 5;
  return 1;
};

const getMinorStepMm = (scale: number, majorStepMm: number) => {
  const mmPx = MM_TO_PX * scale;
  const candidates = [1, 2, 5];
  for (const step of candidates) {
    if (majorStepMm % step !== 0) continue;
    if (step * mmPx >= 1.5) return step;
  }
  return majorStepMm;
};

export const Grid: React.FC<GridProps> = ({
  pageWidth,
  pageHeight,
  zoom,
  panOffset,
  showGrid = true,
  originOffset = { x: 0, y: 0 },
  minorLineColor = DEFAULT_MINOR_COLOR,
  majorLineColor = DEFAULT_MAJOR_COLOR,
}) => {
  if (!showGrid || pageWidth <= 0 || pageHeight <= 0) return null;

  const scale = Math.max(zoom, 0.01);
  const majorStepMm = getMajorStepMm(scale);
  const minorStepMm = getMinorStepMm(scale, majorStepMm);
  const pageWidthMm = pageWidth * PX_TO_MM;
  const pageHeightMm = pageHeight * PX_TO_MM;

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const snapPx = (value: number) => Math.round(value * dpr) / dpr;

  const gridLines = useMemo(() => {
    const majorX: number[] = [];
    const majorY: number[] = [];
    const minorX: number[] = [];
    const minorY: number[] = [];
    const maxLines = 6000;

    for (let value = 0; value <= pageWidthMm && majorX.length < maxLines; value += majorStepMm) {
      majorX.push(value);
    }
    for (let value = 0; value <= pageHeightMm && majorY.length < maxLines; value += majorStepMm) {
      majorY.push(value);
    }

    if (minorStepMm !== majorStepMm) {
      for (let value = 0; value <= pageWidthMm && minorX.length < maxLines; value += minorStepMm) {
        if (Math.abs(value % majorStepMm) < 0.0001) continue;
        minorX.push(value);
      }
      for (let value = 0; value <= pageHeightMm && minorY.length < maxLines; value += minorStepMm) {
        if (Math.abs(value % majorStepMm) < 0.0001) continue;
        minorY.push(value);
      }
    }

    return { majorX, majorY, minorX, minorY, majorStepMm };
  }, [pageWidthMm, pageHeightMm, majorStepMm, minorStepMm]);

  const pageLeft = originOffset.x + (-panOffset.x) * scale;
  const pageTop = originOffset.y + (-panOffset.y) * scale;
  const pageWidthPx = pageWidth * scale;
  const pageHeightPx = pageHeight * scale;

  return (
    <div
      style={{
        position: 'absolute',
        left: pageLeft,
        top: pageTop,
        width: pageWidthPx,
        height: pageHeightPx,
        pointerEvents: 'none',
        zIndex: 1,
        overflow: 'hidden',
      }}
    >
      {gridLines.minorX.map((value) => (
        <div
          key={`grid-minor-x-${value}`}
          style={{
            position: 'absolute',
            top: 0,
            left: snapPx((value / PX_TO_MM) * scale),
            width: 1,
            height: '100%',
            backgroundColor: minorLineColor,
          }}
        />
      ))}

      {gridLines.minorY.map((value) => (
        <div
          key={`grid-minor-y-${value}`}
          style={{
            position: 'absolute',
            left: 0,
            top: snapPx((value / PX_TO_MM) * scale),
            height: 1,
            width: '100%',
            backgroundColor: minorLineColor,
          }}
        />
      ))}

      {gridLines.majorX.map((value) => (
        <div
          key={`grid-major-x-${value}`}
          style={{
            position: 'absolute',
            top: 0,
            left: snapPx((value / PX_TO_MM) * scale),
            width: 1,
            height: '100%',
            backgroundColor: majorLineColor,
          }}
        />
      ))}

      {gridLines.majorY.map((value) => (
        <div
          key={`grid-major-y-${value}`}
          style={{
            position: 'absolute',
            left: 0,
            top: snapPx((value / PX_TO_MM) * scale),
            height: 1,
            width: '100%',
            backgroundColor: majorLineColor,
          }}
        />
      ))}
    </div>
  );
};

export default Grid;
