import type { Point2D } from '../src/types';

export function expectPointClose(actual: Point2D, expected: Point2D, tolerance = 1e-4): void {
    expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(tolerance);
}

export function toPoint(x: number, y: number): Point2D {
    return { x, y };
}
