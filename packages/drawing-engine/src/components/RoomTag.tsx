import Konva from 'konva';
import { useEffect, useMemo, useRef } from 'react';
import { Circle, Group, Rect, Text } from 'react-konva';

import type { DetectedRoom } from '../types/room';

export interface RoomTagProps {
  room: DetectedRoom;
  zoom: number;
  areaScaleFactor?: number;
  onPin: (roomId: string, position: { x: number; y: number }) => void;
}

function estimateTextWidth(text: string, fontSize: number, bold = false): number {
  const weightFactor = bold ? 0.64 : 0.58;
  return Math.max(1, text.length) * fontSize * weightFactor;
}

export function RoomTag({ room, zoom, areaScaleFactor, onPin }: RoomTagProps) {
  const groupRef = useRef<Konva.Group>(null);
  const textBlock = useMemo(() => {
    const areaLine = Number.isFinite(areaScaleFactor) && (areaScaleFactor ?? 0) > 0
      ? `${(room.area * (areaScaleFactor ?? 1) * (areaScaleFactor ?? 1)).toFixed(1)} m²`
      : `${room.area.toFixed(1)} px²`;
    return {
      title: room.depth > 0 ? `  ${room.name}` : room.name,
      subtitle: areaLine,
    };
  }, [room.area, room.depth, room.name, areaScaleFactor]);

  useEffect(() => {
    const node = groupRef.current;
    if (!node) return;
    node.opacity(0);
    const tween = new Konva.Tween({
      node,
      duration: 0.2,
      opacity: 1,
      easing: Konva.Easings.EaseOut,
    });
    tween.play();
    return () => tween.destroy();
  }, [room.id]);

  if (!room.labelTag.visible || zoom < 0.4) {
    return null;
  }

  const baseFontSize = Math.max(10, room.depth > 0 ? room.labelTag.fontSize - 1 : room.labelTag.fontSize);
  const titleFontSize = baseFontSize;
  const subtitleFontSize = Math.max(10, baseFontSize - 1);
  const horizontalPadding = 8;
  const verticalPadding = 6;
  const dotOffset = 12;
  const titleWidth = estimateTextWidth(textBlock.title, titleFontSize, true);
  const subtitleWidth = estimateTextWidth(textBlock.subtitle, subtitleFontSize);
  const contentWidth = Math.max(titleWidth, subtitleWidth);
  const boxWidth = contentWidth + horizontalPadding * 2 + dotOffset;
  const titleLineHeight = titleFontSize * 1.2;
  const subtitleLineHeight = subtitleFontSize * 1.2;
  const boxHeight = verticalPadding * 2 + titleLineHeight + subtitleLineHeight;
  const textX = horizontalPadding + dotOffset;
  const titleY = verticalPadding;
  const subtitleY = verticalPadding + titleLineHeight;

  return (
    <Group
      ref={groupRef}
      x={room.labelTag.position.x}
      y={room.labelTag.position.y}
      draggable
      onDragEnd={(event) => {
        onPin(room.id, { x: event.target.x(), y: event.target.y() });
      }}
    >
      <Rect
        x={-boxWidth / 2}
        y={-boxHeight / 2}
        width={boxWidth}
        height={boxHeight}
        cornerRadius={4}
        fill="#FFFFFF"
        opacity={0.9}
        shadowColor="#0F172A"
        shadowOpacity={0.2}
        shadowBlur={4}
        shadowOffset={{ x: 0, y: 1 }}
      />
      <Circle x={-boxWidth / 2 + horizontalPadding + 4} y={0} radius={4} fill={room.color} />
      <Text
        x={-boxWidth / 2 + textX}
        y={-boxHeight / 2 + titleY}
        text={textBlock.title}
        fontSize={titleFontSize}
        fontStyle="bold"
        fill="#0F172A"
      />
      <Text
        x={-boxWidth / 2 + textX}
        y={-boxHeight / 2 + subtitleY}
        text={textBlock.subtitle}
        fontSize={subtitleFontSize}
        fill="#334155"
      />
    </Group>
  );
}

