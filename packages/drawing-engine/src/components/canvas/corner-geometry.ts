import type { Point2D } from '../../types';

export type CornerSide = 'interior' | 'exterior';
export type CornerMode = 'miter' | 'trim' | 'flat';

export interface WallCornerEndpointSeed {
    wallId: string;
    endpoint: 'start' | 'end';
    nodePoint: Point2D;
    dirAway: Point2D;
    thicknessPx: number;
    halfThickness: number;
    interiorNormal: Point2D;
    exteriorNormal: Point2D;
}

export interface CornerPolicy {
    // Industrial-style threshold for acute corners:
    // below trimStartAngleDeg => start controlling miter growth
    // below flatAngleDeg => use flat bevel corner
    trimStartAngleDeg: number;
    flatAngleDeg: number;
    // Equivalent miter-ratio thresholds (distance from node / wall thickness).
    trimStartMiterRatio: number;
    flatMiterRatio: number;
    minTrimFactor: number;
    epsilon: number;
}

export interface CornerSideResolution {
    pointA: Point2D;
    pointB: Point2D;
    mode: CornerMode;
    spikeRatio: number;
}

export interface CornerPairResolution {
    interior: CornerSideResolution;
    exterior: CornerSideResolution;
    mode: CornerMode;
    angleDeg: number;
    spikeRatio: number;
}

// Defaults selected for construction-friendly behavior:
// preserve normal corners, trim highly acute, flatten only extreme acute corners.
export const INDUSTRIAL_CORNER_POLICY: CornerPolicy = {
    // Practical defaults:
    // - normal corners keep miter
    // - acute corners trim
    // - only extreme acute corners get flat bevel on exterior side
    trimStartAngleDeg: 30,
    flatAngleDeg: 72,
    trimStartMiterRatio: 2.2,
    flatMiterRatio: 3.6,
    minTrimFactor: 0.55,
    epsilon: 0.08,
};

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function intersectInfiniteLines(
    originA: Point2D,
    directionA: Point2D,
    originB: Point2D,
    directionB: Point2D
): Point2D | null {
    const det = directionA.x * directionB.y - directionA.y * directionB.x;
    if (Math.abs(det) <= 1e-9) return null;
    const dx = originB.x - originA.x;
    const dy = originB.y - originA.y;
    const t = (dx * directionB.y - dy * directionB.x) / det;
    return {
        x: originA.x + directionA.x * t,
        y: originA.y + directionA.y * t,
    };
}

function getCornerNodePoint(endpointA: WallCornerEndpointSeed, endpointB: WallCornerEndpointSeed): Point2D {
    return {
        x: (endpointA.nodePoint.x + endpointB.nodePoint.x) / 2,
        y: (endpointA.nodePoint.y + endpointB.nodePoint.y) / 2,
    };
}

function getCornerAngleDeg(endpointA: WallCornerEndpointSeed, endpointB: WallCornerEndpointSeed): number {
    const dot = clamp(
        endpointA.dirAway.x * endpointB.dirAway.x + endpointA.dirAway.y * endpointB.dirAway.y,
        -1,
        1
    );
    return (Math.acos(dot) * 180) / Math.PI;
}

function getEffectiveCornerAngleDeg(rawAngleDeg: number): number {
    // Orientation-invariant: mirrored corners should classify identically.
    return Math.min(rawAngleDeg, 180 - rawAngleDeg);
}

function getOffsetPointForSide(endpoint: WallCornerEndpointSeed, side: CornerSide): Point2D {
    const normal = side === 'interior' ? endpoint.interiorNormal : endpoint.exteriorNormal;
    return {
        x: endpoint.nodePoint.x + normal.x * endpoint.halfThickness,
        y: endpoint.nodePoint.y + normal.y * endpoint.halfThickness,
    };
}

function getTheoreticalMiterRatio(angleDeg: number): number {
    const clampedAngle = clamp(angleDeg, 0.01, 179.99);
    const halfAngle = (clampedAngle * Math.PI) / 360;
    const sine = Math.sin(halfAngle);
    if (sine <= 1e-6) return Number.POSITIVE_INFINITY;
    return 1 / (2 * sine);
}

function classifyCorner(
    effectiveAngleDeg: number,
    spikeRatio: number,
    policy: CornerPolicy
): CornerMode {
    if (
        effectiveAngleDeg <= policy.flatAngleDeg + policy.epsilon ||
        spikeRatio >= policy.flatMiterRatio - policy.epsilon
    ) {
        return 'flat';
    }
    if (
        effectiveAngleDeg <= policy.trimStartAngleDeg + policy.epsilon ||
        spikeRatio >= policy.trimStartMiterRatio - policy.epsilon
    ) {
        return 'trim';
    }
    return 'miter';
}

function computeTrimFactor(
    effectiveAngleDeg: number,
    spikeRatio: number,
    policy: CornerPolicy
): number {
    const ratioStart = Math.min(policy.trimStartMiterRatio, policy.flatMiterRatio);
    const ratioEnd = Math.max(policy.trimStartMiterRatio, policy.flatMiterRatio);
    const angleStart = Math.max(policy.trimStartAngleDeg, policy.flatAngleDeg);
    const angleEnd = Math.min(policy.trimStartAngleDeg, policy.flatAngleDeg);
    const ratioRange = Math.max(ratioEnd - ratioStart, 0.0001);
    const angleRange = Math.max(angleStart - angleEnd, 0.0001);
    const ratioSeverity = clamp((spikeRatio - ratioStart) / ratioRange, 0, 1);
    const angleSeverity = clamp((angleStart - effectiveAngleDeg) / angleRange, 0, 1);
    const severity = Math.max(ratioSeverity, angleSeverity);
    return 1 - severity * (1 - policy.minTrimFactor);
}

function choosePreferredFlatSide(
    interiorRatio: number,
    exteriorRatio: number
): CornerSide | null {
    const interiorFinite = Number.isFinite(interiorRatio);
    const exteriorFinite = Number.isFinite(exteriorRatio);
    if (interiorFinite && !exteriorFinite) return 'exterior';
    if (!interiorFinite && exteriorFinite) return 'interior';
    if (!interiorFinite && !exteriorFinite) return null;
    if (Math.abs(exteriorRatio - interiorRatio) <= 1e-6) return null;
    return exteriorRatio >= interiorRatio ? 'exterior' : 'interior';
}

function resolveCornerSide(
    endpointA: WallCornerEndpointSeed,
    endpointB: WallCornerEndpointSeed,
    side: CornerSide,
    mode: CornerMode,
    effectiveAngleDeg: number,
    spikeRatio: number,
    policy: CornerPolicy
): CornerSideResolution {
    const baseA = getOffsetPointForSide(endpointA, side);
    const baseB = getOffsetPointForSide(endpointB, side);

    if (mode === 'flat') {
        return {
            pointA: baseA,
            pointB: baseB,
            mode: 'flat',
            spikeRatio,
        };
    }

    const intersection = intersectInfiniteLines(baseA, endpointA.dirAway, baseB, endpointB.dirAway);
    if (!intersection) {
        return {
            pointA: baseA,
            pointB: baseB,
            mode: 'flat',
            spikeRatio: Number.POSITIVE_INFINITY,
        };
    }

    if (mode === 'miter') {
        return {
            pointA: intersection,
            pointB: intersection,
            mode: 'miter',
            spikeRatio,
        };
    }

    const nodePoint = getCornerNodePoint(endpointA, endpointB);
    const trimFactor = computeTrimFactor(effectiveAngleDeg, spikeRatio, policy);
    const trimmedPoint = {
        x: nodePoint.x + (intersection.x - nodePoint.x) * trimFactor,
        y: nodePoint.y + (intersection.y - nodePoint.y) * trimFactor,
    };
    return {
        pointA: trimmedPoint,
        pointB: trimmedPoint,
        mode: 'trim',
        spikeRatio,
    };
}

export function resolveWallCornerPair(
    endpointA: WallCornerEndpointSeed,
    endpointB: WallCornerEndpointSeed,
    policy: CornerPolicy = INDUSTRIAL_CORNER_POLICY
): CornerPairResolution {
    const angleDeg = getCornerAngleDeg(endpointA, endpointB);
    const effectiveAngleDeg = getEffectiveCornerAngleDeg(angleDeg);
    const nodePoint = getCornerNodePoint(endpointA, endpointB);
    const nominalThickness = Math.max(Math.min(endpointA.thicknessPx, endpointB.thicknessPx), 0.0001);

    const interiorA = getOffsetPointForSide(endpointA, 'interior');
    const interiorB = getOffsetPointForSide(endpointB, 'interior');
    const exteriorA = getOffsetPointForSide(endpointA, 'exterior');
    const exteriorB = getOffsetPointForSide(endpointB, 'exterior');

    const interiorIntersection = intersectInfiniteLines(
        interiorA,
        endpointA.dirAway,
        interiorB,
        endpointB.dirAway
    );
    const exteriorIntersection = intersectInfiniteLines(
        exteriorA,
        endpointA.dirAway,
        exteriorB,
        endpointB.dirAway
    );

    const interiorRatio = interiorIntersection
        ? Math.hypot(interiorIntersection.x - nodePoint.x, interiorIntersection.y - nodePoint.y) / nominalThickness
        : Number.POSITIVE_INFINITY;
    const exteriorRatio = exteriorIntersection
        ? Math.hypot(exteriorIntersection.x - nodePoint.x, exteriorIntersection.y - nodePoint.y) / nominalThickness
        : Number.POSITIVE_INFINITY;
    const theoreticalRatio = getTheoreticalMiterRatio(effectiveAngleDeg);
    const spikeRatio = Math.max(interiorRatio, exteriorRatio, theoreticalRatio);

    let mode = classifyCorner(effectiveAngleDeg, spikeRatio, policy);
    if (!interiorIntersection || !exteriorIntersection) {
        mode = 'flat';
    }

    const solvePair = (
        interiorMode: CornerMode,
        exteriorMode: CornerMode
    ): { interior: CornerSideResolution; exterior: CornerSideResolution } => ({
        interior: resolveCornerSide(
            endpointA,
            endpointB,
            'interior',
            interiorMode,
            effectiveAngleDeg,
            spikeRatio,
            policy
        ),
        exterior: resolveCornerSide(
            endpointA,
            endpointB,
            'exterior',
            exteriorMode,
            effectiveAngleDeg,
            spikeRatio,
            policy
        ),
    });

    const clampTrimResolution = (resolution: CornerSideResolution): CornerSideResolution => {
        if (resolution.mode !== 'trim') return resolution;
        const maxTrimDistance = nominalThickness * 1.2;
        const dx = resolution.pointA.x - nodePoint.x;
        const dy = resolution.pointA.y - nodePoint.y;
        const distance = Math.hypot(dx, dy);
        if (!Number.isFinite(distance) || distance <= maxTrimDistance || distance <= 1e-9) {
            return resolution;
        }
        const factor = maxTrimDistance / distance;
        const clampedPoint = {
            x: nodePoint.x + dx * factor,
            y: nodePoint.y + dy * factor,
        };
        return {
            ...resolution,
            pointA: clampedPoint,
            pointB: clampedPoint,
        };
    };

    const chooseFlatAssignment = (
        preferredFlatSide: CornerSide | null
    ): { interior: CornerSideResolution; exterior: CornerSideResolution } => {
        const rawA = solvePair('trim', 'flat');
        const rawB = solvePair('flat', 'trim');
        const candidateA = {
            interior: clampTrimResolution(rawA.interior),
            exterior: rawA.exterior,
        };
        const candidateB = {
            interior: rawB.interior,
            exterior: clampTrimResolution(rawB.exterior),
        };

        if (preferredFlatSide === 'exterior') return candidateA;
        if (preferredFlatSide === 'interior') return candidateB;

        const flatLenA = Math.hypot(
            candidateA.exterior.pointB.x - candidateA.exterior.pointA.x,
            candidateA.exterior.pointB.y - candidateA.exterior.pointA.y
        );
        const flatLenB = Math.hypot(
            candidateB.interior.pointB.x - candidateB.interior.pointA.x,
            candidateB.interior.pointB.y - candidateB.interior.pointA.y
        );

        const flatMidA = {
            x: (candidateA.exterior.pointA.x + candidateA.exterior.pointB.x) / 2,
            y: (candidateA.exterior.pointA.y + candidateA.exterior.pointB.y) / 2,
        };
        const flatMidB = {
            x: (candidateB.interior.pointA.x + candidateB.interior.pointB.x) / 2,
            y: (candidateB.interior.pointA.y + candidateB.interior.pointB.y) / 2,
        };
        const flatMidDistA = Math.hypot(flatMidA.x - nodePoint.x, flatMidA.y - nodePoint.y);
        const flatMidDistB = Math.hypot(flatMidB.x - nodePoint.x, flatMidB.y - nodePoint.y);

        const trimDistA = Math.hypot(
            candidateA.interior.pointA.x - nodePoint.x,
            candidateA.interior.pointA.y - nodePoint.y
        );
        const trimDistB = Math.hypot(
            candidateB.exterior.pointA.x - nodePoint.x,
            candidateB.exterior.pointA.y - nodePoint.y
        );

        // Prefer candidate where the flat edge sits farther from the node than the trim side
        // (i.e., outer-side bevel). Tie-break with longer flat span.
        const outerScoreA = flatMidDistA - trimDistA;
        const outerScoreB = flatMidDistB - trimDistB;
        if (Math.abs(outerScoreA - outerScoreB) > 1e-6) {
            return outerScoreA >= outerScoreB ? candidateA : candidateB;
        }
        return flatLenA >= flatLenB ? candidateA : candidateB;
    };

    let interior: CornerSideResolution;
    let exterior: CornerSideResolution;
    if (mode === 'flat') {
        const chosen = chooseFlatAssignment(choosePreferredFlatSide(interiorRatio, exteriorRatio));
        interior = chosen.interior;
        exterior = chosen.exterior;
    } else {
        const chosen = solvePair(mode, mode);
        interior = chosen.interior;
        exterior = chosen.exterior;
    }

    // If one side has no stable intersection in non-flat modes, force fully flat pair.
    if (
        mode !== 'flat' &&
        (interior.mode === 'flat' || exterior.mode === 'flat')
    ) {
        mode = 'flat';
        const chosen = chooseFlatAssignment(choosePreferredFlatSide(interiorRatio, exteriorRatio));
        interior = chosen.interior;
        exterior = chosen.exterior;
    }

    // Safety: if trim/miter produces an overly pinched corner width, force flat bevel.
    if (mode !== 'flat') {
        const widthA = Math.hypot(
            interior.pointA.x - exterior.pointA.x,
            interior.pointA.y - exterior.pointA.y
        );
        const widthB = Math.hypot(
            interior.pointB.x - exterior.pointB.x,
            interior.pointB.y - exterior.pointB.y
        );
        const minCornerWidth = Math.min(widthA, widthB);
        if (minCornerWidth < nominalThickness * 0.55) {
            mode = 'flat';
            const chosen = chooseFlatAssignment(choosePreferredFlatSide(interiorRatio, exteriorRatio));
            interior = chosen.interior;
            exterior = chosen.exterior;
        }
    }

    return {
        interior,
        exterior,
        mode,
        angleDeg,
        spikeRatio,
    };
}
