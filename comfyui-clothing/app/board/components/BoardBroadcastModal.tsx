"use client"

import { useEffect, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { BoardBroadcast } from "@/lib/board-broadcasts"

interface BoardBroadcastModalProps {
  broadcasts: BoardBroadcast[]
  open: boolean
  startIndex?: number
  onOpenChange: (open: boolean) => void
  onDismissForLater: (broadcasts: BoardBroadcast[]) => void
}

export function BoardBroadcastModal({
  broadcasts,
  open,
  startIndex = 0,
  onOpenChange,
  onDismissForLater,
}: BoardBroadcastModalProps) {
  const [activeIndex, setActiveIndex] = useState(startIndex)
  const [dontShowAgain, setDontShowAgain] = useState(false)

  useEffect(() => {
    if (open) {
      setActiveIndex(Math.min(startIndex, Math.max(0, broadcasts.length - 1)))
      setDontShowAgain(false)
    }
  }, [broadcasts.length, open, startIndex])

  const activeBroadcast = broadcasts[activeIndex]

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen && dontShowAgain && broadcasts.length > 0) {
      onDismissForLater(broadcasts)
    }
    onOpenChange(nextOpen)
  }

  if (!activeBroadcast) return null

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="overflow-hidden border-none bg-transparent p-0 shadow-none sm:max-w-[960px] [&>button]:hidden">
        <div className="flex h-[720px] w-[min(960px,92vw)] flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.22)]">
          <DialogHeader className="border-b border-slate-100 bg-gradient-to-r from-amber-50 via-white to-orange-50 px-6 py-5 text-left">
            <div className="flex items-start justify-between gap-4">
              <div>
                <DialogTitle className="text-2xl font-semibold text-slate-950">{activeBroadcast.title}</DialogTitle>
                <DialogDescription className="mt-2 text-sm text-slate-500">
                  {new Date(activeBroadcast.starts_at).toLocaleString()} - {new Date(activeBroadcast.ends_at).toLocaleString()}
                </DialogDescription>
              </div>
              {broadcasts.length > 1 && (
                <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500">
                  {activeIndex + 1}/{broadcasts.length}
                </div>
              )}
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <article className="prose prose-slate max-w-none prose-img:rounded-2xl prose-img:border prose-img:border-slate-200 prose-a:text-blue-600">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{activeBroadcast.content_markdown || ""}</ReactMarkdown>
            </article>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 bg-slate-50/80 px-6 py-4">
            <div className="flex items-center gap-3">
              <Checkbox id="board-broadcast-dismiss" checked={dontShowAgain} onCheckedChange={(checked) => setDontShowAgain(Boolean(checked))} />
              <label htmlFor="board-broadcast-dismiss" className="text-sm text-slate-600">
                下次不再弹窗展示当前这些广播
              </label>
            </div>
            <div className="flex items-center gap-2">
              {broadcasts.length > 1 && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => setActiveIndex((current) => (current - 1 + broadcasts.length) % broadcasts.length)}
                  >
                    <ChevronLeft className="mr-1 size-4" />
                    上一条
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => setActiveIndex((current) => (current + 1) % broadcasts.length)}
                  >
                    下一条
                    <ChevronRight className="ml-1 size-4" />
                  </Button>
                </>
              )}
              <Button type="button" className="rounded-full" onClick={() => handleClose(false)}>
                关闭
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
