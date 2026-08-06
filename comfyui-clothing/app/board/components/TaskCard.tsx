"use client"

import type { Task } from "../types"
import { IconRenderer } from "./IconRenderer"
import { WatermarkOverlay } from "@/app/components/watermark-overlay"

interface TaskCardProps {
  task: Task
}

export function TaskCard({ task }: TaskCardProps) {
  const isGrid = task.images.length > 1

  return (
    <div className="group flex flex-col space-y-4">
      <div className="relative aspect-[3/4] rounded-[2rem] overflow-hidden bg-slate-50 border border-slate-100 transition-all duration-500 group-hover:shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)]">
        {isGrid ? (
          <div className="grid grid-cols-2 grid-rows-2 h-full gap-1 p-1 bg-white">
            {task.images.map((img, idx) => (
              <div key={img + idx} style={{ position: "relative", lineHeight: 0 }}>
                <img src={img} alt="" className="w-full h-full object-cover rounded-2xl" />
                <WatermarkOverlay />
              </div>
            ))}
          </div>
        ) : (
          <div style={{ position: "relative", width: "100%", height: "100%", lineHeight: 0 }}>
            <img src={task.images[0]} alt="" className="w-full h-full object-cover" />
            <WatermarkOverlay />
          </div>
        )}

        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-all duration-500 flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer">
          <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-xl transform translate-y-4 group-hover:translate-y-0 transition-transform">
            <IconRenderer name="ChevronRight" size={20} className="text-slate-900" />
          </div>
        </div>
      </div>

      <div className="px-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-black tracking-widest text-blue-600 uppercase">{task.type}</span>
          <span className="text-[10px] font-bold text-slate-300">/</span>
          <span className="text-[10px] font-bold text-slate-400">{task.date}</span>
        </div>

        <h4 className="text-[15px] font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
          {task.title}
        </h4>

        {task.tags && (
          <div className="flex flex-wrap gap-2 mt-2">
            {task.tags.map((tag) => (
              <span key={tag} className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-50 border border-slate-100 text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                {tag.includes("张") && <IconRenderer name="Grid" size={10} />}
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
