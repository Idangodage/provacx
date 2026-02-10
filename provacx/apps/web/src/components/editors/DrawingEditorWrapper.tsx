"use client";

/**
 * Drawing Editor Wrapper
 * Thin wrapper around @provacx/drawing-engine for app-specific integration
 */

import { SmartDrawingEditor } from "@provacx/drawing-engine";
import { ArrowLeft, ArrowRight, Share2 } from "lucide-react";
import Link from "next/link";

interface DrawingEditorWrapperProps {
  projectId: string;
  projectName?: string;
  initialData?: unknown;
}

export default function DrawingEditorWrapper({
  projectId,
  projectName,
  initialData,
}: DrawingEditorWrapperProps) {
  const handleSave = async (data: unknown) => {
    // Save to localStorage for now
    localStorage.setItem(
      `provacx-drawing-data-${projectId}`,
      JSON.stringify({
        data,
        savedAt: new Date().toISOString(),
      })
    );
    // TODO: Implement save to database via tRPC
    console.log("Saving drawing...", data);
  };

  const handleDataChange = (data: unknown) => {
    // Auto-save could be implemented here with debouncing
    console.log("Drawing data changed", data);
  };

  return (
    <div className="h-screen w-full flex flex-col bg-[#f6f1e7]">
      {/* Navigation Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-amber-200/70">
        <div className="flex items-center gap-4">
          <Link
            href={`/projects/${projectId}`}
            className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft size={16} />
            Back to Project
          </Link>
          <div className="hidden sm:block h-6 w-px bg-amber-200/80" />
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-400 text-amber-950 text-xs font-bold">
              PX
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-slate-900">ProvacX SmartDraw</div>
              <div className="text-xs text-slate-500">HVAC smart drawing</div>
            </div>
          </div>
          <nav className="hidden lg:flex items-center gap-2 text-sm text-slate-600">
            {[
              "File",
              "Home",
              "Design",
              "Page",
              "Table",
              "Options",
              "Support",
            ].map((item) => (
              <button
                key={item}
                type="button"
                className={`px-2 py-1 rounded-md transition-colors ${
                  item === "Home"
                    ? "bg-amber-100 text-amber-900"
                    : "hover:bg-amber-50 hover:text-slate-900"
                }`}
              >
                {item}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-2 text-xs text-slate-500">
            <span className="px-2 py-1 rounded-full border border-amber-200/80 bg-amber-50">
              {projectName || "Untitled Document"}
            </span>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm border border-amber-200/80 rounded-md text-slate-700 hover:bg-amber-50"
          >
            <Share2 size={16} />
            Share
          </button>
          <Link
            href={`/projects/${projectId}/boq`}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-amber-400 text-amber-950 rounded-md hover:bg-amber-300"
          >
            Next: BOQ
            <ArrowRight size={16} />
          </Link>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <SmartDrawingEditor
          projectId={projectId}
          initialData={initialData}
          onDataChange={handleDataChange}
          onSave={handleSave}
          className="h-full"
        />
      </div>
    </div>
  );
}
