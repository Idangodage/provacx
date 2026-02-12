/**
 * Constraint-based corner editing for architectural floor plans.
 *
 * This module operates on Wall2D arrays directly. It builds a lightweight
 * constraint graph over wall endpoints, applies constraints using a Gauss-Seidel
 * style relaxation, and returns updated walls plus diagnostics.
 */

import type { Point2D, Wall2D } from '../types';
import { distance, segmentsIntersect, rotatePoint } from './geometry';

// =============================================================================
// Types
// =============================================================================

export type ConstraintKind =
    | 'fixed'
    | 'angle'
    | 'perpendicular'
    | 'parallel'
    | 'minAngle'
    | 'maxAngle';

export type AngleSolveMode = 'rotate-both' | 'keep-a' | 'keep-b' | 'min-movement';

export interface ConstraintBase {
    id: string;
    kind: ConstraintKind;
    hard: boolean;
    weight: number;
}

export interface FixedConstraint extends ConstraintBase {
    kind: 'fixed';
    vertexId: string;
    position: Point2D;
}

export interface AngleConstraint extends ConstraintBase {
    kind: 'angle';
    vertexId: string;
    aId: string;
    bId: string;
    targetAngleDeg: number;
    mode: AngleSolveMode;
    snapAngles?: number[];
    snapToleranceDeg?: number;
}

export interface PerpendicularConstraint extends ConstraintBase {
    kind: 'perpendicular';
    wallAId: string;
    wallBId: string;
}

export interface ParallelConstraint extends ConstraintBase {
    kind: 'parallel';
    wallAId: string;
    wallBId: string;
}

export interface MinAngleConstraint extends ConstraintBase {
    kind: 'minAngle';
    vertexId: string;
    aId: string;
    bId: string;
    minAngleDeg: number;
}

export interface MaxAngleConstraint extends ConstraintBase {
    kind: 'maxAngle';
    vertexId: string;
    aId: string;
    bId: string;
    maxAngleDeg: number;
}

export type Constraint =
    | FixedConstraint
    | AngleConstraint
    | PerpendicularConstraint
    | ParallelConstraint
    | MinAngleConstraint
    | MaxAngleConstraint;

export interface ConstraintViolation {
    constraintId: string;
    message: string;
    severity: 'error' | 'warning';
}

export interface SolveResult {
    walls: Wall2D[];
    violations: ConstraintViolation[];
    converged: boolean;
    iterations: number;
}

export interface CornerEditInput {
    wallAId: string;
    wallBId: string;
    corner: Point2D;
    targetAngleDeg: number;
    mode: AngleSolveMode;
}

export interface CornerEditOptions {
    tolerance?: number;
    maxIterations?: number;
    snapAngles?: number[];
    snapToleranceDeg?: number;
    minAngleDeg?: number;
    maxAngleDeg?: number;
    hardAngle?: boolean;
    hardFixedVertices?: string[];
    preventIntersections?: boolean;
}

// =============================================================================
// Constraint Graph
// =============================================================================

interface GraphVertex {
    id: string;
    position: Point2D;
    wallIds: string[];
    locked: boolean;
}

interface GraphWall {
    id: string;
    startId: string;
    endId: string;
}

interface ConstraintGraph {
    vertices: Map<string, GraphVertex>;
    walls: Map<string, GraphWall>;
}

const DEFAULT_ANGLE_SNAP = [90, 45, 30, 60, 120, 135, 150];

// =============================================================================
// Public API
// =============================================================================

export function applyCornerAngleInput(
    walls: Wall2D[],
    input: CornerEditInput,
    options: CornerEditOptions = {}
): SolveResult {
    const tolerance = options.tolerance ?? 0.5;
    const graph = buildGraphFromWalls(walls, tolerance);
    const cornerVertex = findVertexAtPoint(graph, input.corner, tolerance);
    if (!cornerVertex) {
        return {
            walls,
            violations: [
                {
                    constraintId: 'corner',
                    message: 'Corner vertex not found.',
                    severity: 'error',
                },
            ],
            converged: false,
            iterations: 0,
        };
    }

    const wallA = graph.walls.get(input.wallAId);
    const wallB = graph.walls.get(input.wallBId);
    if (!wallA || !wallB) {
        return {
            walls,
            violations: [
                {
                    constraintId: 'corner',
                    message: 'Wall ids not found.',
                    severity: 'error',
                },
            ],
            converged: false,
            iterations: 0,
        };
    }

    const aOther = otherVertexId(wallA, cornerVertex.id);
    const bOther = otherVertexId(wallB, cornerVertex.id);
    if (!aOther || !bOther) {
        return {
            walls,
            violations: [
                {
                    constraintId: 'corner',
                    message: 'Corner does not connect both walls.',
                    severity: 'error',
                },
            ],
            converged: false,
            iterations: 0,
        };
    }

    const constraints: Constraint[] = [];
    const snapAngles = options.snapAngles ?? DEFAULT_ANGLE_SNAP;
    const snapToleranceDeg = options.snapToleranceDeg ?? 2;

    constraints.push({
        id: 'corner-angle',
        kind: 'angle',
        hard: options.hardAngle ?? true,
        weight: 1,
        vertexId: cornerVertex.id,
        aId: aOther,
        bId: bOther,
        targetAngleDeg: input.targetAngleDeg,
        mode: input.mode,
        snapAngles,
        snapToleranceDeg,
    });

    if (options.minAngleDeg != null) {
        constraints.push({
            id: 'min-angle',
            kind: 'minAngle',
            hard: true,
            weight: 1,
            vertexId: cornerVertex.id,
            aId: aOther,
            bId: bOther,
            minAngleDeg: options.minAngleDeg,
        });
    }

    if (options.maxAngleDeg != null) {
        constraints.push({
            id: 'max-angle',
            kind: 'maxAngle',
            hard: true,
            weight: 1,
            vertexId: cornerVertex.id,
            aId: aOther,
            bId: bOther,
            maxAngleDeg: options.maxAngleDeg,
        });
    }

    (options.hardFixedVertices ?? []).forEach((vertexId) => {
        const v = graph.vertices.get(vertexId);
        if (!v) return;
        constraints.push({
            id: `fixed-${vertexId}`,
            kind: 'fixed',
            hard: true,
            weight: 1,
            vertexId,
            position: { ...v.position },
        });
    });

    const result = solveConstraints(graph, constraints, {
        maxIterations: options.maxIterations ?? 24,
        toleranceDeg: 0.2,
    });

    const updatedWalls = applyGraphToWalls(walls, result.graph);
    const collisionViolations = options.preventIntersections
        ? detectWallIntersections(updatedWalls, [input.wallAId, input.wallBId])
        : [];

    return {
        walls: updatedWalls,
        violations: [...result.violations, ...collisionViolations],
        converged: result.converged && collisionViolations.length === 0,
        iterations: result.iterations,
    };
}

export function applyCornerAngleDrag(
    walls: Wall2D[],
    input: CornerEditInput,
    options: CornerEditOptions = {}
): SolveResult {
    return applyCornerAngleInput(walls, input, options);
}

export function suggestRectangularCorner(
    walls: Wall2D[],
    corner: Point2D,
    tolerance = 0.5,
    thresholdDeg = 4
): { wallAId: string; wallBId: string; targetAngleDeg: number } | null {
    const graph = buildGraphFromWalls(walls, tolerance);
    const vertex = findVertexAtPoint(graph, corner, tolerance);
    if (!vertex) return null;
    if (vertex.wallIds.length < 2) return null;

    for (let i = 0; i < vertex.wallIds.length; i++) {
        for (let j = i + 1; j < vertex.wallIds.length; j++) {
            const wallA = graph.walls.get(vertex.wallIds[i]);
            const wallB = graph.walls.get(vertex.wallIds[j]);
            if (!wallA || !wallB) continue;
            const aOther = otherVertexId(wallA, vertex.id);
            const bOther = otherVertexId(wallB, vertex.id);
            if (!aOther || !bOther) continue;
            const angle = angleAtVertex(
                graph.vertices.get(aOther)?.position,
                vertex.position,
                graph.vertices.get(bOther)?.position
            );
            if (Math.abs(angle - 90) <= thresholdDeg) {
                return { wallAId: wallA.id, wallBId: wallB.id, targetAngleDeg: 90 };
            }
        }
    }

    return null;
}

export function snapAngle(angle: number, snapAngles: number[], toleranceDeg: number): number {
    let best = angle;
    let bestDiff = Number.POSITIVE_INFINITY;
    snapAngles.forEach((snap) => {
        const diff = Math.abs(angle - snap);
        if (diff < bestDiff) {
            bestDiff = diff;
            best = snap;
        }
    });
    return bestDiff <= toleranceDeg ? best : angle;
}

// =============================================================================
// Solver
// =============================================================================

interface SolveOptions {
    maxIterations: number;
    toleranceDeg: number;
}

interface SolveInternalResult {
    graph: ConstraintGraph;
    violations: ConstraintViolation[];
    converged: boolean;
    iterations: number;
}

export function solveConstraints(
    graph: ConstraintGraph,
    constraints: Constraint[],
    options: SolveOptions
): SolveInternalResult {
    const violations: ConstraintViolation[] = [];
    const hardConstraints = constraints.filter((c) => c.hard);
    const softConstraints = constraints.filter((c) => !c.hard);

    let converged = false;
    let iterations = 0;

    for (let iter = 0; iter < options.maxIterations; iter++) {
        iterations = iter + 1;
        let maxAngleError = 0;

        hardConstraints.forEach((constraint) => {
            maxAngleError = Math.max(
                maxAngleError,
                applyConstraint(graph, constraint, 1)
            );
        });

        softConstraints.forEach((constraint) => {
            const stiffness = clamp01(constraint.weight);
            maxAngleError = Math.max(
                maxAngleError,
                applyConstraint(graph, constraint, stiffness)
            );
        });

        if (maxAngleError <= options.toleranceDeg) {
            converged = true;
            break;
        }
    }

    hardConstraints.forEach((constraint) => {
        if (constraint.kind === 'angle') {
            const error = evaluateAngleConstraint(graph, constraint);
            if (Math.abs(error) > options.toleranceDeg) {
                violations.push({
                    constraintId: constraint.id,
                    message: `Angle constraint not satisfied: error ${error.toFixed(2)} deg.`,
                    severity: 'error',
                });
            }
        }
    });

    return { graph, violations, converged, iterations };
}

function applyConstraint(
    graph: ConstraintGraph,
    constraint: Constraint,
    stiffness: number
): number {
    switch (constraint.kind) {
        case 'fixed':
            return applyFixedConstraint(graph, constraint, stiffness);
        case 'angle':
            return applyAngleConstraint(graph, constraint, stiffness);
        case 'perpendicular':
            return applyWallAngleConstraint(graph, constraint, 90, stiffness);
        case 'parallel':
            return applyWallAngleConstraint(graph, constraint, 0, stiffness);
        case 'minAngle':
            return applyMinMaxAngle(graph, constraint, stiffness, true);
        case 'maxAngle':
            return applyMinMaxAngle(graph, constraint, stiffness, false);
        default:
            return 0;
    }
}

// =============================================================================
// Constraint Applications
// =============================================================================

function applyFixedConstraint(
    graph: ConstraintGraph,
    constraint: FixedConstraint,
    stiffness: number
): number {
    const vertex = graph.vertices.get(constraint.vertexId);
    if (!vertex) return 0;
    if (vertex.locked) return 0;
    const dx = (constraint.position.x - vertex.position.x) * stiffness;
    const dy = (constraint.position.y - vertex.position.y) * stiffness;
    vertex.position = { x: vertex.position.x + dx, y: vertex.position.y + dy };
    return Math.hypot(dx, dy);
}

function applyAngleConstraint(
    graph: ConstraintGraph,
    constraint: AngleConstraint,
    stiffness: number
): number {
    const vertex = graph.vertices.get(constraint.vertexId);
    const a = graph.vertices.get(constraint.aId);
    const b = graph.vertices.get(constraint.bId);
    if (!vertex || !a || !b) return 0;

    const currentAngle = angleAtVertex(a.position, vertex.position, b.position);
    const target = constraint.snapAngles
        ? snapAngle(constraint.targetAngleDeg, constraint.snapAngles, constraint.snapToleranceDeg ?? 0)
        : constraint.targetAngleDeg;
    const delta = normalizeAngleDelta(target - currentAngle);
    if (Math.abs(delta) < 1e-5) return 0;

    const { rotateA, rotateB } = distributeAngleDelta(
        constraint.mode,
        vertex.position,
        a.position,
        b.position,
        delta
    );

    if (!a.locked) {
        const nextA = rotatePoint(a.position, vertex.position, rotateA * stiffness);
        a.position = nextA;
    }
    if (!b.locked) {
        const nextB = rotatePoint(b.position, vertex.position, -rotateB * stiffness);
        b.position = nextB;
    }

    return Math.abs(delta);
}

function applyWallAngleConstraint(
    graph: ConstraintGraph,
    constraint: PerpendicularConstraint | ParallelConstraint,
    targetAngleDeg: number,
    stiffness: number
): number {
    const wallA = graph.walls.get(constraint.wallAId);
    const wallB = graph.walls.get(constraint.wallBId);
    if (!wallA || !wallB) return 0;

    const aStart = graph.vertices.get(wallA.startId);
    const aEnd = graph.vertices.get(wallA.endId);
    const bStart = graph.vertices.get(wallB.startId);
    const bEnd = graph.vertices.get(wallB.endId);
    if (!aStart || !aEnd || !bStart || !bEnd) return 0;

    const dirA = vectorBetween(aStart.position, aEnd.position);
    const dirB = vectorBetween(bStart.position, bEnd.position);
    if (length(dirA) < 1e-6 || length(dirB) < 1e-6) return 0;

    const angleA = Math.atan2(dirA.y, dirA.x) * RAD_TO_DEG;
    const angleB = Math.atan2(dirB.y, dirB.x) * RAD_TO_DEG;
    let delta = normalizeAngleDelta(targetAngleDeg + angleA - angleB);

    if (Math.abs(delta) < 1e-4) return 0;

    const bCenter = midpoint(bStart.position, bEnd.position);
    if (!bStart.locked) bStart.position = rotatePoint(bStart.position, bCenter, delta * stiffness);
    if (!bEnd.locked) bEnd.position = rotatePoint(bEnd.position, bCenter, delta * stiffness);

    return Math.abs(delta);
}

function applyMinMaxAngle(
    graph: ConstraintGraph,
    constraint: MinAngleConstraint | MaxAngleConstraint,
    stiffness: number,
    isMin: boolean
): number {
    const vertex = graph.vertices.get(constraint.vertexId);
    const a = graph.vertices.get(constraint.aId);
    const b = graph.vertices.get(constraint.bId);
    if (!vertex || !a || !b) return 0;

    const currentAngle = angleAtVertex(a.position, vertex.position, b.position);
    const target = isMin
        ? (constraint as MinAngleConstraint).minAngleDeg
        : (constraint as MaxAngleConstraint).maxAngleDeg;
    const violated = isMin ? currentAngle < target : currentAngle > target;
    if (!violated) return 0;

    const delta = isMin ? target - currentAngle : target - currentAngle;
    const { rotateA, rotateB } = distributeAngleDelta(
        'min-movement',
        vertex.position,
        a.position,
        b.position,
        delta
    );

    if (!a.locked) a.position = rotatePoint(a.position, vertex.position, rotateA * stiffness);
    if (!b.locked) b.position = rotatePoint(b.position, vertex.position, -rotateB * stiffness);
    return Math.abs(delta);
}

function evaluateAngleConstraint(graph: ConstraintGraph, constraint: AngleConstraint): number {
    const vertex = graph.vertices.get(constraint.vertexId);
    const a = graph.vertices.get(constraint.aId);
    const b = graph.vertices.get(constraint.bId);
    if (!vertex || !a || !b) return 0;
    const currentAngle = angleAtVertex(a.position, vertex.position, b.position);
    return normalizeAngleDelta(constraint.targetAngleDeg - currentAngle);
}

function distributeAngleDelta(
    mode: AngleSolveMode,
    vertex: Point2D,
    a: Point2D,
    b: Point2D,
    deltaDeg: number
): { rotateA: number; rotateB: number } {
    if (mode === 'keep-a') return { rotateA: 0, rotateB: deltaDeg };
    if (mode === 'keep-b') return { rotateA: deltaDeg, rotateB: 0 };
    if (mode === 'rotate-both') return { rotateA: deltaDeg / 2, rotateB: deltaDeg / 2 };

    const lenA = distance(vertex, a);
    const lenB = distance(vertex, b);
    const denom = lenA * lenA + lenB * lenB;
    if (denom < 1e-6) return { rotateA: deltaDeg / 2, rotateB: deltaDeg / 2 };

    const rotateA = deltaDeg * (lenB * lenB) / denom;
    const rotateB = deltaDeg - rotateA;
    return { rotateA, rotateB };
}

// =============================================================================
// Graph Builders
// =============================================================================

export function buildGraphFromWalls(walls: Wall2D[], tolerance = 0.5): ConstraintGraph {
    const vertices = new Map<string, GraphVertex>();
    const wallsMap = new Map<string, GraphWall>();

    const findOrCreateVertex = (point: Point2D): string => {
        for (const vertex of vertices.values()) {
            if (distance(vertex.position, point) <= tolerance) {
                return vertex.id;
            }
        }
        const id = `v_${vertices.size + 1}`;
        vertices.set(id, { id, position: { ...point }, wallIds: [], locked: false });
        return id;
    };

    walls.forEach((wall) => {
        const startId = findOrCreateVertex(wall.start);
        const endId = findOrCreateVertex(wall.end);
        wallsMap.set(wall.id, { id: wall.id, startId, endId });
        vertices.get(startId)?.wallIds.push(wall.id);
        vertices.get(endId)?.wallIds.push(wall.id);
    });

    return { vertices, walls: wallsMap };
}

function applyGraphToWalls(walls: Wall2D[], graph: ConstraintGraph): Wall2D[] {
    return walls.map((wall) => {
        const graphWall = graph.walls.get(wall.id);
        if (!graphWall) return wall;
        const start = graph.vertices.get(graphWall.startId)?.position;
        const end = graph.vertices.get(graphWall.endId)?.position;
        if (!start || !end) return wall;
        return { ...wall, start: { ...start }, end: { ...end } };
    });
}

function findVertexAtPoint(
    graph: ConstraintGraph,
    point: Point2D,
    tolerance: number
): GraphVertex | null {
    for (const vertex of graph.vertices.values()) {
        if (distance(vertex.position, point) <= tolerance) return vertex;
    }
    return null;
}

function otherVertexId(wall: GraphWall, vertexId: string): string | null {
    if (wall.startId === vertexId) return wall.endId;
    if (wall.endId === vertexId) return wall.startId;
    return null;
}

// =============================================================================
// Collision Detection
// =============================================================================

export function detectWallIntersections(
    walls: Wall2D[],
    movingWallIds: string[]
): ConstraintViolation[] {
    const moving = new Set(movingWallIds);
    const violations: ConstraintViolation[] = [];

    for (let i = 0; i < walls.length; i++) {
        const a = walls[i];
        if (!a) continue;
        for (let j = i + 1; j < walls.length; j++) {
            const b = walls[j];
            if (!b) continue;
            const relevant = moving.has(a.id) || moving.has(b.id);
            if (!relevant) continue;
            if (wallsShareEndpoint(a, b, 0.5)) continue;
            if (segmentsIntersect(a.start, a.end, b.start, b.end)) {
                violations.push({
                    constraintId: 'intersection',
                    message: `Wall ${a.id} intersects wall ${b.id}.`,
                    severity: 'error',
                });
            }
        }
    }

    return violations;
}

function wallsShareEndpoint(a: Wall2D, b: Wall2D, tolerance: number): boolean {
    return (
        distance(a.start, b.start) <= tolerance ||
        distance(a.start, b.end) <= tolerance ||
        distance(a.end, b.start) <= tolerance ||
        distance(a.end, b.end) <= tolerance
    );
}

// =============================================================================
// Vector Math
// =============================================================================

const RAD_TO_DEG = 180 / Math.PI;

function vectorBetween(a: Point2D, b: Point2D): Point2D {
    return { x: b.x - a.x, y: b.y - a.y };
}

function length(v: Point2D): number {
    return Math.hypot(v.x, v.y);
}

function dot(a: Point2D, b: Point2D): number {
    return a.x * b.x + a.y * b.y;
}

function midpoint(a: Point2D, b: Point2D): Point2D {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function normalizeAngleDelta(delta: number): number {
    let result = delta;
    while (result > 180) result -= 360;
    while (result < -180) result += 360;
    return result;
}

function angleAtVertex(a: Point2D | undefined, vertex: Point2D, b: Point2D | undefined): number {
    if (!a || !b) return 0;
    const va = vectorBetween(vertex, a);
    const vb = vectorBetween(vertex, b);
    const denom = length(va) * length(vb);
    if (denom < 1e-6) return 0;
    const cosine = Math.max(-1, Math.min(1, dot(va, vb) / denom));
    return Math.acos(cosine) * RAD_TO_DEG;
}
