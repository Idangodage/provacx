/**
 * RoomModeSelector Component
 *
 * UI dropdown for selecting room drawing mode (rectangle or polygon).
 */

'use client';

export type RoomDrawMode = 'rectangle' | 'polygon';

export interface RoomModeSelectorProps {
    roomDrawMode: RoomDrawMode;
    onModeChange: (mode: RoomDrawMode) => void;
}

export function RoomModeSelector({ roomDrawMode, onModeChange }: RoomModeSelectorProps) {
    return (
        <div className="absolute left-3 top-3 z-[30] rounded-lg border border-slate-300/80 bg-white/95 px-2 py-1.5 shadow-sm">
            <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <span>Room Mode</span>
                <select
                    value={roomDrawMode}
                    onChange={(event) => onModeChange(event.target.value as RoomDrawMode)}
                    className="h-6 rounded border border-slate-300 bg-white px-1.5 text-[11px] font-medium normal-case text-slate-700 outline-none focus:border-blue-400"
                >
                    <option value="rectangle">Rectangle</option>
                    <option value="polygon">Polygon</option>
                </select>
            </label>
        </div>
    );
}

export default RoomModeSelector;
