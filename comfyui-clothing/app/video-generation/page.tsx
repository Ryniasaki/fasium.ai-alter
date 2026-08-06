"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { motion } from "framer-motion"
import {
  Download,
  Shirt,
  RotateCcw,
  Settings,
  Zap,
  ImageIcon,
  Users,
  ArrowRight,
  CheckCircle,
  Clock,
  AlertCircle,
  Eye,
  Camera,
  Video,
  Shuffle,
  User,
  Play,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import { Label } from "@/components/ui/label"
import { CollapsibleHeader } from "@/components/collapsible-header"
import Image from "next/image"
import { videoGenerationApiClient } from "@/lib/video-generation-api-client"
import { formatStatusMessage } from "@/lib/task-status-message"

export default function VideoGenerationPage() {
  const [inputImage, setInputImage] = useState<string | null>(null)
  const [inputFile, setInputFile] = useState<File | null>(null)
  const [prompt, setPrompt] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [processingStep, setProcessingStep] = useState("")
  const [loopVideo] = useState(true)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [tenantTaskId, setTenantTaskId] = useState<string | null>(null)
  const [generatedOutput, setGeneratedOutput] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        setInputImage(e.target?.result as string)
      }
      reader.readAsDataURL(file)
      setInputFile(file)
      setGeneratedOutput(null)
      setTaskId(null)
      setTenantTaskId(null)
      setError(null)
      setProgress(0)
      setProcessingStep("")
    }
  }

  const handleVideoGeneration = async () => {
    if (!inputFile) {
      setError("Please upload an input image before generating a video.")
      return
    }

    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) {
      setError("Please provide a prompt for the video generation.")
      return
    }

    setIsProcessing(true)
    setError(null)
    setGeneratedOutput(null)
    setTaskId(null)
    setTenantTaskId(null)
    setProgress(5)
    setProcessingStep("Uploading image and creating workflow task...")

    try {
      const response = await videoGenerationApiClient.submitVideoGeneration(
        inputFile,
        trimmedPrompt
      )

      if (!isMountedRef.current) return

      setTaskId(response.taskId)
      setTenantTaskId(response.tenantTaskId ?? null)
      const progressAfterTaskCreation = 25
      const progressCeiling = 75
      const pollingIntervalMs = 3000
      const estimatedProcessingMs = 4 * 60 * 1000 // ~4 minutes

      setProcessingStep("Waiting for video generation to finish...")
      setProgress(progressAfterTaskCreation)

      const maxAttempts = 120
      let attempt = 0
      let completed = false

      while (attempt < maxAttempts) {
        if (!isMountedRef.current) {
          return
        }

        const status = await videoGenerationApiClient.getTaskStatus(
          response.taskId
        )

        if (!isMountedRef.current) {
          return
        }

        if (status.status === "SUCCESS") {
          completed = true
          break
        }

        if (status.status === "FAILED") {
          throw new Error(formatStatusMessage(status.message, "Video generation failed."))
        }

        attempt += 1
        setProcessingStep(formatStatusMessage(status.message, "Video generation in progress..."))
        setProgress((prev) => {
          const elapsedMs = attempt * pollingIntervalMs
          const ratio = Math.min(elapsedMs / estimatedProcessingMs, 1)
          const simulatedProgress =
            progressAfterTaskCreation +
            Math.round(
              (progressCeiling - progressAfterTaskCreation) * ratio
            )
          return Math.max(prev, Math.min(simulatedProgress, progressCeiling))
        })
        await new Promise((resolve) => setTimeout(resolve, pollingIntervalMs))
      }

      if (!completed) {
        throw new Error("Video generation timed out. Please try again later.")
      }

      setProcessingStep("Retrieving generated video...")
      setProgress(90)

      const { outputs } = await videoGenerationApiClient.completeTask(
        response.taskId
      )

      if (!isMountedRef.current) {
        return
      }

      const firstOutput = outputs?.[0]
      if (!firstOutput) {
        throw new Error("No video output returned. Please retry the request.")
      }

      setGeneratedOutput(firstOutput)
      setProcessingStep("Video generation complete.")
      setProgress(100)
    } catch (err) {
      if (!isMountedRef.current) return
      setProcessingStep("")
      setGeneratedOutput(null)
      setProgress(0)
      setError(
        err instanceof Error ? err.message : "Video generation failed. Please try again."
      )
    } finally {
      if (isMountedRef.current) {
        setIsProcessing(false)
      }
    }
  }

  const isGeneratedVideo =
    !!generatedOutput &&
    (/\.(mp4|webm|mov|gif)(\?|$)/i.test(generatedOutput) ||
      generatedOutput.startsWith("data:video"))

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <CollapsibleHeader
        title="Video Generation"
        description="AI-powered virtual try-on video creation"
        icon={<Video className="size-4 text-white" />}
      />

      <div className="container mx-auto px-6 py-8">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Left Panel - Controls */}
          <div className="lg:col-span-1 space-y-6">
            {/* Prompt Input */}
            <Card className="border-border/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="size-5" />
                  Video Prompt
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="prompt" className="text-sm font-medium">Describe your video</Label>
                  <textarea
                    id="prompt"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="A person walking in a red dress, cinematic lighting, slow motion..."
                    className="w-full min-h-[100px] px-3 py-2 border border-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <p className="text-xs text-muted-foreground">
                    Describe the video you want to generate based on your image
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Image Upload */}
            <Card className="border-border/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ImageIcon className="size-5" />
                  Input Image
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div
                  className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => imageInputRef.current?.click()}
                >
                  {inputImage ? (
                    <div className="space-y-2">
                      <CheckCircle className="size-6 text-primary mx-auto" />
                      <p className="text-sm font-medium">Image uploaded</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Camera className="size-6 text-muted-foreground mx-auto" />
                      <p className="text-sm font-medium">Upload image</p>
                      <p className="text-xs text-muted-foreground">JPG, PNG, or WebP</p>
                    </div>
                  )}
                </div>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </CardContent>
            </Card>

            {/* Video Settings */}
            {inputImage && prompt.trim() && (
              <Card className="border-border/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Settings className="size-5" />
                    Video Settings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Button
                    onClick={handleVideoGeneration}
                    disabled={isProcessing || !inputFile || !prompt.trim()}
                    className="w-full gap-2"
                  >
                    {isProcessing ? (
                      <>
                        <Clock className="size-4 animate-spin" />
                        Generating Video...
                      </>
                    ) : (
                      <>
                        <Video className="size-4" />
                        Generate Video
                      </>
                    )}
                  </Button>
                  {error && (
                    <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      <AlertCircle className="mt-0.5 size-4" />
                      <span>{error}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Processing Status */}
            {(isProcessing || taskId || tenantTaskId) && (
              <Card className="border-chart-4/50 bg-chart-4/5">
                <CardContent className="pt-6">
                  <div className="space-y-4">
                    {processingStep && (
                      <div className="flex items-center gap-2">
                        <div className={`size-2 rounded-full ${isProcessing ? "bg-chart-4 animate-pulse" : "bg-chart-4/60"}`} />
                        <span className="text-sm font-medium">{processingStep}</span>
                      </div>
                    )}
                    {isProcessing && (
                      <>
                        <Progress value={progress} className="w-full" />
                        <p className="text-xs text-muted-foreground">
                          Video generation may take a little while; keep this tab open while we work on it.
                        </p>
                      </>
                    )}
                    {!isProcessing && !error && generatedOutput && (
                      <p className="text-xs text-chart-4">
                        Your video is ready! Scroll right to preview and download the result.
                      </p>
                    )}
                    {!isProcessing && error && (
                      <p className="text-xs text-destructive">
                        {error}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Panel - Preview */}
          <div className="lg:col-span-2">
            <Card className="border-border/50 h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Video className="size-5" />
                  Video Preview
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1">
                {inputImage && prompt.trim() ? (
                  <Tabs defaultValue="result" className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="input">Input</TabsTrigger>
                      <TabsTrigger value="result">Video</TabsTrigger>
                    </TabsList>

                    <TabsContent value="input" className="mt-6">
                      <div className="space-y-4">
                        <div className="relative aspect-[3/4] max-w-sm mx-auto rounded-lg overflow-hidden border border-border">
                          <Image
                            src={inputImage || "/placeholder.svg"}
                            alt="Input image"
                            fill
                            className="object-cover"
                          />
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-medium mb-2">Input Image</p>
                          <p className="text-xs text-muted-foreground">{prompt}</p>
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="result" className="mt-6">
                      <div className="relative aspect-[3/4] max-w-sm mx-auto rounded-lg border border-border bg-muted/20 flex items-center justify-center overflow-hidden">
                        {isProcessing ? (
                          <div className="text-center space-y-4">
                            <div className="size-12 border-2 border-chart-4 border-t-transparent rounded-full animate-spin mx-auto" />
                            <p className="text-sm text-muted-foreground">
                              Generating video...
                            </p>
                          </div>
                        ) : generatedOutput ? (
                          isGeneratedVideo ? (
                            <video
                              key={generatedOutput}
                              src={generatedOutput}
                              controls
                              loop={loopVideo}
                              className="h-full w-full object-contain bg-black"
                            />
                          ) : (
                            <img
                              key={generatedOutput}
                              src={generatedOutput}
                              alt="Generated result"
                              className="h-full w-full object-cover"
                            />
                          )
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="text-center space-y-2">
                              <Video className="size-8 text-muted-foreground mx-auto" />
                              <p className="text-sm text-muted-foreground">
                                Generated video will appear here
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    </TabsContent>

                  </Tabs>
                ) : (
                  <div className="flex items-center justify-center h-96 border-2 border-dashed border-border rounded-lg">
                    <div className="text-center space-y-4">
                      <div className="flex gap-4 justify-center">
                        <div className="text-center">
                          <Zap className="size-8 text-muted-foreground mx-auto mb-2" />
                          <p className="text-sm text-muted-foreground">Enter Prompt</p>
                        </div>
                        <ArrowRight className="size-6 text-muted-foreground mt-1" />
                        <div className="text-center">
                          <Camera className="size-8 text-muted-foreground mx-auto mb-2" />
                          <p className="text-sm text-muted-foreground">Upload Image</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-lg font-medium">Enter prompt and upload image to start</p>
                        <p className="text-sm text-muted-foreground">
                          Describe the video you want to generate
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Video Gallery */}
        <div className="mt-8">
          <h3 className="text-lg font-semibold mb-4">Video Gallery</h3>
          <div className="grid md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.1 }}
              >
                <Card className="border-border/50 hover:border-chart-4/50 transition-colors cursor-pointer group">
                  <CardContent className="p-4">
                    <div className="aspect-[3/4] rounded-lg bg-gradient-to-br from-chart-4/10 to-primary/10 mb-3 flex items-center justify-center">
                      <Video className="size-8 text-muted-foreground group-hover:text-chart-4 transition-colors" />
                    </div>
                    <h4 className="font-medium mb-1">Video {i}</h4>
                    <p className="text-xs text-muted-foreground mb-2">Model A • Blue Dress • 5s</p>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="size-8 p-0">
                        <Eye className="size-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="size-8 p-0">
                        <Download className="size-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="size-8 p-0">
                        <Play className="size-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
