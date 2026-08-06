"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { motion } from "framer-motion"
import { ArrowUpRight, CheckCircle, Download, Sparkles, Upload, Wand2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { extractApiClient } from "@/lib/extract-api-client"

type UploadState = "idle" | "uploading" | "processing" | "complete" | "error"

const POLL_DELAY = 2000
const MAX_ATTEMPTS = 60
const HI_RES_PREFILL_KEY = "hi_res_prefill_image"

export default function HighResolutionPage() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<UploadState>("idle")
  const [statusMessage, setStatusMessage] = useState("")
  const [progress, setProgress] = useState(0)
  const [outputs, setOutputs] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const resetState = useCallback(() => {
    setStatus("idle")
    setStatusMessage("")
    setProgress(0)
    setOutputs([])
    setError(null)
  }, [])

  useEffect(() => {
    const prefill = window.sessionStorage.getItem(HI_RES_PREFILL_KEY)
    if (!prefill) return

    window.sessionStorage.removeItem(HI_RES_PREFILL_KEY)

    try {
      const parsed = JSON.parse(prefill) as { imageUrl?: string }
      if (!parsed?.imageUrl) return

      void (async () => {
        try {
          const response = await fetch(parsed.imageUrl)
          if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`)
          const blob = await response.blob()
          const ext = blob.type?.split("/")[1] || "png"
          const file = new File([blob], `hi-res-prefill-${Date.now()}.${ext}`, { type: blob.type || "image/png" })
          const url = URL.createObjectURL(blob)

          resetState()
          setSelectedFile(file)
          setPreviewUrl(url)
        } catch (error) {
          console.error("Prefill hi_res failed:", error)
          setError("自动载入任务图片失败，请手动上传。")
        }
      })()
    } catch (error) {
      console.error("Invalid hi_res prefill payload:", error)
    }
  }, [resetState])

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    resetState()
    setSelectedFile(file)
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
  }, [resetState])

  const startUpscale = useCallback(async () => {
    if (!selectedFile) {
      setError("请先选择一张图片")
      return
    }

    setStatus("uploading")
    setStatusMessage("上传图片中...")
    setProgress(10)
    setError(null)
    setOutputs([])

    try {
      const resp = await extractApiClient.submitSuperResolution(selectedFile)

      setStatus("processing")
      setStatusMessage("正在放大图像...")
      setProgress(30)

      let finalStatus = resp
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        const currentStatus = await extractApiClient.getTaskStatus(resp.taskId)
        finalStatus = currentStatus

        if (currentStatus.status === "SUCCESS") break
        if (currentStatus.status === "FAILED") throw new Error("超级分辨率任务失败")
        await new Promise((resolve) => setTimeout(resolve, POLL_DELAY))
      }

      if (!finalStatus || finalStatus.status !== "SUCCESS") {
        throw new Error("任务超时或失败，请稍后再试")
      }

      setStatusMessage("下载高清结果...")
      setProgress(80)

      const { outputs: resultOutputs } = await extractApiClient.completeTask(resp.taskId)
      if (!resultOutputs.length) {
        throw new Error("未获取到放大结果")
      }

      setOutputs(resultOutputs)
      setStatus("complete")
      setStatusMessage("已完成")
      setProgress(100)
    } catch (err) {
      console.error(err)
      setStatus("error")
      setStatusMessage("任务失败")
      setProgress(0)
      setError(err instanceof Error ? err.message : "未知错误")
    }
  }, [selectedFile])

  const statusLabel = useMemo(() => {
    switch (status) {
      case "idle":
        return "等待上传"
      case "uploading":
        return "上传中"
      case "processing":
        return "处理中"
      case "complete":
        return "已完成"
      case "error":
        return "出错"
    }
  }, [status])

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <section className="border-b border-white/10 bg-gradient-to-b from-slate-900 to-slate-950">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
            <div className="flex-1 space-y-4">
              <Badge
                variant="secondary"
                className="w-fit gap-2 border border-white/20 bg-white/10 text-white hover:bg-white/20"
              >
                <Sparkles className="size-4 text-emerald-300" />
                F12 Super Resolution
              </Badge>
              <h1 className="text-4xl font-bold tracking-tight text-white md:text-5xl">
                High Resolution Studio
              </h1>
              <p className="text-lg text-white/70">
                上传一张图片，利用 RunningHub 超级分辨率模型提升纹理细节、边缘锐度与整体清晰度，适用于 Lookbook
                素材、局部纹样放大与展示图升级。
              </p>
              <div className="flex flex-wrap gap-3 text-sm text-white/60">
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1">
                  <Wand2 className="size-4 text-emerald-300" />
                  最多 4K 输出
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1">
                  <CheckCircle className="size-4 text-emerald-300" />
                  保留原始光影
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1">
                  <ArrowUpRight className="size-4 text-emerald-300" />
                  直接用于海报
                </span>
              </div>
            </div>
            <div className="flex-1">
              <Card className="border-white/10 bg-white/[0.03] backdrop-blur">
                <CardHeader>
                  <CardTitle>上传图片</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div
                    className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/5 p-6 text-center"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {previewUrl ? (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="relative h-48 w-full overflow-hidden rounded-xl border border-white/10"
                      >
                        <Image
                          src={previewUrl}
                          alt="待放大图片预览"
                          fill
                          className="object-cover"
                        />
                      </motion.div>
                    ) : (
                      <div className="space-y-3">
                        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-white/10 text-white/70">
                          <Upload className="size-5" />
                        </div>
                        <p className="text-base font-medium text-white">拖拽或点击上传</p>
                        <p className="text-sm text-white/60">支持 JPG / PNG / WebP，建议不小于 1024px</p>
                      </div>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <div className="flex flex-wrap gap-3">
                    <Button
                      className="flex-1"
                      onClick={() => fileInputRef.current?.click()}
                      variant="secondary"
                    >
                      重新选择
                    </Button>
                    <Button
                      className="flex-1"
                      onClick={startUpscale}
                      disabled={!selectedFile || status === "processing" || status === "uploading"}
                    >
                      开始放大
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-12 space-y-6">
        <Card className="border-white/10 bg-white/[0.03]">
          <CardContent className="space-y-4 py-6">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.4em] text-white/50">Task status</p>
                <h3 className="text-2xl font-semibold text-white">{statusLabel}</h3>
                <p className="text-sm text-white/70">{statusMessage}</p>
              </div>
              <div className="w-full max-w-sm">
                <Progress value={progress} className="h-2 bg-white/10" />
              </div>
            </div>
            {error && (
              <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">
                {error}
              </p>
            )}
          </CardContent>
        </Card>

        {outputs.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.4em] text-white/50">Upscaled Results</p>
                <h3 className="text-2xl font-semibold text-white">高清输出</h3>
                <p className="text-sm text-white/70">点击图片在新标签中打开以下载原图</p>
              </div>
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              {outputs.map((url, index) => (
                <motion.a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/5"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <div className="relative h-80">
                    <Image
                      src={url}
                      alt={`Upscaled result ${index + 1}`}
                      fill
                      sizes="(max-width: 768px) 100vw, 50vw"
                      className="object-cover transition duration-500 group-hover:scale-105"
                    />
                    <div className="absolute top-4 right-4 z-10">
                      <Button asChild size="sm" variant="secondary" className="gap-2">
                        <a href={url} download>
                          <Download className="size-4" />
                          下载
                        </a>
                      </Button>
                    </div>
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 transition group-hover:opacity-100" />
                    <div className="pointer-events-none absolute bottom-4 left-4 flex items-center gap-2 rounded-full bg-black/50 px-4 py-1 text-sm text-white">
                      <Wand2 className="size-4 text-emerald-300" />
                      Super Resolution
                    </div>
                  </div>
                </motion.a>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
