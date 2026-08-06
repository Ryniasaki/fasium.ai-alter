"use client"

import { useEffect, useRef, useState } from "react"
import { IconRenderer } from "./IconRenderer"

interface ContextMenuProps {
  x: number
  y: number
  onClose: () => void
  onEdit?: () => void
  onDownload: () => void
  onShare: () => void
  onReplace: () => void
  onDelete: () => void
  onCopy?: () => void
  onPaste?: () => void
  onAskAI?: () => void
}

export function ContextMenu({
  x,
  y,
  onClose,
  onEdit,
  onDownload,
  onShare,
  onReplace,
  onDelete,
  onCopy,
  onPaste,
  onAskAI,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [adjustedPos, setAdjustedPos] = useState({ top: y, left: x })

  useEffect(() => {
    console.log("[board] ContextMenu mounted", { x, y })
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect()
      const winW = window.innerWidth
      const winH = window.innerHeight

      let nextTop = y
      let nextLeft = x

      if (x + rect.width > winW) nextLeft = winW - rect.width - 20
      if (y + rect.height > winH) nextTop = winH - rect.height - 20

      setAdjustedPos({ top: nextTop, left: nextLeft })
    }

    window.addEventListener("mousedown", handleClickOutside)
    return () => window.removeEventListener("mousedown", handleClickOutside)
  }, [onClose, x, y])

  const menuItems = [
    { label: "询问AI", icon: "Wand2", action: onAskAI, color: "text-blue-600", show: Boolean(onAskAI) },
    { label: "编辑", icon: "Pencil", action: onEdit, color: "text-blue-600", show: Boolean(onEdit) },
    { label: "下载图片", icon: "Box", action: onDownload, color: "text-slate-700" },
    { label: "分享链接", icon: "ChevronRight", action: onShare, color: "text-slate-700" },
    { label: "替换资产", icon: "Hand", action: onReplace, color: "text-blue-600" },
    { label: "复制", icon: "Copy", action: onCopy, color: "text-slate-700", show: Boolean(onCopy) },
    { label: "黏贴", icon: "Clipboard", action: onPaste, color: "text-slate-700", show: Boolean(onPaste) },
    { label: "删除资产", icon: "X", action: onDelete, color: "text-rose-600" },
  ].filter((item) => item.show !== false)

  return (
    <div
      ref={menuRef}
      className="fixed z-[1000] w-56 bg-white/90 backdrop-blur-3xl border border-white/50 rounded-[1.5rem] shadow-[0_30px_100px_rgba(0,0,0,0.15)] py-2 animate-in fade-in zoom-in-95 duration-200 overflow-hidden pointer-events-auto"
      style={{ top: adjustedPos.top, left: adjustedPos.left }}
      onMouseDown={(event) => {
        event.stopPropagation()
        console.log("[board] ContextMenu mousedown")
      }}
    >
      <div className="space-y-0.5 px-1.5">
        {menuItems.map((item) => (
          <button
            key={item.label}
            onMouseDown={(event) => {
              event.stopPropagation()
              console.log("[board] ContextMenu button mousedown", { label: item.label })
            }}
            onClick={(event) => {
              event.stopPropagation()
              console.log("[board] ContextMenu click", { label: item.label })
              item.action()
              onClose()
            }}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 rounded-xl transition-all group"
          >
            <span className={`text-[12px] font-black tracking-tight ${item.color}`}>{item.label}</span>
            <IconRenderer name={item.icon} size={14} className="text-slate-300 group-hover:text-slate-950 transition-colors" />
          </button>
        ))}
      </div>
    </div>
  )
}
