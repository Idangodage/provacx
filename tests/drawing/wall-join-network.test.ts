import { describe, expect, it } from 'vitest';

import {
  buildTemporaryWall,
  computeWallJoinMapWithShadows,
} from '../../packages/drawing-engine/src/components/canvas/wall/WallJoinNetwork';

describe('computeWallJoinMapWithShadows', () => {
  it('keeps partially overlapping room edges as distinct walls', () => {
    const upperBottom = buildTemporaryWall(
      'upper-bottom',
      { x: 12100, y: 0 },
      { x: 0, y: 0 },
      200,
      'brick'
    );
    const lowerTop = buildTemporaryWall(
      'lower-top',
      { x: 0, y: 0 },
      { x: 9700, y: 0 },
      200,
      'brick'
    );

    const { shadowedWallIds } = computeWallJoinMapWithShadows([upperBottom, lowerTop]);

    expect([...shadowedWallIds]).toEqual([]);
  });

  it('still shadows exact duplicate walls drawn on the same span', () => {
    const original = buildTemporaryWall(
      'original',
      { x: 0, y: 0 },
      { x: 9700, y: 0 },
      200,
      'brick'
    );
    const duplicate = buildTemporaryWall(
      'duplicate',
      { x: 9700, y: 0 },
      { x: 0, y: 0 },
      200,
      'brick'
    );

    const { shadowedWallIds } = computeWallJoinMapWithShadows([original, duplicate]);

    expect(shadowedWallIds.has('duplicate')).toBe(true);
    expect(shadowedWallIds.size).toBe(1);
  });
});
