/**
 * HoveredRoomTooltip Component
 *
 * Tooltip that displays room information when hovering over a room.
 */

'use client';

import type { DisplayUnit } from '../../../types';
import { formatRoomArea, formatRoomPerimeter } from '../roomRendering';

export interface HoveredRoomInfo {
    id: string;
    name: string;
    area: number;
    perimeter: number;
    screenX: number;
    screenY: number;
}

export interface HoveredRoomTooltipProps {
    roomInfo: HoveredRoomInfo;
    displayUnit: DisplayUnit;
}

export function HoveredRoomTooltip({ roomInfo, displayUnit }: HoveredRoomTooltipProps) {
    return (
        <div
            className="pointer-events-none absolute z-[35] rounded-md border border-slate-300/90 bg-white/95 px-2 py-1.5 shadow-md"
            style={{
                left: roomInfo.screenX,
                top: roomInfo.screenY,
            }}
        >
            <div className="text-[11px] font-semibold text-slate-800">{roomInfo.name}</div>
            <div className="text-[10px] text-slate-600">
                Area: {formatRoomArea(roomInfo.area, displayUnit)}
            </div>
            <div className="text-[10px] text-slate-600">
                Perim: {formatRoomPerimeter(roomInfo.perimeter, displayUnit)}
            </div>
        </div>
    );
}

export default HoveredRoomTooltip;
