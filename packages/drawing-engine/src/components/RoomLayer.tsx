import { useMemo, useState } from 'react';
import { Group, Layer, Line, Shape } from 'react-konva';

import { getRoomHoles, useRoomStore } from '../store/roomStore';
import type { DetectedRoom } from '../types/room';
import { darkenHex } from '../utils/roomDetection';
import { RoomTag } from './RoomTag';

export interface RoomLayerProps {
  rooms?: DetectedRoom[] | Map<string, DetectedRoom>;
  zoom: number;
  areaScaleFactor?: number;
  onRoomSelect?: (room: DetectedRoom) => void;
}

function flattenPoints(points: Array<{ x: number; y: number }>): number[] {
  return points.flatMap((point) => [point.x, point.y]);
}

function drawPolygonPath(context: CanvasRenderingContext2D, polygon: Array<{ x: number; y: number }>): void {
  if (polygon.length === 0) return;
  const first = polygon[0];
  if (!first) return;
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (let i = 1; i < polygon.length; i++) {
    const point = polygon[i];
    if (!point) continue;
    context.lineTo(point.x, point.y);
  }
  context.closePath();
}

export function RoomLayer({ rooms, zoom, areaScaleFactor, onRoomSelect }: RoomLayerProps) {
  const storeRooms = useRoomStore((state) => state.rooms);
  const pinLabelTag = useRoomStore((state) => state.pinLabelTag);
  const [hoveredRoomId, setHoveredRoomId] = useState<string | null>(null);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);

  const roomList = useMemo(() => {
    if (Array.isArray(rooms)) return rooms;
    if (rooms instanceof Map) return Array.from(rooms.values());
    return Array.from(storeRooms.values());
  }, [rooms, storeRooms]);

  const sortedRooms = useMemo(
    () => [...roomList].sort((a, b) => a.depth - b.depth || b.area - a.area),
    [roomList]
  );

  return (
    <Layer listening>
      {sortedRooms.map((room) => {
        if (!room.labelTag.visible) return null;
        const isHovered = hoveredRoomId === room.id;
        const isActive = activeRoomId === room.id || room.isActive;
        const fillOpacity = isHovered ? 0.3 : room.depth > 0 ? 0.25 : 0.15;
        const strokeColor = isActive ? darkenHex(room.color, 25) : room.color;
        const strokeWidth = isActive ? 2 : 1.5;
        const holePolygons = getRoomHoles(room.id);

        return (
          <Group key={room.id}>
            <Shape
              sceneFunc={(context, shape) => {
                drawPolygonPath(context as unknown as CanvasRenderingContext2D, room.polygon);
                context.fillStrokeShape(shape);
              }}
              fill={room.color}
              opacity={fillOpacity}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              dash={isHovered ? [6, 4] : undefined}
              onMouseEnter={() => setHoveredRoomId(room.id)}
              onMouseLeave={() => setHoveredRoomId((current) => (current === room.id ? null : current))}
              onClick={() => {
                setActiveRoomId(room.id);
                onRoomSelect?.(room);
              }}
            />

            {holePolygons.map((hole, holeIndex) => (
              <Shape
                key={`${room.id}-hole-${holeIndex}`}
                listening={false}
                globalCompositeOperation="destination-out"
                fill="#000000"
                sceneFunc={(context, shape) => {
                  drawPolygonPath(context as unknown as CanvasRenderingContext2D, hole);
                  context.fillStrokeShape(shape);
                }}
              />
            ))}

            {holePolygons.map((hole, holeIndex) => (
              <Line
                key={`${room.id}-hole-outline-${holeIndex}`}
                points={flattenPoints(hole)}
                closed
                stroke={darkenHex(room.color, 20)}
                strokeWidth={1}
                dash={[4, 4]}
                listening={false}
              />
            ))}

            {room.depth > 0 && (
              <Line
                points={flattenPoints(room.polygon)}
                closed
                stroke={darkenHex(room.color, 20)}
                strokeWidth={1}
                dash={[4, 4]}
                listening={false}
              />
            )}

            <RoomTag
              room={room}
              zoom={zoom}
              areaScaleFactor={areaScaleFactor}
              onPin={pinLabelTag}
            />
          </Group>
        );
      })}
    </Layer>
  );
}

