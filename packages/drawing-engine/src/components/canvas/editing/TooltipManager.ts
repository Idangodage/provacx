/**
 * TooltipManager
 *
 * Displays real-time dimension tooltips during editing operations.
 * Shows thickness, length, and offset values while dragging.
 */

import type { Point2D, DisplayUnit } from '../../../types';

// =============================================================================
// Types
// =============================================================================

export interface TooltipOptions {
  backgroundColor: string;
  textColor: string;
  fontSize: number;
  padding: number;
  borderRadius: number;
  offsetX: number;
  offsetY: number;
}

const DEFAULT_OPTIONS: TooltipOptions = {
  backgroundColor: 'rgba(0, 0, 0, 0.85)',
  textColor: '#ffffff',
  fontSize: 12,
  padding: 8,
  borderRadius: 4,
  offsetX: 15,
  offsetY: 15,
};

// =============================================================================
// TooltipManager Class
// =============================================================================

export class TooltipManager {
  private container: HTMLElement;
  private tooltip: HTMLDivElement | null = null;
  private options: TooltipOptions;

  constructor(container: HTMLElement, options: Partial<TooltipOptions> = {}) {
    this.container = container;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  // ==========================================================================
  // Tooltip Creation
  // ==========================================================================

  private createTooltip(): HTMLDivElement {
    if (this.tooltip) return this.tooltip;

    const tooltip = document.createElement('div');
    tooltip.style.cssText = `
      position: absolute;
      z-index: 10000;
      background-color: ${this.options.backgroundColor};
      color: ${this.options.textColor};
      font-size: ${this.options.fontSize}px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: ${this.options.padding}px;
      border-radius: ${this.options.borderRadius}px;
      pointer-events: none;
      white-space: nowrap;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      transition: opacity 0.1s ease;
    `;

    this.container.appendChild(tooltip);
    this.tooltip = tooltip;
    return tooltip;
  }

  // ==========================================================================
  // Formatting Helpers
  // ==========================================================================

  private formatValue(value: number, unit: DisplayUnit): string {
    switch (unit) {
      case 'mm':
        return `${Math.round(value)} mm`;
      case 'cm':
        return `${(value / 10).toFixed(1)} cm`;
      case 'm':
        return `${(value / 1000).toFixed(3)} m`;
      case 'ft-in': {
        const totalInches = value / 25.4;
        const feet = Math.floor(totalInches / 12);
        const inches = totalInches % 12;
        return `${feet}' ${inches.toFixed(1)}"`;
      }
      default:
        return `${Math.round(value)} mm`;
    }
  }

  // ==========================================================================
  // Tooltip Display Methods
  // ==========================================================================

  /**
   * Show thickness tooltip during edge drag
   */
  showThicknessTooltip(
    screenPosition: Point2D,
    currentThickness: number,
    originalThickness: number,
    unit: DisplayUnit = 'mm'
  ): void {
    const tooltip = this.createTooltip();

    const delta = currentThickness - originalThickness;
    const deltaSign = delta >= 0 ? '+' : '';
    const deltaStr = `(${deltaSign}${this.formatValue(delta, unit)})`;

    tooltip.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 2px;">Thickness</div>
      <div style="font-size: ${this.options.fontSize + 2}px; font-weight: 700;">
        ${this.formatValue(currentThickness, unit)}
      </div>
      <div style="font-size: ${this.options.fontSize - 1}px; opacity: 0.7; margin-top: 2px;">
        ${deltaStr}
      </div>
    `;

    this.updatePosition(screenPosition);
    tooltip.style.display = 'block';
  }

  /**
   * Show length tooltip during endpoint drag
   */
  showLengthTooltip(
    screenPosition: Point2D,
    currentLength: number,
    originalLength: number,
    unit: DisplayUnit = 'mm'
  ): void {
    const tooltip = this.createTooltip();

    const delta = currentLength - originalLength;
    const deltaSign = delta >= 0 ? '+' : '';
    const deltaStr = `(${deltaSign}${this.formatValue(delta, unit)})`;

    tooltip.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 2px;">Length</div>
      <div style="font-size: ${this.options.fontSize + 2}px; font-weight: 700;">
        ${this.formatValue(currentLength, unit)}
      </div>
      <div style="font-size: ${this.options.fontSize - 1}px; opacity: 0.7; margin-top: 2px;">
        ${deltaStr}
      </div>
    `;

    this.updatePosition(screenPosition);
    tooltip.style.display = 'block';
  }

  /**
   * Show offset tooltip during center/room drag
   */
  showOffsetTooltip(
    screenPosition: Point2D,
    offset: Point2D,
    unit: DisplayUnit = 'mm'
  ): void {
    const tooltip = this.createTooltip();

    const xSign = offset.x >= 0 ? '+' : '';
    const ySign = offset.y >= 0 ? '+' : '';

    tooltip.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 4px;">Offset</div>
      <div style="display: flex; gap: 12px;">
        <div>
          <span style="opacity: 0.7;">X:</span>
          <span style="font-weight: 600;">${xSign}${this.formatValue(offset.x, unit)}</span>
        </div>
        <div>
          <span style="opacity: 0.7;">Y:</span>
          <span style="font-weight: 600;">${ySign}${this.formatValue(offset.y, unit)}</span>
        </div>
      </div>
    `;

    this.updatePosition(screenPosition);
    tooltip.style.display = 'block';
  }

  /**
   * Show angle tooltip for constrained operations
   */
  showAngleTooltip(
    screenPosition: Point2D,
    angle: number
  ): void {
    const tooltip = this.createTooltip();

    tooltip.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 2px;">Angle</div>
      <div style="font-size: ${this.options.fontSize + 2}px; font-weight: 700;">
        ${angle.toFixed(1)}°
      </div>
    `;

    this.updatePosition(screenPosition);
    tooltip.style.display = 'block';
  }

  /**
   * Show constraint warning tooltip
   */
  showConstraintWarning(
    screenPosition: Point2D,
    message: string
  ): void {
    const tooltip = this.createTooltip();

    tooltip.style.backgroundColor = 'rgba(244, 67, 54, 0.9)';
    tooltip.innerHTML = `
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="font-size: 14px;">⚠️</span>
        <span>${message}</span>
      </div>
    `;

    this.updatePosition(screenPosition);
    tooltip.style.display = 'block';
  }

  // ==========================================================================
  // Position & Visibility
  // ==========================================================================

  /**
   * Update tooltip position
   */
  updatePosition(screenPosition: Point2D): void {
    if (!this.tooltip) return;

    const containerRect = this.container.getBoundingClientRect();
    const tooltipRect = this.tooltip.getBoundingClientRect();

    // Default position: bottom-right of cursor
    let left = screenPosition.x + this.options.offsetX;
    let top = screenPosition.y + this.options.offsetY;

    // Prevent overflow on right
    if (left + tooltipRect.width > containerRect.width) {
      left = screenPosition.x - tooltipRect.width - this.options.offsetX;
    }

    // Prevent overflow on bottom
    if (top + tooltipRect.height > containerRect.height) {
      top = screenPosition.y - tooltipRect.height - this.options.offsetY;
    }

    // Keep within container bounds
    left = Math.max(0, Math.min(left, containerRect.width - tooltipRect.width));
    top = Math.max(0, Math.min(top, containerRect.height - tooltipRect.height));

    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${top}px`;
  }

  /**
   * Hide tooltip
   */
  hide(): void {
    if (this.tooltip) {
      this.tooltip.style.display = 'none';
      // Reset background color
      this.tooltip.style.backgroundColor = this.options.backgroundColor;
    }
  }

  // ==========================================================================
  // Dispose
  // ==========================================================================

  dispose(): void {
    if (this.tooltip && this.tooltip.parentNode) {
      this.tooltip.parentNode.removeChild(this.tooltip);
    }
    this.tooltip = null;
  }
}