'use client';

import React, { useMemo } from 'react';
import type { Point2D } from '../../types';

interface RulerTick {
  value: number;
  pos: number;
}

interface RulerTickData {
  major: RulerTick[];
  minor: RulerTick[];
  majorStep: number;
}

export interface RulersProps {
  pageWidth: number;
  pageHeight: number;
  zoom: number;
  panOffset: Point2D;
  viewportWidth: number;
  viewportHeight: number;
  showRulers?: boolean;
  rulerSize?: number;
  originOffset?: Point2D;
}

const DEFAULT_RULER_BG = '#fff2d6';
const DEFAULT_RULER_BORDER = 'rgba(217, 177, 117, 0.9)';
const DEFAULT_RULER_TEXT = '#6b7280';
const DEFAULT_TICK_MAJOR = '#7f7f7f';
const DEFAULT_TICK_MINOR = '#b5b5b5';

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

const formatLabel = (valueMm: number, majorStepMm: number) => {
  const cm = valueMm / 10;
  if (majorStepMm >= 10) {
    const rounded = Math.round(cm);
    return rounded === 0 ? '0' : rounded.toString();
  }
  if (Math.abs(cm) < 0.0001) return '0';
  return cm.toFixed(1);
};

export const Rulers: React.FC<RulersProps> = ({
  pageWidth,
  pageHeight,
  zoom,
  panOffset,
  viewportWidth,
  viewportHeight,
  showRulers = true,
  rulerSize = 24,
  originOffset = { x: 0, y: 0 },
}) => {
  if (!showRulers || viewportWidth <= 0 || viewportHeight <= 0) return null;

  const leftRulerWidth = Math.round(rulerSize * 1.2);
  const scale = Math.max(zoom, 0.01);

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const snapPx = (value: number) => Math.round(value * dpr) / dpr;

  const getTicks = (axis: 'x' | 'y'): RulerTickData => {
    const viewport = axis === 'x' ? viewportWidth : viewportHeight;
    const pageSizePx = axis === 'x' ? pageWidth : pageHeight;
    const pan = axis === 'x' ? panOffset.x : panOffset.y;

    if (pageSizePx <= 0 || viewport <= 0) {
      return { major: [], minor: [], majorStep: 10 };
    }

    const majorStepMm = getMajorStepMm(scale);
    const minorStepMm = getMinorStepMm(scale, majorStepMm);
    const minorStepPx = minorStepMm * MM_TO_PX * scale;
    const showMinor = minorStepPx >= 1;

    const viewStartPx = Math.max(0, pan);
    const viewEndPx = Math.min(pageSizePx, pan + viewport / scale);
    const viewStartMm = viewStartPx * PX_TO_MM;
    const viewEndMm = viewEndPx * PX_TO_MM;

    if (viewEndMm <= viewStartMm) {
      return { major: [], minor: [], majorStep: majorStepMm };
    }

    const firstMajor = Math.floor(viewStartMm / majorStepMm) * majorStepMm;
    const lastMajor = Math.ceil(viewEndMm / majorStepMm) * majorStepMm;

    const major: RulerTick[] = [];
    const minor: RulerTick[] = [];

    const maxMajorTicks = 500;
    let count = 0;
    for (let value = firstMajor; value <= lastMajor && count < maxMajorTicks; value += majorStepMm, count++) {
      if (value < 0 || value > pageSizePx * PX_TO_MM) continue;
      const valuePx = value / PX_TO_MM;
      const pos = (valuePx - pan) * scale;
      major.push({ value, pos });

      if (showMinor && minorStepMm < majorStepMm) {
        const stepsPerMajor = Math.round(majorStepMm / minorStepMm);
        for (let i = 1; i < stepsPerMajor; i++) {
          const minorValue = value + i * minorStepMm;
          if (minorValue < viewStartMm || minorValue > viewEndMm) continue;
          if (minorValue < 0 || minorValue > pageSizePx * PX_TO_MM) continue;
          const minorValuePx = minorValue / PX_TO_MM;
          const minorPos = (minorValuePx - pan) * scale;
          minor.push({ value: minorValue, pos: minorPos });
        }
      }
    }

    return { major, minor, majorStep: majorStepMm };
  };

  const rulerData = useMemo(
    () => ({
      x: getTicks('x'),
      y: getTicks('y'),
    }),
    [pageWidth, pageHeight, viewportWidth, viewportHeight, panOffset.x, panOffset.y, scale]
  );

  const topRulerTop = originOffset.y - rulerSize;
  const topRulerLeft = originOffset.x;
  const leftRulerTop = originOffset.y;
  const leftRulerLeft = originOffset.x - leftRulerWidth;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
      {/* Corner */}
      <div
        style={{
          position: 'absolute',
          top: snapPx(topRulerTop),
          left: snapPx(leftRulerLeft),
          width: leftRulerWidth,
          height: rulerSize,
          backgroundColor: DEFAULT_RULER_BG,
          borderRight: `1px solid ${DEFAULT_RULER_BORDER}`,
          borderBottom: `1px solid ${DEFAULT_RULER_BORDER}`,
        }}
      />

      {/* Horizontal Ruler */}
      <div
        style={{
          position: 'absolute',
          top: snapPx(topRulerTop),
          left: snapPx(topRulerLeft),
          width: viewportWidth,
          height: rulerSize,
          backgroundColor: DEFAULT_RULER_BG,
          borderBottom: `1px solid ${DEFAULT_RULER_BORDER}`,
          borderRight: `1px solid ${DEFAULT_RULER_BORDER}`,
          overflow: 'hidden',
        }}
      >
        {rulerData.x.minor.map((tick) => {
          const midStep = rulerData.x.majorStep / 2;
          const isMid = midStep > 0 && Math.abs((tick.value % rulerData.x.majorStep) - midStep) < 0.001;
          return (
            <div
              key={`x-minor-${tick.value}-${tick.pos}`}
              style={{
                position: 'absolute',
                left: snapPx(tick.pos),
                bottom: 0,
                width: 1,
                height: isMid ? 9 : 6,
                backgroundColor: DEFAULT_TICK_MINOR,
              }}
            />
          );
        })}

        {rulerData.x.major.map((tick) => (
          <React.Fragment key={`x-major-${tick.value}-${tick.pos}`}>
            <div
              style={{
                position: 'absolute',
                left: snapPx(tick.pos),
                bottom: 0,
                width: 1,
                height: 12,
                backgroundColor: DEFAULT_TICK_MAJOR,
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: snapPx(tick.pos + 3),
                top: 2,
                fontSize: 9,
                color: DEFAULT_RULER_TEXT,
                whiteSpace: 'nowrap',
              }}
            >
              {formatLabel(tick.value, rulerData.x.majorStep)}
            </div>
          </React.Fragment>
        ))}
      </div>

      {/* Vertical Ruler */}
      <div
        style={{
          position: 'absolute',
          top: snapPx(leftRulerTop),
          left: snapPx(leftRulerLeft),
          height: viewportHeight,
          width: leftRulerWidth,
          backgroundColor: DEFAULT_RULER_BG,
          borderRight: `1px solid ${DEFAULT_RULER_BORDER}`,
          borderBottom: `1px solid ${DEFAULT_RULER_BORDER}`,
          overflow: 'hidden',
        }}
      >
        {rulerData.y.minor.map((tick) => {
          const midStep = rulerData.y.majorStep / 2;
          const isMid = midStep > 0 && Math.abs((tick.value % rulerData.y.majorStep) - midStep) < 0.001;
          return (
            <div
              key={`y-minor-${tick.value}-${tick.pos}`}
              style={{
                position: 'absolute',
                top: snapPx(tick.pos),
                right: 0,
                height: 1,
                width: isMid ? 9 : 6,
                backgroundColor: DEFAULT_TICK_MINOR,
              }}
            />
          );
        })}

        {rulerData.y.major.map((tick) => (
          <React.Fragment key={`y-major-${tick.value}-${tick.pos}`}>
            <div
              style={{
                position: 'absolute',
                top: snapPx(tick.pos),
                right: 0,
                height: 1,
                width: 12,
                backgroundColor: DEFAULT_TICK_MAJOR,
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: Math.max(2, snapPx(tick.pos) - 6),
                right: 14,
                fontSize: 9,
                color: DEFAULT_RULER_TEXT,
                lineHeight: 1,
                writingMode: 'horizontal-tb',
                textOrientation: 'upright',
                transform: 'translate(0, -50%)',
                whiteSpace: 'nowrap',
              }}
            >
              {formatLabel(tick.value, rulerData.y.majorStep)}
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

export default Rulers;
