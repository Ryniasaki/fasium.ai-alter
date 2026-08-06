"use client"

import { useState } from "react"
import { IconRenderer } from "./IconRenderer"

interface SidebarProps {
  activeView: string
  onViewChange: (view: string) => void
}

const NAV_ITEMS = [
  { id: "record", label: "任务记录", icon: "History" },
  { id: "admin", label: "团队空间", icon: "User" },
  { id: "project", label: "我的项目", icon: "Box", muted: true },
  { id: "tools", label: "工具中心", icon: "Zap", muted: true },
]

export function Sidebar({ activeView, onViewChange }: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)

  return (
    <div
      className={`h-screen bg-white border-r border-slate-50 flex flex-col sticky top-0 shrink-0 z-50 transition-all duration-300 ${
        isCollapsed ? "w-20" : "w-72"
      }`}
    >
      <div className="p-10">
        <div className="flex items-center gap-3 mb-14">
          <div className="w-10 h-10 bg-slate-950 rounded-2xl flex items-center justify-center shadow-lg shadow-slate-200">
            <span className="text-white font-black text-xl italic">F</span>
          </div>
          <span className={`font-black text-xl tracking-tighter text-slate-950 uppercase ${isCollapsed ? "sr-only" : ""}`}>
            Fasium
          </span>
          <button
            onClick={() => setIsCollapsed((prev) => !prev)}
            className={`ml-auto w-7 h-7 rounded-full border border-slate-200 text-slate-400 hover:text-slate-900 hover:border-slate-300 transition-all ${
              isCollapsed ? "rotate-180" : ""
            }`}
            aria-label={isCollapsed ? "展开侧栏" : "收起侧栏"}
          >
            {"<"}
          </button>
        </div>

        <nav className="space-y-2">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={`w-full flex items-center gap-4 px-5 py-3.5 rounded-2xl transition-all duration-300 group ${
                activeView === item.id ? "bg-slate-50 text-slate-950 font-bold" : "text-slate-400 hover:text-slate-900"
              } ${item.muted ? "opacity-20" : ""}`}
            >
              <IconRenderer
                name={item.icon}
                size={20}
                className={activeView === item.id ? "text-slate-950" : "text-slate-300 group-hover:text-slate-900 transition-colors"}
              />
              <span className={`text-[15px] ${isCollapsed ? "sr-only" : ""}`}>{item.label}</span>
              {!isCollapsed && activeView === item.id && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-slate-950" />}
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-auto p-8 border-t border-slate-50">
        <div className="group flex items-center gap-4 p-3 rounded-2xl hover:bg-slate-50 transition-all cursor-pointer">
          <div className="relative">
            <div className="w-11 h-11 rounded-2xl bg-slate-100 flex items-center justify-center overflow-hidden border border-slate-100 group-hover:scale-105 transition-transform">
              <img src="https://picsum.photos/seed/user1/80/80" alt="Avatar" className="w-full h-full object-cover" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 border-4 border-white rounded-full" />
          </div>
          <div className={`flex-1 min-w-0 ${isCollapsed ? "sr-only" : ""}`}>
            <p className="text-sm font-bold text-slate-900 truncate">Eason J.</p>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Premium Plus</p>
          </div>
          <IconRenderer name="Settings" size={16} className="text-slate-300 group-hover:text-slate-950 transition-colors" />
        </div>
      </div>
    </div>
  )
}
