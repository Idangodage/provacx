/**
 * Room Hierarchy Panel
 *
 * Tree view and interactions for nested room management.
 */

'use client';

import { ChevronDown, ChevronRight, Eye, EyeOff, FolderTree, Pencil, Trash2 } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

import { useSmartDrawingStore } from '../store';
import type { Room2D } from '../types';

export interface RoomHierarchyPanelProps {
  className?: string;
}

interface RoomTreeNode {
  room: Room2D;
  children: RoomTreeNode[];
}

interface RoomContextMenuState {
  roomId: string;
  x: number;
  y: number;
}

function buildRoomTree(rooms: Room2D[]): RoomTreeNode[] {
  const byId = new Map<string, Room2D>();
  rooms.forEach((room) => byId.set(room.id, room));

  const childrenByParent = new Map<string | null, Room2D[]>();
  rooms.forEach((room) => {
    const parentId = room.parentRoomId && byId.has(room.parentRoomId) ? room.parentRoomId : null;
    const bucket = childrenByParent.get(parentId) ?? [];
    bucket.push(room);
    childrenByParent.set(parentId, bucket);
  });

  const sortRooms = (source: Room2D[]) => {
    return [...source].sort((a, b) => {
      const ac = centroid(a.vertices);
      const bc = centroid(b.vertices);
      if (Math.abs(ac.y - bc.y) > 1e-6) return ac.y - bc.y;
      if (Math.abs(ac.x - bc.x) > 1e-6) return ac.x - bc.x;
      return a.name.localeCompare(b.name);
    });
  };

  const buildNodes = (parentId: string | null): RoomTreeNode[] => {
    const localRooms = sortRooms(childrenByParent.get(parentId) ?? []);
    return localRooms.map((room) => ({
      room,
      children: buildNodes(room.id),
    }));
  };

  return buildNodes(null);
}

function centroid(vertices: Room2D['vertices']) {
  if (vertices.length === 0) return { x: 0, y: 0 };
  const sum = vertices.reduce(
    (acc, vertex) => ({ x: acc.x + vertex.x, y: acc.y + vertex.y }),
    { x: 0, y: 0 }
  );
  return { x: sum.x / vertices.length, y: sum.y / vertices.length };
}

function formatArea(areaSqm: number): string {
  return `${areaSqm.toFixed(areaSqm >= 10 ? 1 : 2)} m²`;
}

function formatLabel(room: Room2D): string {
  const netArea = Number.isFinite(room.netArea) ? room.netArea : room.area;
  return `${room.name} (${formatArea(netArea)})`;
}

export function RoomHierarchyPanel({ className = '' }: RoomHierarchyPanelProps) {
  const {
    rooms,
    selectedElementIds,
    setSelectedIds,
    updateRoom,
    reparentRoom,
    deleteSelectedElements,
  } = useSmartDrawingStore();

  const roomById = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms]);
  const tree = useMemo(() => buildRoomTree(rooms), [rooms]);
  const selectedRoomId = selectedElementIds.find((id) => roomById.has(id)) ?? null;
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [dragRoomId, setDragRoomId] = useState<string | null>(null);
  const [dropRoomId, setDropRoomId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<RoomContextMenuState | null>(null);

  useEffect(() => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      rooms
        .filter((room) => room.childRoomIds.length > 0)
        .forEach((room) => next.add(room.id));
      return next;
    });
  }, [rooms]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
    };
  }, [contextMenu]);

  const toggleExpanded = (roomId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(roomId)) {
        next.delete(roomId);
      } else {
        next.add(roomId);
      }
      return next;
    });
  };

  const handleDrop = (targetParentId: string | null) => {
    if (!dragRoomId) return;
    if (dragRoomId === targetParentId) return;
    const dropped = reparentRoom(dragRoomId, targetParentId);
    if (!dropped) {
      setErrorMessage(
        'Cannot reparent this room. Keep the child fully inside the target room with no overlap.'
      );
      return;
    }
    setErrorMessage(null);
    setDragRoomId(null);
    setDropRoomId(null);
  };

  const runDeleteRoom = (roomId: string) => {
    setSelectedIds([roomId]);
    deleteSelectedElements();
  };

  const renderNode = (node: RoomTreeNode, depth: number): React.ReactNode => {
    const room = node.room;
    const isExpanded = expandedIds.has(room.id);
    const isSelected = selectedRoomId === room.id;
    const hasChildren = node.children.length > 0;
    const isDropTarget = dropRoomId === room.id && dragRoomId !== null && dragRoomId !== room.id;

    return (
      <div key={room.id}>
        <div
          className={`group flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs transition-colors ${
            isSelected
              ? 'border-amber-400 bg-amber-100/90 text-amber-900'
              : isDropTarget
              ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
              : 'border-transparent hover:bg-amber-50 text-slate-700'
          }`}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
          draggable
          onDragStart={() => {
            setDragRoomId(room.id);
            setDropRoomId(null);
          }}
          onDragEnd={() => {
            setDragRoomId(null);
            setDropRoomId(null);
          }}
          onDragOver={(event) => {
            if (!dragRoomId || dragRoomId === room.id) return;
            event.preventDefault();
            setDropRoomId(room.id);
          }}
          onDragLeave={() => {
            if (dropRoomId === room.id) setDropRoomId(null);
          }}
          onDrop={(event) => {
            event.preventDefault();
            handleDrop(room.id);
          }}
          onClick={() => {
            setSelectedIds([room.id]);
            setErrorMessage(null);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            setContextMenu({ roomId: room.id, x: event.clientX, y: event.clientY });
          }}
        >
          <button
            type="button"
            className="flex h-4 w-4 items-center justify-center rounded text-slate-500 hover:bg-amber-100"
            onClick={(event) => {
              event.stopPropagation();
              if (hasChildren) toggleExpanded(room.id);
            }}
          >
            {hasChildren ? (
              isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
            ) : (
              <span className="block h-2 w-2 rounded-full bg-slate-300" />
            )}
          </button>
          <span className="truncate">{formatLabel(room)}</span>
          {room.showTag === false ? (
            <EyeOff size={12} className="ml-auto text-slate-400" />
          ) : (
            <Eye size={12} className="ml-auto text-slate-400 opacity-0 group-hover:opacity-100" />
          )}
        </div>
        {hasChildren && isExpanded && (
          <div className="mt-0.5 space-y-0.5">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const contextRoom = contextMenu ? roomById.get(contextMenu.roomId) : undefined;

  return (
    <div className={`rounded-xl border border-amber-200/80 bg-white/80 p-3 ${className}`}>
      <div className="mb-2 flex items-center gap-2">
        <FolderTree size={14} className="text-slate-500" />
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Room Hierarchy</p>
      </div>

      <div
        className={`mb-2 rounded-md border px-2 py-1 text-[11px] ${
          dropRoomId === '__root__'
            ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
            : 'border-amber-200/80 bg-amber-50/60 text-slate-600'
        }`}
        onDragOver={(event) => {
          if (!dragRoomId) return;
          event.preventDefault();
          setDropRoomId('__root__');
        }}
        onDragLeave={() => {
          if (dropRoomId === '__root__') setDropRoomId(null);
        }}
        onDrop={(event) => {
          event.preventDefault();
          handleDrop(null);
        }}
      >
        Drop here to make room top-level
      </div>

      {errorMessage && (
        <div className="mb-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
          {errorMessage}
        </div>
      )}

      <div className="max-h-72 overflow-y-auto space-y-0.5 pr-1">
        {tree.length === 0 && (
          <div className="rounded-md border border-dashed border-amber-200/80 px-3 py-4 text-center text-xs text-slate-500">
            Draw closed wall loops to generate rooms.
          </div>
        )}
        {tree.map((node) => renderNode(node, 0))}
      </div>

      {contextMenu && contextRoom && (
        <div
          className="fixed z-[70] min-w-48 rounded-md border border-slate-200 bg-white p-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
            onClick={() => {
              const name = window.prompt('Room name', contextRoom.name);
              if (typeof name === 'string' && name.trim().length > 0) {
                updateRoom(contextRoom.id, { name: name.trim() });
              }
              setContextMenu(null);
            }}
          >
            <Pencil size={12} />
            Rename
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
            onClick={() => {
              updateRoom(contextRoom.id, { showTag: contextRoom.showTag === false });
              setContextMenu(null);
            }}
          >
            {contextRoom.showTag === false ? <Eye size={12} /> : <EyeOff size={12} />}
            {contextRoom.showTag === false ? 'Show Tag' : 'Hide Tag'}
          </button>
          <label className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50">
            <span className="inline-block h-3 w-3 rounded border border-slate-300" style={{ backgroundColor: contextRoom.color ?? '#cbd5e1' }} />
            <span>Change Color</span>
            <input
              type="color"
              className="ml-auto h-5 w-8 cursor-pointer rounded border border-slate-300 bg-white p-0"
              value={contextRoom.color ?? '#cbd5e1'}
              onChange={(event) => updateRoom(contextRoom.id, { color: event.target.value })}
            />
          </label>
          {contextRoom.parentRoomId && (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
              onClick={() => {
                reparentRoom(contextRoom.id, null);
                setContextMenu(null);
              }}
            >
              <FolderTree size={12} />
              Move To Top Level
            </button>
          )}
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-rose-700 hover:bg-rose-50"
            onClick={() => {
              runDeleteRoom(contextRoom.id);
              setContextMenu(null);
            }}
          >
            <Trash2 size={12} />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

export default RoomHierarchyPanel;
