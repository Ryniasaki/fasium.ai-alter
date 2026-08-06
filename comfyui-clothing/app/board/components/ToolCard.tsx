"use client"

import type { Tool } from "../types"
import { IconRenderer } from "./IconRenderer"

interface ToolCardProps {
  tool: Tool
  onClick: () => void
}

export function ToolCard({ tool, onClick }: ToolCardProps) {
  return (
    <div
      onClick={onClick}
      className="group relative bg-white rounded-[2rem] p-3 border border-transparent hover:border-blue-100 transition-all duration-500 flex flex-col cursor-pointer hover:shadow-[0_30px_60px_rgba(0,0,0,0.05)]"
    >
      <div className={`aspect-[1.3/1] rounded-[1.75rem] ${tool.gradient} flex items-center justify-center relative overflow-hidden`}>
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_1px_1px,_rgba(255,255,255,0.15)_1px,_transparent_0)] [background-size:16px_16px]" />

        <div className="relative z-10 w-20 h-20 bg-white/10 backdrop-blur-xl rounded-2xl border border-white/20 flex items-center justify-center transform group-hover:scale-110 transition-transform duration-700 shadow-lg">
          <IconRenderer name={tool.icon} size={32} className="text-white" />
        </div>

        <div className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/10 transition-all duration-500 flex items-center justify-center">
          <div className="bg-white/90 backdrop-blur-md text-slate-950 px-6 py-2 rounded-full font-bold text-xs shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500">
            开始创作
          </div>
        </div>
      </div>

      <div className="px-5 py-6 flex flex-col flex-1">
        <div className="flex items-center gap-2 mb-4">
          <span className="px-2.5 py-1 rounded-md bg-blue-50/50 text-[10px] font-bold text-blue-400 uppercase tracking-tight">
            {tool.tag}
          </span>
          {tool.isPopular && (
            <span className="px-2.5 py-1 rounded-md bg-amber-50 text-[10px] font-bold text-amber-500 uppercase tracking-tight">
              POPULAR
            </span>
          )}
        </div>

        <h3 className="text-xl font-bold text-slate-900 mb-3 group-hover:text-blue-600 transition-colors">
          {tool.name}
        </h3>

        <p className="text-[13px] text-slate-400 leading-relaxed font-medium">{tool.description}</p>
      </div>
    </div>
  )
}
