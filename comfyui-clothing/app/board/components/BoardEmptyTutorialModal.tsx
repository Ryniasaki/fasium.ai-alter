"use client"

import { Play } from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useI18n } from "@/contexts/i18n-context"

const BOARD_TUTORIAL_URL = "https://v.douyin.com/czkLsll87tI/"

interface BoardEmptyTutorialModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BoardEmptyTutorialModal({ open, onOpenChange }: BoardEmptyTutorialModalProps) {
  const { messages } = useI18n()
  const copy = messages.board.emptyTutorialModal

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden border-border/70 bg-background p-0 shadow-2xl sm:max-w-[780px]">
        <div className="flex min-h-[520px] flex-col">
          <DialogHeader className="space-y-3 px-6 py-6 text-left sm:px-7 sm:py-7">
            <div className="inline-flex w-fit items-center rounded-full border border-primary/15 bg-primary/8 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
              {copy.badge}
            </div>
            <DialogTitle className="text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]">
              {copy.title}
            </DialogTitle>
            <DialogDescription className="text-sm leading-7 text-muted-foreground">
              {copy.description}
            </DialogDescription>
          </DialogHeader>

          <div className="relative min-h-[360px] flex-1 overflow-hidden bg-slate-950">
            <a
              href={BOARD_TUTORIAL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative flex h-full min-h-[360px] items-end p-5 sm:p-6"
            >
              <img
                src="/douyin-icon.webp"
                alt={copy.imageAlt}
                className="absolute inset-0 h-full w-full object-cover opacity-85 transition-transform duration-700 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/5" />
              <div className="relative z-10 flex w-full items-end justify-between gap-4">
                <div className="max-w-[75%] text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.65)]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] !text-white/80">
                    {copy.videoLabel}
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold tracking-tight !text-white">
                    {copy.videoTitle}
                  </h3>
                  <p className="mt-3 text-sm leading-6 !text-white/80">
                    {copy.videoDescription}
                  </p>
                </div>
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/15 text-white shadow-[0_12px_30px_rgba(0,0,0,0.28)] backdrop-blur-md transition-transform duration-300 group-hover:scale-105">
                  <Play className="ml-0.5 size-6 fill-white" />
                </div>
              </div>
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
