"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { textToImageApiClient, type AspectRatio } from "@/lib/text-to-image-api-client"
import { formatStatusMessage } from "@/lib/task-status-message"

const ASPECT_RATIOS: AspectRatio[] = ["16:9", "9:16", "1:1"]

export default function TextToClothPage() {
  const [prompt, setPrompt] = useState("")
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9")
  const [taskId, setTaskId] = useState<string | null>(null)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [images, setImages] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const [activeImage, setActiveImage] = useState<string | null>(null)

  const isMounted = useRef(false)

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
    }
  }, [])

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!prompt.trim()) {
        setError("请输入描述后再试")
        return
      }

      setIsSubmitting(true)
      setError(null)
      setImages([])
      setStatusText("任务创建中…")
      setProgress(null)
      setHasSubmitted(true)

      try {
        const response = await textToImageApiClient.submitTextToImage(prompt.trim(), aspectRatio)
        if (!isMounted.current) return

        const responseTaskId =
          typeof response.taskId === "string"
            ? response.taskId
            : typeof response.taskId === "object" && response.taskId !== null
              ? (response.taskId as { taskId?: string; id?: string }).taskId ??
                (response.taskId as { taskId?: string; id?: string }).id ??
                null
              : null

        if (!responseTaskId) {
          throw new Error("未能获取任务 ID，请稍后再试")
        }

        setTaskId(responseTaskId)
        setStatusText("等待工作流开始")
      } catch (err) {
        if (!isMounted.current) return
        const detail = err instanceof Error ? err.message : "提交失败，请稍后再试"
        setError(detail)
        setTaskId(null)
        setIsSubmitting(false)
        setHasSubmitted(false)
      }
    },
    [prompt, aspectRatio],
  )

  useEffect(() => {
    if (!taskId) return
    const INTERVAL = 3000
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      try {
        const status = await textToImageApiClient.getTaskStatus(taskId)
        if (!isMounted.current || cancelled) return

        setProgress(status.progress ?? null)
        setStatusText(formatStatusMessage(status.message, `任务状态：${status.status}`))

        if (status.status === "SUCCESS") {
          setStatusText("获取结果中…")
          const outputs = await textToImageApiClient.completeTask(taskId)
          if (!isMounted.current || cancelled) return

          if (!outputs.outputs.length) {
            setError("未收到生成结果，请稍后再试")
          } else {
            setImages(outputs.outputs)
            setProgress(100)
            setStatusText("生成完成")
          }
          setIsSubmitting(false)
          setTaskId(null)
          return
        }

        if (status.status === "FAILED") {
          setError(formatStatusMessage(status.message, "生成失败，请稍后重试"))
          setIsSubmitting(false)
          setTaskId(null)
          setHasSubmitted(false)
          return
        }

        timeoutId = setTimeout(poll, INTERVAL)
      } catch (err) {
        if (!isMounted.current || cancelled) return
        const detail = err instanceof Error ? err.message : "状态查询失败"
        setError(detail)
        setIsSubmitting(false)
        setTaskId(null)
        setHasSubmitted(false)
      }
    }

    poll()

    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [taskId])

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10">
      <div>
        <p className="text-sm uppercase tracking-wide text-muted-foreground">Text to Cloth</p>
        <h1 className="text-3xl font-semibold">文生面料快速试用</h1>
        <p className="text-muted-foreground">输入简单的面料灵感，即可快速获取参考布料图像。</p>
      </div>

      <AnimatePresence mode="wait">
        {!hasSubmitted && (
          <motion.form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-2xl border p-6 shadow-sm"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <div className="space-y-2">
              <Label htmlFor="prompt" className="text-sm text-muted-foreground">
                输入你的面料灵感
              </Label>
              <div className="flex items-center rounded-full border bg-background shadow-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring">
                <Input
                  id="prompt"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="例如：丝绒质感 · 深海蓝渐变 · 适合礼服"
                  className="border-0 bg-transparent px-5 py-6 text-base focus-visible:ring-0"
                />
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="mr-2 h-12 rounded-full px-6 text-base"
                >
                  {isSubmitting ? "生成中…" : "生成"}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">画幅比例</Label>
              <div className="flex flex-wrap gap-2">
                {ASPECT_RATIOS.map((ratio) => {
                  const isActive = aspectRatio === ratio
                  return (
                    <Button
                      key={ratio}
                      type="button"
                      variant={isActive ? "default" : "outline"}
                      className={`rounded-full px-4 ${isActive ? "" : "text-muted-foreground"}`}
                      onClick={() => setAspectRatio(ratio)}
                    >
                      {ratio}
                    </Button>
                  )
                })}
              </div>
            </div>

            {error && !hasSubmitted && <p className="text-sm text-destructive">{error}</p>}
          </motion.form>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {hasSubmitted && images.length === 0 && (
          <motion.div
            className="space-y-4 rounded-2xl border p-6 shadow-sm"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{statusText ?? "准备运行…"}</span>
              {typeof progress === "number" && <span>{Math.round(progress)}%</span>}
            </div>
            <Progress value={typeof progress === "number" ? progress : 15} className="h-2 rounded-full" />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {images.length > 0 && (
          <motion.div
            className="space-y-4 rounded-2xl border p-6 shadow-sm"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <h2 className="text-lg font-semibold">生成结果</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {images.map((src) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => setActiveImage(src)}
                  className="group overflow-hidden rounded-xl border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt="生成结果"
                    className="h-64 w-full object-cover transition duration-300 group-hover:scale-105"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && hasSubmitted && images.length === 0 && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
      )}

      <Dialog open={!!activeImage} onOpenChange={(open) => (open ? null : setActiveImage(null))}>
        <DialogContent className="max-w-5xl border-border/60 bg-background/95">
          {activeImage && (
            <div className="space-y-3">
              <div className="overflow-hidden rounded-2xl border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={activeImage} alt="生成结果大图" className="max-h-[80vh] w-full object-contain" />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

