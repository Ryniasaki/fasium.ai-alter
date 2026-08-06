"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronRight, Megaphone } from "lucide-react"

import type { BoardBroadcast } from "@/lib/board-broadcasts"

interface BoardBroadcastTickerProps {
  broadcasts: BoardBroadcast[]
  onOpen: (index: number) => void
}

export function BoardBroadcastTicker({ broadcasts, onOpen }: BoardBroadcastTickerProps) {
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    setActiveIndex(0)
  }, [broadcasts.length])

  useEffect(() => {
    if (broadcasts.length <= 1) return
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % broadcasts.length)
    }, 4500)
    return () => window.clearInterval(timer)
  }, [broadcasts.length])

  const activeBroadcast = useMemo(() => broadcasts[activeIndex] ?? broadcasts[0], [activeIndex, broadcasts])

  if (!activeBroadcast) return null

  return (
    <div className="rounded-2xl border border-amber-200/80 bg-gradient-to-r from-amber-50 via-white to-orange-50 px-4 py-3 shadow-[0_10px_30px_rgba(245,158,11,0.08)]">
      <button
        type="button"
        onClick={() => onOpen(activeIndex)}
        className="flex w-full flex-col gap-4 text-left sm:flex-row sm:items-start sm:justify-between"
      >
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-700">
            <Megaphone className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-700">Broadcast</p>
              {broadcasts.length > 1 && (
                <span className="rounded-full border border-amber-200 bg-white/80 px-2 py-1 text-[11px] text-amber-700">
                  {activeIndex + 1}/{broadcasts.length}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm font-semibold text-slate-950">{activeBroadcast.title}</p>
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center self-start rounded-full px-3 py-1.5 text-sm text-amber-700 transition-colors hover:bg-amber-100 hover:text-amber-800 sm:mt-1">
          查看详情
          <ChevronRight className="ml-1 size-4" />
        </span>
      </button>
    </div>
  )
}
