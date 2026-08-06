"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Download,
  Palette,
  Zap,
  ImageIcon,
  Layers,
  ArrowRight,
  CheckCircle,
  Clock,
  AlertCircle,
  Eye,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CollapsibleHeader } from "@/components/collapsible-header"
import Image, { type StaticImageData } from "next/image"
import { redesignApiClient, type TaskStatusResponse } from "@/lib/redesign-api-client"
import previewApplyOne from "@/image/preview/f3_apply (1).webp"
import previewApplyTwo from "@/image/preview/f3_apply (2).webp"

const APPLICATION_PROMPT = "将图片2中的印花款式迁移到图片1的衣服上"
const APPLY_PREFILL_KEY = "apply_prefill_image"
const APPLY_PREFILL_EVENT = "apply-prefill"

type ApplyGalleryShot = {
  src: StaticImageData
  title: string
  description: string
  alt: string
}

const applyGalleryShots: ApplyGalleryShot[] = [
  {
    src: previewApplyOne,
    title: "Pattern Fusion",
    description: "快速预览服装花型融合效果，辅助挑选最佳搭配。",
    alt: "Pattern fusion apply preview",
  },
  {
    src: previewApplyTwo,
    title: "Pose Consistency",
    description: "保持模特姿态一致，突出材质与版型的真实上身表现。",
    alt: "Pose consistency apply preview",
  },
]

type ApplyTab = "original" | "extracted" | "preview"

export default function ApplyPage() {
  const [modelImage, setModelImage] = useState<string | null>(null)
  const [patternImage, setPatternImage] = useState<string | null>(null)
  const [modelFile, setModelFile] = useState<File | null>(null)
  const [patternFile, setPatternFile] = useState<File | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [processingStep, setProcessingStep] = useState("")
  const [resultImages, setResultImages] = useState<string[]>([])
  const [taskId, setTaskId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalImage, setModalImage] = useState<string | null>(null)
  const modelInputRef = useRef<HTMLInputElement>(null)
  const patternInputRef = useRef<HTMLInputElement>(null)
  const [isGalleryCollapsed, setIsGalleryCollapsed] = useState(false)
  const [activeTab, setActiveTab] = useState<ApplyTab>("original")
  const layoutColumns = isGalleryCollapsed ? "lg:grid-cols-[minmax(0,1fr)_3.5rem]" : "lg:grid-cols-2"
  const isGalleryLocked = Boolean(modelImage || patternImage)

  useEffect(() => {
    if (isGalleryLocked && !isGalleryCollapsed) {
      setIsGalleryCollapsed(true)
    }
  }, [isGalleryLocked, isGalleryCollapsed])

  useEffect(() => {
    const loadPrefill = async (imageUrl: string, target: "model" | "pattern") => {
      try {
        const response = await fetch(imageUrl)
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.status}`)
        }
        const blob = await response.blob()
        const ext = blob.type?.split("/")[1] || "png"
        const file = new File([blob], `apply-prefill-${target}-${Date.now()}.${ext}`, {
          type: blob.type || "image/png",
        })

        const reader = new FileReader()
        reader.onload = (event) => {
          const result = event.target?.result
          if (typeof result !== "string") {
            return
          }
          if (target === "model") {
            setModelFile(file)
            setModelImage(result)
          } else {
            setPatternFile(file)
            setPatternImage(result)
          }
          setActiveTab("original")
          setIsGalleryCollapsed(true)
        }
        reader.readAsDataURL(file)
      } catch (error) {
        console.error("Prefill apply failed:", error)
      }
    }

    if (typeof window === "undefined") return
    const prefill = window.sessionStorage.getItem(APPLY_PREFILL_KEY)
    if (prefill) {
      window.sessionStorage.removeItem(APPLY_PREFILL_KEY)
      try {
        const parsed = JSON.parse(prefill) as { imageUrl?: string; target?: "model" | "pattern" }
        if (parsed?.imageUrl && parsed?.target) {
          void loadPrefill(parsed.imageUrl, parsed.target)
        }
      } catch (error) {
        console.error("Invalid apply prefill payload:", error)
      }
    }

    const handlePrefillEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ imageUrl?: string; target?: "model" | "pattern" }>).detail
      if (detail?.imageUrl && detail?.target) {
        void loadPrefill(detail.imageUrl, detail.target)
      }
    }

    window.addEventListener(APPLY_PREFILL_EVENT, handlePrefillEvent as EventListener)
    return () => {
      window.removeEventListener(APPLY_PREFILL_EVENT, handlePrefillEvent as EventListener)
    }
  }, [])

  const handleModelUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setModelFile(file)
      const reader = new FileReader()
      reader.onload = (e) => {
        setModelImage(e.target?.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handlePatternUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setPatternFile(file)
      const reader = new FileReader()
      reader.onload = (e) => {
        setPatternImage(e.target?.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const pollTaskStatus = async (id: string): Promise<TaskStatusResponse> => {
    const maxAttempts = 60
    const delay = 2000

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const status = await redesignApiClient.getTaskStatus(id)
      if (status.status === "SUCCESS" || status.status === "FAILED") {
        return status
      }
      await new Promise((resolve) => setTimeout(resolve, delay))
    }

    throw new Error("Task processing timeout")
  }

  const handleApply = async () => {
    if (!modelFile || !patternFile) {
      setError("Please upload both model and pattern images before applying.")
      return
    }
    setActiveTab("preview")

    setIsProcessing(true)
    setProgress(0)
    setProcessingStep("Submitting application...")
    setError(null)
    setResultImages([])
    setTaskId(null)
    try {
      const response = await redesignApiClient.submitRedesign({
        prompt: APPLICATION_PROMPT,
        image: modelFile,
        image_2: patternFile,
      })

      setTaskId(response.taskId)
      setProgress(30)
      setProcessingStep("Waiting for completion...")

      const finalStatus = await pollTaskStatus(response.taskId)
      if (finalStatus.status !== "SUCCESS") {
        throw new Error("Task failed to complete successfully.")
      }

      setProgress(80)
      setProcessingStep("Fetching results...")
      const outputs = await redesignApiClient.completeTask(response.taskId)
      if (!outputs.outputs || outputs.outputs.length === 0) {
        throw new Error("No output images received.")
      }

      setResultImages(outputs.outputs)
      setProgress(100)
      setProcessingStep("")
    } catch (err) {
      console.error("Application error:", err)
      setError(err instanceof Error ? err.message : "An unexpected error occurred.")
      setProcessingStep("")
    } finally {
      setIsProcessing(false)
    }
  }

  const handleDownload = () => {
    if (resultImages.length === 0) return

    try {
      const link = document.createElement("a")
      link.href = resultImages[0]
      link.download = `application-${Date.now()}.png`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (err) {
      console.error("Download failed:", err)
    }
  }

  const openImageModal = (imageUrl: string | null) => {
    if (!imageUrl) return
    setModalImage(imageUrl)
    setIsModalOpen(true)
  }

  const closeImageModal = () => {
    setIsModalOpen(false)
    setModalImage(null)
  }

  return (
    <>
      <div className="min-h-screen bg-background">
        {/* Header */}
        <CollapsibleHeader
        title="Pattern Application"
        description="Apply patterns to garments with AI precision"
        icon={<Palette className="size-4 text-secondary-foreground" />}
      />

        <div className="container mx-auto px-6 py-8">
          <div className={`grid gap-8 lg:items-start ${layoutColumns}`}>
            <div>
              <div className="space-y-6">
                <Card className="border-border/50 h-full">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <ImageIcon className="size-5" />
                        Pattern Preview
                      </CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1">
                    <input
                      ref={modelInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleModelUpload}
                      className="hidden"
                    />
                    <input
                      ref={patternInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handlePatternUpload}
                      className="hidden"
                    />

                    <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ApplyTab)} className="w-full">
                      <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="original">上传模特图片</TabsTrigger>
                        <TabsTrigger value="extracted">上传印花图片</TabsTrigger>
                        <TabsTrigger value="preview">结果</TabsTrigger>
                      </TabsList>

                      <TabsContent value="original" className="mt-6">
                        {modelImage ? (
                          <div className="group relative mx-auto aspect-[3/4] w-full max-w-md overflow-hidden rounded-xl border">
                            <button
                              type="button"
                              onClick={() => modelInputRef.current?.click()}
                              className="h-full w-full"
                              aria-label="Change model image"
                            >
                              <img src={modelImage} alt="Model preview" className="h-full w-full object-cover" />
                            </button>
                            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100">
                              <Button
                                size="sm"
                                variant="secondary"
                                className="pointer-events-auto"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  modelInputRef.current?.click()
                                }}
                              >
                                Replace Image
                              </Button>
                              <span className="text-xs text-white/80">Upload a model image</span>
                              <span className="text-xs text-white/70">Generate extracted patterns and color groups</span>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => modelInputRef.current?.click()}
                            className="flex h-96 w-full flex-col items-center justify-center space-y-4 rounded-lg border-2 border-dashed border-border text-center transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                            aria-label="Upload model image"
                          >
                            <ImageIcon className="size-12 text-muted-foreground mx-auto" />
                            <div>
                              <p className="text-lg font-medium">Upload a model image</p>
                              <p className="text-sm text-muted-foreground">Generate extracted patterns and color groups</p>
                            </div>
                          </button>
                        )}
                      </TabsContent>

                      <TabsContent value="extracted" className="mt-6">
                        {patternImage ? (
                          <div className="group relative mx-auto aspect-square w-full max-w-md overflow-hidden rounded-xl border">
                            <button
                              type="button"
                              onClick={() => patternInputRef.current?.click()}
                              className="h-full w-full"
                              aria-label="Change pattern image"
                            >
                              <img src={patternImage} alt="Pattern preview" className="h-full w-full object-cover" />
                            </button>
                            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100">
                              <Button
                                size="sm"
                                variant="secondary"
                                className="pointer-events-auto"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  patternInputRef.current?.click()
                                }}
                              >
                                Replace Image
                              </Button>
                              <span className="text-xs text-white/80">Upload an extracted image</span>
                              <span className="text-xs text-white/70">Generate extracted patterns and color groups</span>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => patternInputRef.current?.click()}
                            className="flex h-96 w-full flex-col items-center justify-center space-y-4 rounded-lg border-2 border-dashed border-border text-center transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                            aria-label="Upload extracted image"
                          >
                            <ImageIcon className="size-12 text-muted-foreground mx-auto" />
                            <div>
                              <p className="text-lg font-medium">Upload an extracted image</p>
                              <p className="text-sm text-muted-foreground">Analyze color groups without rerunning extraction</p>
                            </div>
                          </button>
                        )}
                      </TabsContent>

                      <TabsContent value="preview" className="mt-6 space-y-6">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <Layers className="size-5 text-muted-foreground" />
                            <h4 className="text-base font-medium">Result Preview</h4>
                          </div>
                          {modelImage && resultImages.length > 0 && (
                            <Button variant="outline" size="sm" className="gap-2" onClick={handleDownload}>
                              <Download className="size-4" />
                              Download
                            </Button>
                          )}
                        </div>

                        {!modelImage || !patternImage ? (
                          <div className="relative mx-auto aspect-square max-w-xl overflow-hidden rounded-2xl border border-dashed border-border/70 bg-muted/20">
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center text-muted-foreground">
                              <div className="flex items-center gap-3">
                                <div className="flex flex-col items-center">
                                  <ImageIcon className="size-8" />
                                  <span className="text-xs mt-1">Model Image</span>
                                </div>
                                <ArrowRight className="size-5" />
                                <div className="flex flex-col items-center">
                                  <Palette className="size-8" />
                                  <span className="text-xs mt-1">Pattern Image</span>
                                </div>
                              </div>
                              <div>
                                <p className="text-lg font-semibold text-foreground">Upload both images to start</p>
                                <p className="text-sm">Upload a model image and pattern to apply</p>
                              </div>
                            </div>
                          </div>
                        ) : isProcessing ? (
                          <div className="relative mx-auto aspect-square max-w-xl overflow-hidden rounded-2xl border border-border bg-muted/20 flex items-center justify-center">
                            <div className="text-center space-y-4">
                              <div className="size-12 border-2 border-secondary border-t-transparent rounded-full animate-spin mx-auto" />
                              <p className="text-sm text-muted-foreground">Generating result...</p>
                            </div>
                          </div>
                        ) : resultImages.length > 0 ? (
                          <div className="grid gap-4 md:grid-cols-2">
                            {resultImages.map((url, index) => (
                              <div
                                key={index}
                                className="relative aspect-square rounded-xl overflow-hidden border border-border bg-muted/20 cursor-zoom-in"
                                onClick={() => openImageModal(url)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault()
                                    openImageModal(url)
                                  }
                                }}
                              >
                                <img src={url} alt={`Result ${index + 1}`} className="absolute inset-0 h-full w-full object-cover" />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="relative mx-auto aspect-square max-w-xl overflow-hidden rounded-2xl border border-dashed border-border/70 bg-muted/20 flex items-center justify-center">
                            <div className="text-center space-y-2 text-muted-foreground">
                              <AlertCircle className="size-8 mx-auto" />
                              <p className="text-sm">Final result will appear here</p>
                            </div>
                          </div>
                        )}
                      </TabsContent>
                    </Tabs>

                    <div className="mt-6 w-full max-w-3xl mx-auto space-y-2">
                      <Button
                        onClick={handleApply}
                        disabled={!modelFile || !patternFile || isProcessing}
                        className="w-full gap-2"
                      >
                        {isProcessing ? (
                          <>
                            <Clock className="size-4 animate-spin" />
                            Applying...
                          </>
                        ) : (
                          <>
                            <Palette className="size-4" />
                            Extract Patterns
                          </>
                        )}
                      </Button>
                      {error && <p className="text-sm text-center text-destructive">{error}</p>}
                    </div>

                    {isProcessing && (
                      <div className="mt-6 rounded-lg border border-primary/50 bg-primary/5 p-6">
                        <div className="space-y-4">
                          <div className="flex items-center gap-2">
                            <div className="size-2 rounded-full bg-primary animate-pulse" />
                            <span className="text-sm font-medium">{processingStep}</span>
                          </div>
                          <Progress value={progress} className="w-full" />
                          <p className="text-xs text-muted-foreground">
                            {taskId ? `Task ID: ${taskId}` : "Waiting for task assignment..."}
                          </p>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

            </div>

            <div
              className={`relative w-full shrink-0 transition-[width] duration-300 ease-in-out min-w-[3rem] ${
                isGalleryCollapsed ? "lg:w-[3.5rem]" : "lg:w-full"
              }`}
            >
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => {
                  if (isGalleryLocked) return
                  setIsGalleryCollapsed((prev) => !prev)
                }}
                aria-label={
                  isGalleryLocked
                    ? "Gallery toggle disabled after upload"
                    : isGalleryCollapsed
                      ? "Expand gallery"
                      : "Collapse gallery"
                }
                className="absolute right-3 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border-border bg-background shadow-sm lg:-left-3 lg:right-auto disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isGalleryLocked}
              >
                {isGalleryCollapsed ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
              </Button>
              <AnimatePresence initial={false}>
                {isGalleryCollapsed ? null : (
                  <motion.aside
                    key="apply-gallery"
                    initial={{ opacity: 0, x: 40 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 40 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-4"
                  >
                    <Card className="border-border/50 bg-card/80 shadow-sm backdrop-blur">
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-base font-semibold">
                          <CheckCircle className="size-4 text-primary" />
                          Quick Start
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3 text-sm text-muted-foreground">
                        <ol className="list-decimal space-y-2 pl-5 text-xs sm:text-sm">
                          <li>上传一张模特图和一张花型图。</li>
                          <li>
                            点击 <span className="font-medium text-foreground">Apply Pattern</span>。
                          </li>
                        </ol>
                      </CardContent>
                    </Card>
                    <div className="space-y-4 rounded-3xl border border-border/40 bg-card/80 p-6 shadow-sm backdrop-blur">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-foreground">Gallery</p>
                        <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <ImageIcon className="size-5" />
                        </div>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        {applyGalleryShots.map((shot) => (
                          <button
                            key={shot.title}
                            type="button"
                            onClick={() => openImageModal(shot.src.src)}
                            className="group w-full overflow-hidden rounded-2xl border border-border/60 bg-background/70 text-left transition hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                          >
                            <div className="relative flex items-center justify-center bg-muted">
                              <Image
                                src={shot.src}
                                alt={shot.alt}
                                width={shot.src.width}
                                height={shot.src.height}
                                className="h-auto w-full max-h-72 object-contain transition-transform duration-300 group-hover:scale-[1.02]"
                                sizes="(min-width: 1024px) 320px, 100vw"
                              />
                            </div>
                            <div className="space-y-1 p-3">
                              <p className="text-sm font-medium text-foreground">{shot.title}</p>
                              <p className="text-xs text-muted-foreground">{shot.description}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </motion.aside>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
      {isModalOpen && modalImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={closeImageModal}
          role="presentation"
        >
          <div className="relative flex max-h-[90vh] max-w-[90vw] items-center justify-center">
            <img
              src={modalImage}
              alt="Enlarged view"
              className="h-auto w-auto max-h-[90vh] max-w-[90vw] object-contain"
              onClick={(e) => e.stopPropagation()}
            />
            <Button
              variant="outline"
              size="sm"
              className="absolute top-4 right-4 bg-black/50 text-white border-white/20 hover:bg-black/70"
              onClick={closeImageModal}
            >
              Close
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
