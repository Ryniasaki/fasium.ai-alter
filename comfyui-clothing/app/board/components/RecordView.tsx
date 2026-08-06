"use client"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { IconRenderer } from "./IconRenderer"
import { BoardBroadcastTicker } from "./BoardBroadcastTicker"
import type { Task } from "../types"
import type { BoardBroadcast } from "@/lib/board-broadcasts"
import { useI18n } from "@/contexts/i18n-context"

const BOARD_FIRST_USE_GUIDE_STORAGE_KEY = "fasium_board_first_use_guide_seen"

interface RecordViewProps {
  tasks: Task[]
  onSelectProject: (project: Task) => void
  onDeleteProject: (projectId: string) => void
  onToggleProjectProtection?: (projectId: string, nextProtected: boolean) => void
  onCreateProject?: () => void
  currentPage?: number
  totalPages?: number
  totalItems?: number
  onPageChange?: (page: number) => void
  topNav?: ReactNode
  isLoading?: boolean
  canManageProjects?: boolean
  activeBroadcasts?: BoardBroadcast[]
  onOpenBroadcasts?: (index?: number) => void
}

export function RecordView({
  tasks,
  onSelectProject,
  onDeleteProject,
  onToggleProjectProtection,
  onCreateProject,
  currentPage = 1,
  totalPages = 1,
  totalItems,
  onPageChange,
  topNav,
  isLoading,
  canManageProjects = true,
  activeBroadcasts = [],
  onOpenBroadcasts,
}: RecordViewProps) {
  const { messages } = useI18n()
  const copy = messages.board.recordView
  const [showFirstUseGuide, setShowFirstUseGuide] = useState(false)
  const hasResolvedFirstUseGuideRef = useRef(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    if (isLoading) return

    if (!canManageProjects) {
      setShowFirstUseGuide(false)
      hasResolvedFirstUseGuideRef.current = true
      return
    }

    if (hasResolvedFirstUseGuideRef.current) {
      return
    }

    const hasSeenGuide = window.localStorage.getItem(BOARD_FIRST_USE_GUIDE_STORAGE_KEY) === "true"
    setShowFirstUseGuide(!hasSeenGuide && tasks.length === 0)
    hasResolvedFirstUseGuideRef.current = true
  }, [canManageProjects, isLoading, tasks.length])

  const dismissFirstUseGuide = () => {
    setShowFirstUseGuide(false)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(BOARD_FIRST_USE_GUIDE_STORAGE_KEY, "true")
    }
  }

  const handleCreateProject = () => {
    dismissFirstUseGuide()
    onCreateProject?.()
  }

  return (
    <div className="flex flex-col min-h-screen bg-background overflow-y-auto scrollbar-hide">
      {topNav && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in slide-in-from-top-4 duration-700">
          {topNav}
        </div>
      )}

      <div className="relative flex-1 px-6 sm:px-10 lg:px-12 pt-32 pb-24">
        <div className="max-w-7xl mx-auto space-y-8">
          {activeBroadcasts.length > 0 && (
            <BoardBroadcastTicker
              broadcasts={activeBroadcasts}
              onOpen={(index) => onOpenBroadcasts?.(index)}
            />
          )}

          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{copy.workspace}</p>
              <h2 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">{copy.projectBoards}</h2>
            </div>
            <div className="hidden sm:inline-flex items-center rounded-full border border-border bg-card px-4 py-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              {totalItems ?? tasks.length} {copy.items}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
            {!isLoading && canManageProjects && (
              <div
                onClick={handleCreateProject}
                className={`group cursor-pointer flex flex-col relative ${showFirstUseGuide ? "z-[140]" : ""}`}
              >
                {showFirstUseGuide && (
                  <>
                    <div className="pointer-events-none fixed inset-0 z-[120] bg-[hsl(var(--foreground)/0.06)] backdrop-blur-[3px] backdrop-saturate-[0.96]" />
                    <div className="absolute left-0 right-0 top-full z-[150] mt-5 sm:left-full sm:right-auto sm:top-1/2 sm:mt-0 sm:ml-6 sm:w-[360px] sm:-translate-y-1/2">
                      <div className="relative overflow-visible rounded-[20px] border border-border bg-card p-5 text-card-foreground shadow-[0_18px_44px_rgba(15,23,42,0.14)] ring-1 ring-black/5 backdrop-blur-md">
                        <div className="absolute inset-y-0 left-4 w-px bg-border" />
                        <div className="absolute inset-y-0 left-7 w-px bg-border/50" />
                        <div className="pl-8 pr-10">
                          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">{copy.firstBoardBadge}</p>
                          <p className="mt-3 text-[15px] font-semibold leading-7">📝 {copy.firstBoardTitle}</p>
                          <p className="mt-3 text-sm leading-6 text-muted-foreground">🎨 {copy.firstBoardDescription}</p>
                          <p className="mt-3 text-sm leading-6 text-muted-foreground">✨ {copy.firstBoardDescriptionSecondary}</p>
                        </div>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            dismissFirstUseGuide()
                          }}
                          className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
                          aria-label={copy.dismissGuide}
                        >
                          <IconRenderer name="X" size={14} />
                        </button>
                        <div className="absolute -top-3 left-8 rounded-full border border-border bg-card px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground shadow-sm">
                          {copy.startHere}
                        </div>
                        <div className="absolute -top-2 left-10 h-4 w-4 rotate-45 border-l border-t border-border bg-card sm:left-[-8px] sm:top-1/2 sm:-translate-y-1/2" />
                      </div>
                    </div>
                  </>
                )}
                <div
                  className={`relative rounded-2xl border-2 border-dashed border-border bg-card p-3 hover:border-primary/50 transition-all duration-300 ${
                    showFirstUseGuide
                      ? "z-[160] border-slate-900 bg-white shadow-[0_0_0_1px_rgba(15,23,42,0.06),0_10px_30px_rgba(15,23,42,0.10)]"
                      : ""
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between px-1">
                    <span className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                      {copy.projectTag}
                    </span>
                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{copy.newTag}</span>
                  </div>

                  <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-muted flex items-center justify-center">
                    <div
                      className={`w-14 h-14 rounded-xl bg-background border border-border text-muted-foreground flex items-center justify-center group-hover:scale-105 group-hover:text-primary transition-all duration-300 ${
                        showFirstUseGuide ? "scale-105 border-slate-300 text-slate-900 shadow-[0_12px_30px_rgba(15,23,42,0.12)]" : ""
                      }`}
                    >
                      <IconRenderer name="Plus" size={24} />
                    </div>
                  </div>

                  <div className="px-1 pt-3 pb-1">
                    <p className="text-[11px] font-semibold text-foreground uppercase tracking-[0.2em] group-hover:text-primary transition-colors">
                      {copy.newArtboard}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {tasks.map((task) => (
              <div
                key={task.id}
                className="group cursor-pointer flex flex-col relative"
                onClick={() => onSelectProject(task)}
              >
                {canManageProjects && (
                  <div className="absolute -top-2 -right-2 z-[60] flex items-center gap-2 opacity-0 transition-all duration-300 group-hover:opacity-100">
                    <button
                      onClick={(event) => {
                        event.stopPropagation()
                        onToggleProjectProtection?.(task.id, !task.isProtected)
                      }}
                      className={`flex h-8 w-8 items-center justify-center rounded-full border transition-all duration-300 hover:scale-105 active:scale-95 ${
                        task.isProtected
                          ? "border-amber-300 bg-amber-50 text-amber-700 hover:border-amber-400"
                          : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-primary"
                      }`}
                      aria-label={task.isProtected ? "Unlock project protection" : "Protect project"}
                    >
                      <IconRenderer name={task.isProtected ? "Lock" : "Unlock"} size={14} />
                    </button>
                    <button
                      onClick={(event) => {
                        event.stopPropagation()
                        onDeleteProject(task.id)
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card transition-all duration-300 hover:scale-105 hover:border-destructive/50 hover:text-destructive active:scale-95"
                      aria-label="Delete project"
                    >
                      <IconRenderer name="X" size={14} />
                    </button>
                  </div>
                )}

                <div className="relative rounded-2xl border border-border bg-card p-3 transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-lg">
                  <div className="mb-2 flex items-center justify-between px-1">
                    <span />
                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {task.date || copy.noDate}
                    </span>
                  </div>

                  <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-muted">
                    {task.isProtected && (
                      <div className="absolute left-2 top-2 z-10">
                        <div className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white/95 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-blue-600 shadow-sm">
                          <IconRenderer name="Lock" size={10} />
                        </div>
                      </div>
                    )}
                    {task.images?.[0] ? (
                      <img
                        src={task.images[0]}
                        className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-700"
                        alt=""
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground">
                        <div className="size-12 rounded-xl bg-background border border-border flex items-center justify-center">
                          <IconRenderer name="Box" size={28} />
                        </div>
                        <span className="mt-2 text-[10px] font-medium uppercase tracking-widest">No Preview</span>
                      </div>
                    )}

                    <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/45 to-transparent">
                      <div className="inline-flex items-center rounded-full bg-background/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground">
                        Open Canvas
                      </div>
                    </div>

                    {task.images && task.images.length > 0 && (
                      <div className="absolute top-2 right-2">
                        <div className="bg-background/92 backdrop-blur-md px-2.5 py-1 rounded-full border border-border">
                          <span className="text-[9px] font-semibold text-foreground uppercase tracking-wider">{task.images.length} FILES</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="px-1 pt-3 pb-1">
                    <h4 className="text-lg font-semibold text-foreground tracking-tight leading-tight line-clamp-2 group-hover:text-primary transition-colors">
                      {task.title}
                    </h4>
                  </div>
                </div>
              </div>
            ))}

          </div>

          {totalPages > 1 && (
            <div className="flex justify-center pt-2">
              <div className="inline-flex items-center gap-3 rounded-full border border-border bg-card px-3 py-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground shadow-sm">
                <button
                  type="button"
                  onClick={() => onPageChange?.(Math.max(1, currentPage - 1))}
                  disabled={isLoading || currentPage <= 1}
                  className="inline-flex items-center justify-center rounded-full border border-border px-4 py-1.5 text-[10px] transition-colors hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  上一页
                </button>
                <span className="min-w-20 text-center">{currentPage} / {totalPages}</span>
                <button
                  type="button"
                  onClick={() => onPageChange?.(Math.min(totalPages, currentPage + 1))}
                  disabled={isLoading || currentPage >= totalPages}
                  className="inline-flex items-center justify-center rounded-full border border-border px-4 py-1.5 text-[10px] transition-colors hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
