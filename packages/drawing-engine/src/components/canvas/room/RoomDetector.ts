/**
 * RoomDetector
 *
 * Pure function service for detecting enclosed rooms from wall configurations.
 * Uses planar graph cycle detection to find minimal enclosed regions.
 *
 * Algorithm:
 * 1. Build a graph: wall endpoints → nodes, walls → edges
 * 2. Merge nodes within snap tolerance
 * 3. For each node, sort connected edges by angle (atan2)
 * 4. Use "next edge in counter-clockwise order" traversal to find minimal cycles
 * 5. Exclude the outer (infinite) face
 * 6. Compute interior polygons with wall thickness offset
 */

import type {
  Point2D,
  Wall,
  Room,
  GraphNode,
  GraphEdge,
  WallGraph,
  DetectedCycle,
  RoomDetectionResult,
  RoomDetectionOptions,
} from '../../../types';
import { DEFAULT_ROOM_DETECTION_OPTIONS, ROOM_COLORS } from '../../../types/room';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Distance between two points
 */
function distance(a: Point2D, b: Point2D): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

/**
 * Check if two points are within tolerance
 */
function pointsEqual(a: Point2D, b: Point2D, tolerance: number): boolean {
  return distance(a, b) <= tolerance;
}

/**
 * Get angle from point a to point b in radians (-π to π)
 */
function angleTo(from: Point2D, to: Point2D): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/**
 * Normalize angle to [0, 2π)
 */
function normalizeAngle(angle: number): number {
  while (angle < 0) angle += 2 * Math.PI;
  while (angle >= 2 * Math.PI) angle -= 2 * Math.PI;
  return angle;
}

/**
 * Calculate signed area of a polygon (shoelace formula)
 * Positive = counter-clockwise, Negative = clockwise
 */
function signedPolygonArea(vertices: Point2D[]): number {
  if (vertices.length < 3) return 0;

  let area = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += vertices[i].x * vertices[j].y;
    area -= vertices[j].x * vertices[i].y;
  }
  return area / 2;
}

/**
 * Calculate polygon perimeter
 */
function polygonPerimeter(vertices: Point2D[]): number {
  if (vertices.length < 2) return 0;

  let perimeter = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    perimeter += distance(vertices[i], vertices[j]);
  }
  return perimeter;
}

/**
 * Calculate polygon centroid
 */
function polygonCentroid(vertices: Point2D[]): Point2D {
  if (vertices.length === 0) return { x: 0, y: 0 };
  if (vertices.length === 1) return { ...vertices[0] };
  if (vertices.length === 2) {
    return {
      x: (vertices[0].x + vertices[1].x) / 2,
      y: (vertices[0].y + vertices[1].y) / 2,
    };
  }

  let cx = 0;
  let cy = 0;
  let signedArea = 0;
  const n = vertices.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cross = vertices[i].x * vertices[j].y - vertices[j].x * vertices[i].y;
    signedArea += cross;
    cx += (vertices[i].x + vertices[j].x) * cross;
    cy += (vertices[i].y + vertices[j].y) * cross;
  }

  signedArea /= 2;
  if (Math.abs(signedArea) < 0.0001) {
    // Degenerate polygon, use simple average
    const sumX = vertices.reduce((sum, v) => sum + v.x, 0);
    const sumY = vertices.reduce((sum, v) => sum + v.y, 0);
    return { x: sumX / n, y: sumY / n };
  }

  cx /= 6 * signedArea;
  cy /= 6 * signedArea;

  return { x: cx, y: cy };
}

/**
 * Get perpendicular offset vector
 */
function perpendicular(from: Point2D, to: Point2D): Point2D {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.0001) return { x: 0, y: 0 };
  return { x: -dy / len, y: dx / len };
}

// =============================================================================
// Graph Construction
// =============================================================================

/**
 * Build a graph from walls
 */
function buildWallGraph(walls: Wall[], options: RoomDetectionOptions): WallGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const pointToNodeId = new Map<string, string>();

  /**
   * Get or create a node for a point
   */
  function getOrCreateNode(point: Point2D): string {
    // Check for existing nodes within tolerance
    for (const [nodeId, node] of nodes) {
      if (pointsEqual(point, node.position, options.snapTolerance)) {
        return nodeId;
      }
    }

    // Create new node
    const nodeId = `node-${generateId()}`;
    nodes.set(nodeId, {
      id: nodeId,
      position: { ...point },
      connectedEdgeIds: [],
    });
    return nodeId;
  }

  // Create edges for each wall
  for (const wall of walls) {
    const startNodeId = getOrCreateNode(wall.startPoint);
    const endNodeId = getOrCreateNode(wall.endPoint);

    // Skip degenerate walls (start = end)
    if (startNodeId === endNodeId) continue;

    const edge: GraphEdge = {
      id: wall.id,
      wallId: wall.id,
      startNodeId,
      endNodeId,
      angle: angleTo(wall.startPoint, wall.endPoint),
    };

    edges.set(wall.id, edge);

    // Connect edge to nodes
    const startNode = nodes.get(startNodeId)!;
    const endNode = nodes.get(endNodeId)!;
    startNode.connectedEdgeIds.push(wall.id);
    endNode.connectedEdgeIds.push(wall.id);
  }

  return { nodes, edges };
}

// =============================================================================
// Cycle Detection
// =============================================================================

interface HalfEdge {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  angle: number;  // angle from 'from' node to 'to' node
  next: HalfEdge | null;  // next half-edge in CCW order around fromNode
  twin: HalfEdge | null;  // opposite direction half-edge
  visited: boolean;
}

/**
 * Create half-edge data structure for cycle detection
 */
function buildHalfEdges(graph: WallGraph): Map<string, HalfEdge> {
  const halfEdges = new Map<string, HalfEdge>();

  // Create two half-edges for each edge
  for (const [edgeId, edge] of graph.edges) {
    const startNode = graph.nodes.get(edge.startNodeId)!;
    const endNode = graph.nodes.get(edge.endNodeId)!;

    const forwardKey = `${edgeId}-fwd`;
    const backwardKey = `${edgeId}-bwd`;

    const forwardAngle = angleTo(startNode.position, endNode.position);
    const backwardAngle = angleTo(endNode.position, startNode.position);

    const forward: HalfEdge = {
      edgeId,
      fromNodeId: edge.startNodeId,
      toNodeId: edge.endNodeId,
      angle: forwardAngle,
      next: null,
      twin: null,
      visited: false,
    };

    const backward: HalfEdge = {
      edgeId,
      fromNodeId: edge.endNodeId,
      toNodeId: edge.startNodeId,
      angle: backwardAngle,
      next: null,
      twin: null,
      visited: false,
    };

    forward.twin = backward;
    backward.twin = forward;

    halfEdges.set(forwardKey, forward);
    halfEdges.set(backwardKey, backward);
  }

  // For each node, sort outgoing half-edges by angle and link them in CCW order
  for (const [nodeId, node] of graph.nodes) {
    // Get all half-edges leaving this node
    const outgoing: HalfEdge[] = [];
    for (const [key, he] of halfEdges) {
      if (he.fromNodeId === nodeId) {
        outgoing.push(he);
      }
    }

    if (outgoing.length < 2) continue;

    // Sort by angle (CCW = increasing angle)
    outgoing.sort((a, b) => normalizeAngle(a.angle) - normalizeAngle(b.angle));

    // Link: for each incoming half-edge (he.twin arrives at this node),
    // the "next" outgoing half-edge is the one immediately CCW from the incoming direction
    for (const he of halfEdges.values()) {
      if (he.toNodeId === nodeId) {
        // Find the incoming angle (opposite of he.twin.angle)
        const incomingAngle = normalizeAngle(he.angle + Math.PI);

        // Find the next CCW half-edge
        // This is the first edge with angle > incomingAngle, wrapping around
        let nextHe: HalfEdge | null = null;
        for (const out of outgoing) {
          const outAngle = normalizeAngle(out.angle);
          if (outAngle > incomingAngle) {
            nextHe = out;
            break;
          }
        }
        if (!nextHe) {
          nextHe = outgoing[0];  // Wrap around to smallest angle
        }

        he.next = nextHe;
      }
    }
  }

  return halfEdges;
}

/**
 * Find all minimal cycles (faces) in the planar graph
 */
function findAllCycles(graph: WallGraph, halfEdges: Map<string, HalfEdge>): DetectedCycle[] {
  const cycles: DetectedCycle[] = [];

  for (const [key, startHe] of halfEdges) {
    if (startHe.visited) continue;

    // Trace the cycle
    const edgeIds: string[] = [];
    const nodeIds: string[] = [];
    let current: HalfEdge | null = startHe;
    const cycleVertices: Point2D[] = [];

    let safety = 1000;  // Prevent infinite loops
    while (current && !current.visited && safety > 0) {
      current.visited = true;
      edgeIds.push(current.edgeId);
      nodeIds.push(current.fromNodeId);

      const fromNode = graph.nodes.get(current.fromNodeId);
      if (fromNode) {
        cycleVertices.push(fromNode.position);
      }

      current = current.next;
      safety--;

      // Check if we've returned to start
      if (current === startHe) break;
    }

    if (edgeIds.length >= 3 && current === startHe) {
      const signedArea = signedPolygonArea(cycleVertices);
      cycles.push({
        edgeIds,
        nodeIds,
        isClockwise: signedArea < 0,
        signedArea,
      });
    }
  }

  return cycles;
}

// =============================================================================
// Room Polygon Computation
// =============================================================================

/**
 * Compute interior room polygon by offsetting walls inward
 */
function computeRoomPolygon(
  cycle: DetectedCycle,
  walls: Map<string, Wall>,
  graph: WallGraph
): Point2D[] {
  const vertices: Point2D[] = [];

  for (let i = 0; i < cycle.nodeIds.length; i++) {
    const nodeId = cycle.nodeIds[i];
    const node = graph.nodes.get(nodeId);
    if (!node) continue;

    // Get the two walls meeting at this node (in the cycle)
    const prevEdgeIdx = (i - 1 + cycle.edgeIds.length) % cycle.edgeIds.length;
    const currEdgeIdx = i;

    const prevWallId = cycle.edgeIds[prevEdgeIdx];
    const currWallId = cycle.edgeIds[currEdgeIdx];

    const prevWall = walls.get(prevWallId);
    const currWall = walls.get(currWallId);

    if (!prevWall || !currWall) {
      vertices.push(node.position);
      continue;
    }

    // Calculate offset direction for each wall
    // We need to offset toward the interior of the room
    const prevDir = {
      x: prevWall.endPoint.x - prevWall.startPoint.x,
      y: prevWall.endPoint.y - prevWall.startPoint.y,
    };
    const currDir = {
      x: currWall.endPoint.x - currWall.startPoint.x,
      y: currWall.endPoint.y - currWall.startPoint.y,
    };

    // Perpendicular vectors (pointing to the left of direction)
    const prevPerp = perpendicular(prevWall.startPoint, prevWall.endPoint);
    const currPerp = perpendicular(currWall.startPoint, currWall.endPoint);

    // For clockwise cycles, interior is on the right (negative perp)
    // For counter-clockwise cycles, interior is on the left (positive perp)
    const sign = cycle.isClockwise ? -1 : 1;

    const prevOffset = prevWall.thickness / 2;
    const currOffset = currWall.thickness / 2;

    // Offset the node position
    // Simple approach: average the two perpendicular directions
    const avgPerpX = (prevPerp.x + currPerp.x) / 2;
    const avgPerpY = (prevPerp.y + currPerp.y) / 2;
    const avgLen = Math.sqrt(avgPerpX * avgPerpX + avgPerpY * avgPerpY);

    if (avgLen > 0.001) {
      const avgOffset = (prevOffset + currOffset) / 2;
      vertices.push({
        x: node.position.x + sign * avgPerpX / avgLen * avgOffset,
        y: node.position.y + sign * avgPerpY / avgLen * avgOffset,
      });
    } else {
      vertices.push(node.position);
    }
  }

  return vertices;
}

// =============================================================================
// Main Detection Function
// =============================================================================

/**
 * Detect rooms from walls
 *
 * @param walls - Array of walls to analyze
 * @param options - Detection options (optional)
 * @returns RoomDetectionResult with detected rooms and statistics
 */
export function detectRooms(
  walls: Wall[],
  options: Partial<RoomDetectionOptions> = {}
): RoomDetectionResult {
  const startTime = performance.now();
  const opts = { ...DEFAULT_ROOM_DETECTION_OPTIONS, ...options };
  const warnings: string[] = [];
  const rooms: Room[] = [];

  // Handle empty input
  if (walls.length < 3) {
    return {
      rooms: [],
      warnings: walls.length > 0 ? ['Not enough walls to form a room (minimum 3)'] : [],
      stats: {
        totalNodes: 0,
        totalEdges: walls.length,
        cyclesFound: 0,
        roomsCreated: 0,
        executionTimeMs: performance.now() - startTime,
      },
    };
  }

  // Build graph
  const graph = buildWallGraph(walls, opts);

  // Build half-edge structure
  const halfEdges = buildHalfEdges(graph);

  // Find all cycles
  const cycles = findAllCycles(graph, halfEdges);

  // Create wall lookup map
  const wallsById = new Map(walls.map(w => [w.id, w]));

  // Filter and process cycles into rooms
  let roomCount = 0;
  for (const cycle of cycles) {
    // Compute room polygon
    const polygon = computeRoomPolygon(cycle, wallsById, graph);
    if (polygon.length < 3) {
      warnings.push(`Cycle produced degenerate polygon (< 3 vertices)`);
      continue;
    }

    // Calculate area (in m², converting from mm²)
    const areaMm2 = Math.abs(signedPolygonArea(polygon));
    const areaM2 = areaMm2 / 1_000_000;

    // Filter by area
    if (areaM2 < opts.minRoomArea) {
      continue;  // Too small
    }
    if (areaM2 > opts.maxRoomArea) {
      // This is likely the outer face (infinite face)
      continue;
    }

    // Calculate perimeter (in m, converting from mm)
    const perimeterMm = polygonPerimeter(polygon);
    const perimeterM = perimeterMm / 1000;

    // Calculate centroid
    const centroid = polygonCentroid(polygon);

    // Create room
    const room: Room = {
      id: `room-${generateId()}`,
      name: `Room ${roomCount + 1}`,
      boundaryWallIds: cycle.edgeIds,
      boundaryPolygon: polygon,
      area: Math.round(areaM2 * 100) / 100,  // Round to 2 decimal places
      perimeter: Math.round(perimeterM * 100) / 100,
      centroid,
      floorLevel: 0,
      properties3D: null,
      furnitureIds: [],
      hvacEquipmentIds: [],
      color: ROOM_COLORS[roomCount % ROOM_COLORS.length],
      userOverride: null,
    };

    rooms.push(room);
    roomCount++;
  }

  const endTime = performance.now();

  return {
    rooms,
    warnings,
    stats: {
      totalNodes: graph.nodes.size,
      totalEdges: graph.edges.size,
      cyclesFound: cycles.length,
      roomsCreated: rooms.length,
      executionTimeMs: endTime - startTime,
    },
  };
}

/**
 * Merge detected rooms with previous rooms, preserving user overrides
 */
export function mergeRoomDetections(
  newRooms: Room[],
  previousRooms: Room[]
): Room[] {
  // Build lookup for previous rooms by boundary signature
  const prevBySignature = new Map<string, Room>();
  for (const room of previousRooms) {
    const signature = createBoundarySignature(room.boundaryWallIds);
    prevBySignature.set(signature, room);
  }

  // Merge rooms
  return newRooms.map(newRoom => {
    const signature = createBoundarySignature(newRoom.boundaryWallIds);
    const prevRoom = prevBySignature.get(signature);

    if (prevRoom) {
      // Preserve user data from previous room
      return {
        ...newRoom,
        id: prevRoom.id,  // Keep same ID
        name: prevRoom.userOverride?.customName || prevRoom.name,
        color: prevRoom.color,
        userOverride: prevRoom.userOverride,
        furnitureIds: prevRoom.furnitureIds,
        hvacEquipmentIds: prevRoom.hvacEquipmentIds,
      };
    }

    return newRoom;
  });
}

/**
 * Create a signature for a room's boundary (for comparison)
 */
function createBoundarySignature(wallIds: string[]): string {
  // Sort IDs to make comparison order-independent
  const sorted = [...wallIds].sort();
  return sorted.join('|');
}

// =============================================================================
// Export
// =============================================================================

export type { RoomDetectionResult, RoomDetectionOptions };
