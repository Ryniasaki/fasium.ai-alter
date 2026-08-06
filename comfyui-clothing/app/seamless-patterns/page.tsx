"use client"

import React from "react"

import { useState, useRef, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Scissors,
  Zap,
  ImageIcon,
  CheckCircle,
  Layers,
  Clock,
  ChevronLeft,
  ChevronRight,
  Download,
  Grid2X2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import { CollapsibleHeader } from "@/components/collapsible-header"
import Image, { type StaticImageData } from "next/image"
import { useRouter } from "next/navigation"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { extractApiClient } from "@/lib/extract-api-client"
import { useAuth } from "@/contexts/auth-context"
import patternTexture from "@/image/F6.png"
import previewSeamlessOne from "@/image/preview/f6_seamless.webp"
import previewSeamlessTwo from "@/image/preview/f6_seamless (2).webp"


const SEAMLESS_STORAGE_KEY = "extract_seamless_payload"
const REDESIGN_STORAGE_KEY = "redesign_prefill_payload"

export function SeamlessPatternsPage() {
  const { isAuthenticated, isLoading } = useAuth()
  const router = useRouter()
  const [uploadedImage, setUploadedImage] = useState<string | null>(null)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [processingStep, setProcessingStep] = useState("")
  const [extractedImages, setExtractedImages] = useState<string[]>([])
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [activeTab, setActiveTab] = useState("original")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isGalleryCollapsed, setIsGalleryCollapsed] = useState(false)
  const [isGalleryLocked, setIsGalleryLocked] = useState(false)
  const layoutColumns = isGalleryCollapsed ? "lg:grid-cols-[minmax(0,1fr)_3.5rem]" : "lg:grid-cols-2"

  React.useEffect(() => {
    if (uploadedImage && !isGalleryLocked) {
      setIsGalleryCollapsed(true)
      setIsGalleryLocked(true)
    }
  }, [uploadedImage, isGalleryLocked])

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        setUploadedImage(e.target?.result as string)
      }
      reader.readAsDataURL(file)
      setUploadedFile(file)
    }
  }

  const handleExtract = async () => {
    if (!uploadedFile) return

    setIsProcessing(true)
    setProgress(0)
    setProcessingStep("Submitting extract task...")

    try {
      const resp = await extractApiClient.submitSeamlessPattern(uploadedFile)
      setProgress(25)
      setProcessingStep("Waiting task to complete...")

      // poll status
      const maxAttempts = 60
      const delay = 2000
      let status
      for (let i = 0; i < maxAttempts; i++) {
        status = await extractApiClient.getTaskStatus(resp.taskId)
        if (status.status === 'SUCCESS' || status.status === 'FAILED') break
        await new Promise(r => setTimeout(r, delay))
      }

      if (!status || status.status !== 'SUCCESS') {
        throw new Error('提取任务失败')
      }

      setProgress(75)
      setProcessingStep("Downloading results...")
      const outputs = await extractApiClient.completeTask(resp.taskId)
      setExtractedImages(outputs.outputs)
      setActiveTab("extracted")
    } catch (e) {
      console.error('Extract error:', e)
    } finally {
      setIsProcessing(false)
      setProcessingStep("")
      setProgress(100)
    }
  }

  const handleSendToRedesign = useCallback((imageUrl: string) => {
    if (typeof window === "undefined") return
    try {
      const payload = {
        imageUrl,
        source: "seamless-patterns",
        createdAt: Date.now(),
      }
      window.sessionStorage.setItem(REDESIGN_STORAGE_KEY, JSON.stringify(payload))
    } catch (error) {
      console.error("Failed to cache redesign payload:", error)
    }
    router.push("/redesign")
  }, [router])

  const handleOpenPreview = (url: string) => {
    setPreviewImageUrl(url)
    setIsPreviewOpen(true)
  }

  React.useEffect(() => {
    if (typeof window === "undefined") return

    const hydrateFromSession = async () => {
      try {
        const stored = window.sessionStorage.getItem(SEAMLESS_STORAGE_KEY)
        if (!stored) return
        const payload = JSON.parse(stored) as {
          primaryImage?: string
          galleryImages?: string[]
          generatedAt?: number
          sourceImage?: string | null
        }
        const primaryImage =
          payload?.primaryImage && typeof payload.primaryImage === "string" && payload.primaryImage.length > 0
            ? payload.primaryImage
            : null
        const fallbackSource =
          payload?.sourceImage && typeof payload.sourceImage === "string" && payload.sourceImage.length > 0
            ? payload.sourceImage
            : null
        const activeImage = primaryImage ?? fallbackSource
        if (activeImage) {
          setUploadedImage(activeImage)
          try {
            const response = await fetch(activeImage)
            if (!response.ok) throw new Error(`Fetch failed with status ${response.status}`)
            const blob = await response.blob()
            const fileName = `seamless-${Date.now()}.${blob.type.split("/")[1] || "png"}`
            const file = new File([blob], fileName, { type: blob.type || "image/png" })
            setUploadedFile(file)
          } catch (fileError) {
            console.error("Prepare seamless pattern file failed:", fileError)
          }
        }
        const galleryImages = Array.isArray(payload?.galleryImages) ? payload.galleryImages.filter(Boolean) : []
        setExtractedImages(galleryImages)
        setActiveTab("original")
      } catch (error) {
        console.error("Load seamless pattern payload failed:", error)
      } finally {
        window.sessionStorage.removeItem(SEAMLESS_STORAGE_KEY)
      }
    }

    void hydrateFromSession()
  }, [])

  React.useEffect(() => {
    if (!isPreviewOpen) {
      setPreviewImageUrl(null)
    }
  }, [isPreviewOpen])

  // Settings 部分已简化，仅保留操作按钮

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <CollapsibleHeader
        title="Seamless Pattern Studio"
        description="Design tiling-ready patterns with AI-powered refinement"
        icon={<Layers className="size-4 text-primary-foreground" />}
      />

      <div className="container mx-auto px-6 py-8">
        <div className={`grid gap-8 lg:items-start ${layoutColumns}`}>
          {/* Left Panel - Preview */}
          <div>
            <Card className="border-border/50 h-full">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <ImageIcon className="size-5" />
                    Seamless Preview
                  </CardTitle>
                  {/* 去掉九宫格、刷新、导出按钮 */}
                </div>
              </CardHeader>
              <CardContent className="flex-1">
                <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
                  <DialogContent className="max-w-3xl border-border/70 bg-background/95">
                    {previewImageUrl && (
                      <div className="relative mx-auto aspect-square w-full max-w-2xl overflow-hidden rounded-lg border">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={previewImageUrl} alt="Pattern preview enlarged" className="h-full w-full object-contain" />
                      </div>
                    )}
                  </DialogContent>
                </Dialog>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="original">Original</TabsTrigger>
                    <TabsTrigger value="extracted">Generated</TabsTrigger>
                  </TabsList>

                  <TabsContent value="original" className="mt-6">
                    {uploadedImage ? (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="relative mx-auto block aspect-square w-full max-w-md overflow-hidden rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 group"
                        aria-label="Change model image"
                      >
                        <Image
                          src={uploadedImage || "/placeholder.svg"}
                          alt="Original model image"
                          fill
                          className="object-cover"
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                          <span className="text-sm font-medium text-white">Click to change image</span>
                        </div>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="relative flex h-96 w-full items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-border text-center transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                        aria-label="Upload model image"
                      >
                        <span
                          className="pointer-events-none absolute inset-0 opacity-20 seamless-pattern-scroll"
                          aria-hidden="true"
                          style={{
                            backgroundImage: `url(${patternTexture.src})`,
                            backgroundRepeat: "repeat-x",
                            backgroundSize: "auto 100%",
                            backgroundPosition: "0% 50%",
                          }}
                        />
                        <div className="relative z-10 flex flex-col items-center gap-4">
                          <Grid2X2 className="size-12 text-muted-foreground/60" aria-hidden="true" />
                          <div>
                            <p className="text-lg font-medium">Upload a pattern image</p>
                            <p className="text-sm text-muted-foreground">Generate seamless patterns from your upload</p>
                          </div>
                        </div>
                      </button>
                    )}
                  </TabsContent>

                  <TabsContent value="extracted" className="mt-6">
                    <div className="flex flex-col items-center space-y-6">
                      {extractedImages.length > 0 ? (
                        <div className="flex w-full flex-col items-center gap-10">
                          {extractedImages.map((url, i) => (
                            <div
                              key={i}
                              className="relative mx-auto w-full max-w-md"
                            >
                              <button
                                type="button"
                                onClick={() => handleOpenPreview(url)}
                                className="relative block aspect-square w-full overflow-hidden rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 group"
                                aria-label={`Preview generated pattern ${i + 1}`}
                              >
                                <Image
                                  src={url}
                                  alt={`generated-${i}`}
                                  fill
                                  className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                                />
                                <div className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity group-hover:opacity-100">
                                  <span className="text-sm font-medium text-white">Click to preview</span>
                                </div>
                              </button>
                              <Badge className="absolute left-3 top-3 text-xs">generated</Badge>
                              <div className="absolute right-3 top-3 flex flex-col items-end gap-2">
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  className="h-7 px-3 text-xs"
                                  onClick={() => handleSendToRedesign(url)}
                                >
                                  Redesign
                                </Button>
                                <a
                                  href={url}
                                  download
                                  className="inline-flex items-center gap-1 rounded-full border border-border bg-background/85 px-3 py-1 text-xs font-medium shadow-sm transition hover:bg-background"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                  Download
                                </a>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex h-96 w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-border text-center space-y-4">
                          <ImageIcon className="mx-auto size-12 text-muted-foreground" />
                          <div>
                            <p className="text-lg font-medium">No patterns yet</p>
                            <p className="text-sm text-muted-foreground">Upload an image and run generation to view seamless results.</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </TabsContent>

                </Tabs>

                <div className="mt-6 w-full max-w-3xl mx-auto">
                  {activeTab === "original" && (
                    <Button onClick={handleExtract} disabled={isProcessing} className="w-full gap-2">
                      {isProcessing ? (
                        <>
                          <Clock className="size-4 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Layers className="size-4" />
                          Generate Patterns
                        </>
                      )}
                    </Button>
                  )}
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
                        Processing time: ~{Math.ceil(((100 - progress) / 25) * 1.5)}s remaining
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
          {/* Right Panel - Gallery */}
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
              aria-label={isGalleryCollapsed ? "Expand gallery" : "Collapse gallery"}
              disabled={isGalleryLocked}
              className="absolute right-3 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border-border bg-background shadow-sm lg:-left-3 lg:right-auto disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isGalleryCollapsed ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
            </Button>
            <AnimatePresence initial={false}>
              {isGalleryCollapsed ? null : (
                <motion.aside
                  key="seamless-gallery"
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
                        <li>上传一张需要生成无缝纹理的花型图。</li>
                        <li>点击 <span className="font-medium text-foreground">Generate Patterns</span>。</li>
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
                      {seamlessGalleryShots.map((shot) => (
                        <button
                          key={shot.title}
                          type="button"
                          onClick={() => handleOpenPreview(shot.src.src)}
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
  )
}

export default function SeamlessPatternsPageRoute() {
  return <SeamlessPatternsPage />
}

type SeamlessGalleryShot = {
  src: StaticImageData
  title: string
  description: string
  alt: string
}

const seamlessGalleryShots: SeamlessGalleryShot[] = [
  {
    src: previewSeamlessOne,
    title: "Seamless Tiling",
    description: "花型自动拼接成无缝纹理，直接检查循环边缘是否自然。",
    alt: "Seamless tiling pattern preview",
  },
  {
    src: previewSeamlessTwo,
    title: "Texture Variants",
    description: "同一花型生成不同密度与缩放，便于挑选理想的材质排版。",
    alt: "Texture variants seamless preview",
  },
]
