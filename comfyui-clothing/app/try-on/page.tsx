"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Download,
  Shirt,
  Settings,
  Zap,
  ImageIcon,
  Users,
  ArrowRight,
  CheckCircle,
  Clock,
  Eye,
  Camera,
  User,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import { CollapsibleHeader } from "@/components/collapsible-header"
import Image, { type StaticImageData } from "next/image"
import { redesignApiClient, type TaskStatusResponse } from "@/lib/redesign-api-client"
import previewTryOnOne from "@/image/preview/f4_virtual_tryon (1).webp"
import previewTryOnTwo from "@/image/preview/f4_virtual_tryon (2).webp"

const TRY_ON_PROMPT = "将图片2中的服装套到图片1的模特身上"

type TryOnGalleryShot = {
  src: StaticImageData
  title: string
  description: string
  alt: string
}

const tryOnGalleryShots: TryOnGalleryShot[] = [
  {
    src: previewTryOnOne,
    title: "True-to-Body Fit",
    description: "根据模特体态生成贴合的上身效果，辅助评估尺码合体度。",
    alt: "Virtual try-on true to body preview",
  },
  {
    src: previewTryOnTwo,
    title: "Fabric Realism",
    description: "呈现布料垂坠与光泽细节，让材质质感更真实可信。",
    alt: "Virtual try-on fabric realism preview",
  },
]

export default function TryOnPage() {
  const [modelImage, setModelImage] = useState<string | null>(null)
  const [garmentImage, setGarmentImage] = useState<string | null>(null)
  const [modelFile, setModelFile] = useState<File | null>(null)
  const [garmentFile, setGarmentFile] = useState<File | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [processingStep, setProcessingStep] = useState("")
  const [activeTab, setActiveTab] = useState("model")
  const [resultImages, setResultImages] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalImage, setModalImage] = useState<string | null>(null)
  const modelInputRef = useRef<HTMLInputElement>(null)
  const garmentInputRef = useRef<HTMLInputElement>(null)
  const [isGalleryCollapsed, setIsGalleryCollapsed] = useState(false)
  const layoutColumns = isGalleryCollapsed ? "lg:grid-cols-[minmax(0,1fr)_3.5rem]" : "lg:grid-cols-2"
  const isGalleryLocked = Boolean(modelImage || garmentImage)

  useEffect(() => {
    if (isGalleryLocked && !isGalleryCollapsed) {
      setIsGalleryCollapsed(true)
    }
  }, [isGalleryLocked, isGalleryCollapsed])

  const handleModelUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setModelFile(file)
    const reader = new FileReader()
    reader.onload = (e) => {
      setModelImage(e.target?.result as string)
    }
    reader.readAsDataURL(file)
  }

  const handleGarmentUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setGarmentFile(file)
    const reader = new FileReader()
    reader.onload = (e) => {
      setGarmentImage(e.target?.result as string)
    }
    reader.readAsDataURL(file)
  }

  const pollTaskStatus = async (id: string): Promise<TaskStatusResponse> => {
    const maxAttempts = 180
    const delay = 2000

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const status = await redesignApiClient.getTaskStatus(id)
      if (status.status === "SUCCESS" || status.status === "FAILED") {
        return status
      }
      await new Promise((resolve) => setTimeout(resolve, delay))
    }

    throw new Error("Try-on task polling timeout")
  }

  const handleTryOn = async () => {
    if (!modelFile || !garmentFile) {
      setError("Please upload both model and garment images before trying on.")
      return
    }

    setIsProcessing(true)
    setProgress(0)
    setProcessingStep("Submitting try-on request...")
    setError(null)
    setResultImages([])
    setActiveTab("result")

    try {
      const response = await redesignApiClient.submitRedesign({
        prompt: TRY_ON_PROMPT,
        image: modelFile,
        image_2: garmentFile,
      })

      setProgress(30)
      setProcessingStep("Waiting for completion...")

      const finalStatus = await pollTaskStatus(response.taskId)
      if (finalStatus.status !== "SUCCESS") {
        throw new Error("Try-on task failed to complete successfully.")
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
      console.error("Try-on error:", err)
      setError(err instanceof Error ? err.message : "An unexpected error occurred.")
      setProcessingStep("")
    } finally {
      setIsProcessing(false)
    }
  }

  const handleViewResult = (url: string) => {
    setModalImage(url)
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setModalImage(null)
  }

  const handleDownloadResult = (url: string) => {
    try {
      const link = document.createElement("a")
      link.href = url
      link.download = `try-on-${Date.now()}.png`
      link.click()
      link.remove()
    } catch (err) {
      console.error("Download error:", err)
    }
  }

  return (
    <>
      <div className="min-h-screen bg-background">
        {/* Header */}
        <CollapsibleHeader
          title="Virtual Try-On"
          description="AI-powered virtual fitting and styling"
        icon={<Shirt className="size-4 text-white" />}
      />

        <div className="container mx-auto px-6 py-8">
          <div className={`grid gap-8 lg:items-start ${layoutColumns}`}>
            <div className="space-y-8">
              <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)]">
                {/* Left Panel - Controls */}
                <div className="space-y-6">
                {/* Model Selection */}
                <Card className="border-border/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="size-5" />
                      Model Selection
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div
                      className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                      onClick={() => modelInputRef.current?.click()}
                    >
                      {modelImage ? (
                        <div className="space-y-2">
                          <CheckCircle className="size-6 text-primary mx-auto" />
                          <p className="text-sm font-medium">Model image uploaded</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <User className="size-6 text-muted-foreground mx-auto" />
                          <p className="text-sm font-medium">Upload model image</p>
                          <p className="text-xs text-muted-foreground">Supports portrait photos</p>
                        </div>
                      )}
                    </div>
                    <input
                      ref={modelInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleModelUpload}
                      className="hidden"
                    />
                  </CardContent>
                </Card>

                {/* Garment Selection */}
                <Card className="border-border/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Shirt className="size-5" />
                      Garment Selection
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div
                      className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-chart-4/50 transition-colors"
                      onClick={() => garmentInputRef.current?.click()}
                    >
                      {garmentImage ? (
                        <div className="space-y-2">
                          <CheckCircle className="size-6 text-chart-4 mx-auto" />
                          <p className="text-sm font-medium">Garment uploaded</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Shirt className="size-6 text-muted-foreground mx-auto" />
                          <p className="text-sm font-medium">Upload garment</p>
                        </div>
                      )}
                    </div>
                    <input
                      ref={garmentInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleGarmentUpload}
                      className="hidden"
                    />
                  </CardContent>
                </Card>

                {/* Try On */}
                {modelImage && garmentImage && (
                  <Card className="border-border/50">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Settings className="size-5" />
                        Try On
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Button onClick={handleTryOn} disabled={isProcessing} className="w-full gap-2">
                        {isProcessing ? (
                          <>
                            <Clock className="size-4 animate-spin" />
                            Processing...
                          </>
                        ) : (
                          <>
                            <Camera className="size-4" />
                            Try On Garment
                          </>
                        )}
                      </Button>
                      {error && (
                        <p className="text-sm text-destructive text-center">
                          {error}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Processing Status */}
                {isProcessing && (
                  <Card className="border-chart-4/50 bg-chart-4/5">
                    <CardContent className="pt-6">
                      <div className="space-y-4">
                        <div className="flex items-center gap-2">
                          <div className="size-2 rounded-full bg-chart-4 animate-pulse" />
                          <span className="text-sm font-medium">{processingStep}</span>
                        </div>
                        <Progress value={progress} className="w-full" />
                        <p className="text-xs text-muted-foreground">
                          Processing time: ~{Math.ceil(((100 - progress) / 25) * 1.5)}s remaining
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Right Panel - Preview */}
              <div>
            <Card className="border-border/50 h-full">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <ImageIcon className="size-5" />
                    Try-On Preview
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="flex-1">
                {modelImage && garmentImage ? (
                  <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <TabsList className="grid w-full grid-cols-3">
                      <TabsTrigger value="model">Model</TabsTrigger>
                      <TabsTrigger value="garment">Garment</TabsTrigger>
                      <TabsTrigger value="result">Result</TabsTrigger>
                    </TabsList>

                    <TabsContent value="model" className="mt-6">
                      <div className="relative aspect-[3/4] max-w-sm mx-auto rounded-lg overflow-hidden border border-border">
                        <Image
                          src={modelImage || "/placeholder.svg"}
                          alt="Selected model"
                          fill
                          className="object-cover"
                        />
                      </div>
                    </TabsContent>

                    <TabsContent value="garment" className="mt-6">
                      <div className="relative aspect-square max-w-sm mx-auto rounded-lg overflow-hidden border border-border">
                        <Image
                          src={garmentImage || "/placeholder.svg"}
                          alt="Selected garment"
                          fill
                          className="object-cover"
                        />
                      </div>
                    </TabsContent>

                    <TabsContent value="result" className="mt-6">
                      {isProcessing ? (
                        <div className="relative aspect-[3/4] max-w-sm mx-auto rounded-lg overflow-hidden border border-border bg-muted/20 flex items-center justify-center">
                          <div className="text-center space-y-4">
                            <div className="size-12 border-2 border-chart-4 border-t-transparent rounded-full animate-spin mx-auto" />
                            <p className="text-sm text-muted-foreground">
                              Creating try-on...
                            </p>
                          </div>
                        </div>
                      ) : resultImages.length > 0 ? (
                        <div className="grid gap-4 md:grid-cols-2">
                          {resultImages.map((url, index) => (
                            <motion.div
                              key={`${url}-${index}`}
                              initial={{ opacity: 0, scale: 0.9 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={{ delay: index * 0.05 }}
                            >
                              <div
                                className="relative aspect-[3/4] rounded-lg overflow-hidden border border-border bg-muted/20 cursor-zoom-in"
                                onClick={() => handleViewResult(url)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault()
                                    handleViewResult(url)
                                  }
                                }}
                              >
                                <img
                                  src={url}
                                  alt={`Try-on result ${index + 1}`}
                                  className="absolute inset-0 h-full w-full object-cover"
                                />
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      ) : (
                        <div className="relative aspect-[3/4] max-w-sm mx-auto rounded-lg overflow-hidden border border-border bg-muted/20 flex items-center justify-center">
                          <div className="text-center space-y-2">
                            <Shirt className="size-8 text-muted-foreground mx-auto" />
                            <p className="text-sm text-muted-foreground">
                              Try-on result will appear here
                            </p>
                          </div>
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                ) : (
                  <div className="flex items-center justify-center h-96 border-2 border-dashed border-border rounded-lg">
                    <div className="text-center space-y-4">
                      <div className="flex gap-4 justify-center">
                        <div className="text-center">
                          <User className="size-8 text-muted-foreground mx-auto mb-2" />
                          <p className="text-sm text-muted-foreground">Select Model</p>
                        </div>
                        <ArrowRight className="size-6 text-muted-foreground mt-1" />
                        <div className="text-center">
                          <Shirt className="size-8 text-muted-foreground mx-auto mb-2" />
                          <p className="text-sm text-muted-foreground">Select Garment</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-lg font-medium">Select model and garment to start</p>
                        <p className="text-sm text-muted-foreground">
                          Upload a model and garment to begin virtual try-on
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Try-On Results */}
        <div className="mt-8">
          <h3 className="text-lg font-semibold mb-4">Try-On Results</h3>
          {resultImages.length > 0 ? (
            <div className="grid md:grid-cols-4 gap-4">
              {resultImages.map((url, index) => (
                <motion.div
                  key={`${url}-${index}`}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Card className="border-border/50 hover:border-chart-4/50 transition-colors">
                    <CardContent className="p-4 space-y-3">
                      <div
                        className="relative aspect-[3/4] rounded-lg overflow-hidden border border-border bg-muted/20 cursor-zoom-in"
                        onClick={() => handleViewResult(url)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault()
                            handleViewResult(url)
                          }
                        }}
                      >
                        <img
                          src={url}
                          alt={`Try-on result ${index + 1}`}
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium">Result {index + 1}</h4>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="size-8 p-0"
                            onClick={() => handleViewResult(url)}
                            aria-label={`View try-on result ${index + 1}`}
                          >
                            <Eye className="size-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="size-8 p-0"
                            onClick={() => handleDownloadResult(url)}
                            aria-label={`Download try-on result ${index + 1}`}
                          >
                            <Download className="size-3" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
              Upload a model and garment image to generate try-on results.
            </div>
          )}
        </div>
      </div>

      <div className="relative">
        <Button
          variant="ghost"
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
              key="try-on-gallery"
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
                    <li>上传一张模特图和一张服装图。</li>
                    <li>点击 <span className="font-medium text-foreground">Try On Garment</span>。</li>
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
                  {tryOnGalleryShots.map((shot) => (
                    <button
                      key={shot.title}
                      type="button"
                      onClick={() => handleViewResult(shot.src.src)}
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
          onClick={closeModal}
          role="presentation"
        >
          <div className="relative flex max-h-[90vh] max-w-[90vw] items-center justify-center">
            <img
              src={modalImage}
              alt="Enlarged try-on result"
              className="h-auto w-auto max-h-[90vh] max-w-[90vw] object-contain"
              onClick={(event) => event.stopPropagation()}
            />
            <Button
              variant="outline"
              size="sm"
              className="absolute top-4 right-4 bg-black/50 text-white border-white/20 hover:bg-black/70"
              onClick={closeModal}
            >
              Close
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
