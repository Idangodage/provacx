'use client';

import React, { useMemo } from 'react';

import type { DisplayUnit, Point2D } from '../../types';

import { getAdaptiveSteps, PX_TO_MM } from './scale';

interface RulerTick {
  valueMm: number;
  pos: number;
}

interface RulerTickData {
  major: RulerTick[];
  minor: RulerTick[];
  majorStepMm: number;
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
  gridSize?: number;
  displayUnit?: DisplayUnit;
  /** Mouse position in canvas coordinates for cursor indicator */
  mousePosition?: Point2D;
}

const DEFAULT_RULER_BG = '#fff2d6';
const DEFAULT_RULER_BORDER = 'rgba(217, 177, 117, 0.9)';
const DEFAULT_RULER_TEXT = '#6b7280';
const DEFAULT_TICK_MAJOR = '#7f7f7f';
const DEFAULT_TICK_MINOR = '#b5b5b5';
const CURSOR_INDICATOR_COLOR = '#4CAF50';
const PAGE_EXTENT_FILL = 'rgba(76, 175, 80, 0.12)';
const PAGE_EDGE_COLOR = 'rgba(76, 175, 80, 0.7)';
const MIN_VISIBLE_RULER_PX = 72;
const PAGE_ATTACH_OVERLAP_PX = 1;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const positiveModulo = (value: number, mod: number) => (mod > 0 ? ((value % mod) + mod) % mod : 0);

function clampKeepVisible(
  start: number,
  size: number,
  minBound: number,
  maxBound: number,
  minVisiblePx = MIN_VISIBLE_RULER_PX
): number {
  if (!Number.isFinite(start) || !Number.isFinite(size) || size <= 0) return minBound;
  const span = Math.max(1, maxBound - minBound);
  const visible = clamp(Math.min(size, minVisiblePx), 1, span);
  const minStart = minBound - (size - visible);
  const maxStart = maxBound - visible;
  return clamp(start, minStart, maxStart);
}

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
  gridSize = 20,
  displayUnit = 'cm',
  mousePosition,
}) => {
  if (!showRulers || viewportWidth <= 0 || viewportHeight <= 0) return null;

  const leftRulerWidth = Math.round(rulerSize * 1.2);
  const scale = Math.max(zoom, 0.01);
  const steps = useMemo(() => getAdaptiveSteps(scale, gridSize), [scale, gridSize]);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const snapPx = (value: number) => Math.round(value * dpr) / dpr;

  const canvasLeft = originOffset.x;
  const canvasTop = originOffset.y;
  const canvasRight = canvasLeft + viewportWidth;
  const canvasBottom = canvasTop + viewportHeight;

  const pageLeft = canvasLeft + (-panOffset.x) * scale;
  const pageTop = canvasTop + (-panOffset.y) * scale;
  const pageWidthPx = Math.max(1, pageWidth * scale);
  const pageHeightPx = Math.max(1, pageHeight * scale);

  // Page-attached by default, clamped only when leaving viewport to keep always visible.
  const topRulerLeft = clampKeepVisible(pageLeft, pageWidthPx, canvasLeft, canvasRight);
  const topRulerTop = clamp(
    pageTop - rulerSize + PAGE_ATTACH_OVERLAP_PX,
    0,
    Math.max(0, canvasBottom - rulerSize)
  );
  const leftRulerTop = clampKeepVisible(pageTop, pageHeightPx, canvasTop, canvasBottom);
  const leftRulerLeft = clamp(
    pageLeft - leftRulerWidth + PAGE_ATTACH_OVERLAP_PX,
    0,
    Math.max(0, canvasRight - leftRulerWidth)
  );

  const horizontalRulerWidth = pageWidthPx;
  const verticalRulerHeight = pageHeightPx;

  // Compensate tick coordinate mapping when rulers are clamped.
  const sceneOffsetX = (topRulerLeft - pageLeft) / scale;
  const sceneOffsetY = (leftRulerTop - pageTop) / scale;

  const getTicks = (axis: 'x' | 'y'): RulerTickData => {
    const pageSizeScenePx = axis === 'x' ? pageWidth : pageHeight;
    const sceneOffset = axis === 'x' ? sceneOffsetX : sceneOffsetY;
    const rulerSpanPx = axis === 'x' ? horizontalRulerWidth : verticalRulerHeight;
    if (pageSizeScenePx <= 0 || rulerSpanPx <= 0) {
      return {
        major: [],
        minor: [],
        majorStepMm: steps.majorStepMm,
      };
    }

    const majorStepScenePx = steps.majorStepScenePx;
    const minorStepScenePx = steps.minorStepScenePx;
    if (majorStepScenePx <= 0 || minorStepScenePx <= 0) {
      return {
        major: [],
        minor: [],
        majorStepMm: steps.majorStepMm,
      };
    }

    const major: RulerTick[] = [];
    const minor: RulerTick[] = [];

    const spanScene = rulerSpanPx / scale;
    const visibleStartScenePx = clamp(sceneOffset, 0, pageSizeScenePx);
    const visibleEndScenePx = clamp(sceneOffset + spanScene, 0, pageSizeScenePx);
    if (visibleEndScenePx <= visibleStartScenePx) {
      return {
        major: [],
        minor: [],
        majorStepMm: steps.majorStepMm,
      };
    }

    const firstMajor = Math.floor(visibleStartScenePx / majorStepScenePx) * majorStepScenePx;
    const lastMajor = Math.ceil(visibleEndScenePx / majorStepScenePx) * majorStepScenePx;

    const maxMajorTicks = 500;
    let count = 0;
    for (
      let valueScenePx = firstMajor;
      valueScenePx <= lastMajor && count < maxMajorTicks;
      valueScenePx += majorStepScenePx, count++
    ) {
      if (valueScenePx < 0 || valueScenePx > pageSizeScenePx + 0.001) continue;
      const majorPos = (valueScenePx - sceneOffset) * scale;
      if (majorPos < -1 || majorPos > rulerSpanPx + 1) continue;

      major.push({
        valueMm: valueScenePx * PX_TO_MM,
        pos: majorPos,
      });

      if (steps.showMinor && minorStepScenePx < majorStepScenePx) {
        const stepsPerMajor = Math.max(1, Math.round(majorStepScenePx / minorStepScenePx));
        for (let i = 1; i < stepsPerMajor; i++) {
          const minorValueScenePx = valueScenePx + i * minorStepScenePx;
          if (
            minorValueScenePx < visibleStartScenePx ||
            minorValueScenePx > visibleEndScenePx ||
            minorValueScenePx < 0 ||
            minorValueScenePx > pageSizeScenePx + 0.001
          ) {
            continue;
          }

          const minorPos = (minorValueScenePx - sceneOffset) * scale;
          if (minorPos < -1 || minorPos > rulerSpanPx + 1) continue;

          minor.push({
            valueMm: minorValueScenePx * PX_TO_MM,
            pos: minorPos,
          });
        }
      }
    }

    return {
      major,
      minor,
      majorStepMm: steps.majorStepMm,
    };
  };

  const rulerData = useMemo(
    () => ({
      x: getTicks('x'),
      y: getTicks('y'),
    }),
    [
      pageWidth,
      pageHeight,
      scale,
      steps,
      sceneOffsetX,
      sceneOffsetY,
      horizontalRulerWidth,
      verticalRulerHeight,
    ]
  );

  const pageStartX = (-sceneOffsetX) * scale;
  const pageEndX = (pageWidth - sceneOffsetX) * scale;
  const pageStartY = (-sceneOffsetY) * scale;
  const pageEndY = (pageHeight - sceneOffsetY) * scale;
  const visiblePageXStart = clamp(pageStartX, 0, horizontalRulerWidth);
  const visiblePageXEnd = clamp(pageEndX, 0, horizontalRulerWidth);
  const visiblePageYStart = clamp(pageStartY, 0, verticalRulerHeight);
  const visiblePageYEnd = clamp(pageEndY, 0, verticalRulerHeight);

  const cursorX = mousePosition ? (mousePosition.x - sceneOffsetX) * scale : null;
  const cursorY = mousePosition ? (mousePosition.y - sceneOffsetY) * scale : null;
  const unitLabel = displayUnit === 'ft-in' ? 'ft' : displayUnit;

  const formatTickLabel = (valueMm: number, majorStepMm: number): string => {
    switch (displayUnit) {
      case 'mm':
        return Math.round(valueMm).toString();
      case 'm': {
        const valueM = valueMm / 1000;
        const precision = majorStepMm >= 1000 ? 1 : 2;
        return valueM.toFixed(precision).replace(/\.0+$/, '');
      }
      case 'ft-in': {
        const valueFt = valueMm / 304.8;
        const precision = majorStepMm >= 304.8 ? 1 : 2;
        return valueFt.toFixed(precision).replace(/\.0+$/, '');
      }
      default: {
        const cm = valueMm / 10;
        if (majorStepMm >= 10) {
          const rounded = Math.round(cm);
          return rounded === 0 ? '0' : rounded.toString();
        }
        if (Math.abs(cm) < 0.0001) return '0';
        return cm.toFixed(1).replace(/\.0$/, '');
      }
    }
  };

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
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
      >
        <span
          style={{
            position: 'absolute',
            right: 4,
            bottom: 3,
            fontSize: 9,
            color: DEFAULT_RULER_TEXT,
            letterSpacing: 0.3,
            textTransform: 'uppercase',
          }}
        >
          {unitLabel}
        </span>
      </div>

      <div
        style={{
          position: 'absolute',
          top: snapPx(topRulerTop),
          left: snapPx(topRulerLeft),
          width: horizontalRulerWidth,
          height: rulerSize,
          backgroundColor: DEFAULT_RULER_BG,
          borderBottom: `1px solid ${DEFAULT_RULER_BORDER}`,
          borderRight: `1px solid ${DEFAULT_RULER_BORDER}`,
          overflow: 'hidden',
        }}
      >
        {visiblePageXEnd > visiblePageXStart && (
          <div
            style={{
              position: 'absolute',
              left: snapPx(visiblePageXStart),
              top: 0,
              width: snapPx(visiblePageXEnd - visiblePageXStart),
              height: '100%',
              backgroundColor: PAGE_EXTENT_FILL,
            }}
          />
        )}
        {pageStartX >= 0 && pageStartX <= horizontalRulerWidth && (
          <div
            style={{
              position: 'absolute',
              left: snapPx(pageStartX),
              top: 0,
              width: 1,
              height: '100%',
              backgroundColor: PAGE_EDGE_COLOR,
            }}
          />
        )}
        {pageEndX >= 0 && pageEndX <= horizontalRulerWidth && (
          <div
            style={{
              position: 'absolute',
              left: snapPx(pageEndX),
              top: 0,
              width: 1,
              height: '100%',
              backgroundColor: PAGE_EDGE_COLOR,
            }}
          />
        )}

        {rulerData.x.minor.map((tick) => {
          const midStep = rulerData.x.majorStepMm / 2;
          const majorMod = positiveModulo(tick.valueMm, rulerData.x.majorStepMm);
          const isMid = midStep > 0 && Math.abs(majorMod - midStep) < 0.001;
          return (
            <div
              key={`x-minor-${tick.valueMm}-${tick.pos}`}
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
          <React.Fragment key={`x-major-${tick.valueMm}-${tick.pos}`}>
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
              {formatTickLabel(tick.valueMm, rulerData.x.majorStepMm)}
            </div>
          </React.Fragment>
        ))}

        {cursorX !== null && cursorX >= 0 && cursorX <= horizontalRulerWidth && (
          <div
            style={{
              position: 'absolute',
              left: snapPx(cursorX),
              top: 0,
              width: 1,
              height: '100%',
              backgroundColor: CURSOR_INDICATOR_COLOR,
              pointerEvents: 'none',
              zIndex: 10,
            }}
          />
        )}
      </div>

      <div
        style={{
          position: 'absolute',
          top: snapPx(leftRulerTop),
          left: snapPx(leftRulerLeft),
          height: verticalRulerHeight,
          width: leftRulerWidth,
          backgroundColor: DEFAULT_RULER_BG,
          borderRight: `1px solid ${DEFAULT_RULER_BORDER}`,
          borderBottom: `1px solid ${DEFAULT_RULER_BORDER}`,
          overflow: 'hidden',
        }}
      >
        {visiblePageYEnd > visiblePageYStart && (
          <div
            style={{
              position: 'absolute',
              top: snapPx(visiblePageYStart),
              left: 0,
              height: snapPx(visiblePageYEnd - visiblePageYStart),
              width: '100%',
              backgroundColor: PAGE_EXTENT_FILL,
            }}
          />
        )}
        {pageStartY >= 0 && pageStartY <= verticalRulerHeight && (
          <div
            style={{
              position: 'absolute',
              top: snapPx(pageStartY),
              left: 0,
              height: 1,
              width: '100%',
              backgroundColor: PAGE_EDGE_COLOR,
            }}
          />
        )}
        {pageEndY >= 0 && pageEndY <= verticalRulerHeight && (
          <div
            style={{
              position: 'absolute',
              top: snapPx(pageEndY),
              left: 0,
              height: 1,
              width: '100%',
              backgroundColor: PAGE_EDGE_COLOR,
            }}
          />
        )}

        {rulerData.y.minor.map((tick) => {
          const midStep = rulerData.y.majorStepMm / 2;
          const majorMod = positiveModulo(tick.valueMm, rulerData.y.majorStepMm);
          const isMid = midStep > 0 && Math.abs(majorMod - midStep) < 0.001;
          return (
            <div
              key={`y-minor-${tick.valueMm}-${tick.pos}`}
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
          <React.Fragment key={`y-major-${tick.valueMm}-${tick.pos}`}>
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
              {formatTickLabel(tick.valueMm, rulerData.y.majorStepMm)}
            </div>
          </React.Fragment>
        ))}

        {cursorY !== null && cursorY >= 0 && cursorY <= verticalRulerHeight && (
          <div
            style={{
              position: 'absolute',
              top: snapPx(cursorY),
              left: 0,
              height: 1,
              width: '100%',
              backgroundColor: CURSOR_INDICATOR_COLOR,
              pointerEvents: 'none',
              zIndex: 10,
            }}
          />
        )}
      </div>
    </div>
  );
};

export default Rulers;
