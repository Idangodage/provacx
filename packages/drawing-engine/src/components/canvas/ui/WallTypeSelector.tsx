/**
 * WallTypeSelector Component
 *
 * UI panel for selecting and creating wall types during wall/room drawing.
 */

'use client';

import type { WallTypeDefinition } from '../../../types';

export interface WallTypeSelectorProps {
    wallTypeRegistry: WallTypeDefinition[];
    activeWallTypeId: string;
    onSelectWallType: (id: string) => void;
    onCreateCustomType: () => void;
}

export function WallTypeSelector({
    wallTypeRegistry,
    activeWallTypeId,
    onSelectWallType,
    onCreateCustomType,
}: WallTypeSelectorProps) {
    return (
        <div className="absolute right-3 top-3 z-[30] max-h-[60vh] w-72 overflow-y-auto rounded-lg border border-slate-300/80 bg-white/95 p-2 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Wall Type
                </span>
                <button
                    type="button"
                    onClick={onCreateCustomType}
                    className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 transition-colors hover:border-blue-400 hover:text-blue-700"
                    title="Create custom wall type"
                >
                    + Custom
                </button>
            </div>
            <div className="space-y-1.5">
                {wallTypeRegistry.map((wallType, index) => {
                    const isActive = wallType.id === activeWallTypeId;
                    return (
                        <button
                            key={wallType.id}
                            type="button"
                            onClick={() => onSelectWallType(wallType.id)}
                            className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${
                                isActive
                                    ? 'border-blue-500 bg-blue-50'
                                    : 'border-slate-300/80 bg-white hover:border-slate-400'
                            }`}
                        >
                            <WallTypePreview wallType={wallType} />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-[11px] font-semibold text-slate-700">
                                    {wallType.name}
                                </div>
                                <div className="text-[10px] text-slate-500">
                                    {Math.round(wallType.totalThickness)} mm
                                    {index < 6 ? ` | Alt+${index + 1}` : ''}
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

interface WallTypePreviewProps {
    wallType: WallTypeDefinition;
}

function WallTypePreview({ wallType }: WallTypePreviewProps) {
    return (
        <div className="h-10 w-5 overflow-hidden rounded-sm border border-slate-300/80">
            {wallType.layers.map((layer) => {
                const ratio =
                    wallType.totalThickness > 0
                        ? (layer.thickness / wallType.totalThickness) * 100
                        : 0;
                return (
                    <div
                        key={layer.id}
                        style={{
                            height: `${Math.max(ratio, 4)}%`,
                            backgroundColor: layer.color || '#d1d5db',
                        }}
                        title={`${layer.name} (${layer.thickness} mm)`}
                    />
                );
            })}
        </div>
    );
}

export default WallTypeSelector;
