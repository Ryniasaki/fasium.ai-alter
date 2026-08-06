"use client"

import React, { useRef, useState } from "react"
import {
  ImagePlus,
  ArrowRight,
  RefreshCw,
  Layers,
  Loader2,
  Check,
} from "lucide-react"
import { AppState } from "./types"
import {
  generateProductAnalysis,
  ProductImageSubmitResult,
  generateProductImagePrompts,
  ProductStyle,
  submitProductImageTasks,
} from "./services/admaster-service"

export default function AdmasterPage() {
  const toUserWarning = (raw?: string) => {
    const message = (raw || "").toLowerCase()
    if (
      message.includes("text model request failed") ||
      message.includes("did not pass moderation") ||
      message.includes("safety") ||
      message.includes("policy") ||
      message.includes("审核")
    ) {
      return "Some generated content was flagged by moderation. Please retry."
    }
    return raw || "Processing failed. Please retry."
  }

  const [showSubmitSuccess, setShowSubmitSuccess] = useState(false)
  const [successMessage, setSuccessMessage] = useState("Task submitted.")
  const [progressPercent, setProgressPercent] = useState(0)
  const [submittedImageResults, setSubmittedImageResults] = useState<ProductImageSubmitResult[]>([])
  const [style, setStyle] = useState<ProductStyle>("ATHLETIC")
  const [generationTarget, setGenerationTarget] = useState<"video" | "images">("images")
  const [state, setState] = useState<AppState>({
    sourceImage: null,
    analysis: null,
    assets: [],
    isProcessing: false,
    error: null,
    progressMessage: "",
  })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const processingAbortRef = useRef<AbortController | null>(null)

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      setState((prev) => ({
        ...prev,
        sourceImage: event.target?.result as string,
        assets: [],
        analysis: null,
      }))
    }
    reader.readAsDataURL(file)
  }

  const startCampaignGeneration = async () => {
    if (!state.sourceImage) return

    const controller = new AbortController()
    processingAbortRef.current = controller
    setProgressPercent(0)
    setSubmittedImageResults([])
    setState((prev) => ({ ...prev, isProcessing: true, error: null, progressMessage: "Please wait..." }))

    try {
      if (generationTarget === "video") {
        throw new Error("Video generation is coming soon.")
      } else {
        setProgressPercent(12)
        const analysis = await generateProductAnalysis(state.sourceImage, controller.signal)

        setProgressPercent(35)
        setState((prev) => ({ ...prev, analysis, progressMessage: "" }))
        const prompts = await generateProductImagePrompts(state.sourceImage, analysis, style, controller.signal)
        if (prompts.length === 0) {
          throw new Error("No product-image prompts generated")
        }

        const { submitted, failed, results } = await submitProductImageTasks(
          state.sourceImage,
          prompts,
          (ratio) => setProgressPercent(35 + Math.round(ratio * 60)),
          controller.signal,
        )
        setProgressPercent(100)
        if (submitted <= 0) {
          throw new Error("No image tasks were accepted. Please retry.")
        }
        setSubmittedImageResults(results)
        if (failed > 0) {
          setSuccessMessage("Your image tasks are completed.")
        } else {
          setSuccessMessage("Your image tasks are completed.")
        }
      }

      setShowSubmitSuccess(true)
      setState((prev) => ({
        ...prev,
        sourceImage: null,
        analysis: null,
        assets: [],
        isProcessing: false,
        progressMessage: "",
      }))
    } catch (error: any) {
      if (error?.name === "AbortError") {
        setState((prev) => ({
        ...prev,
        isProcessing: false,
        progressMessage: "",
      }))
        return
      }
      setState((prev) => ({
        ...prev,
        isProcessing: false,
        progressMessage: "",
        error: toUserWarning(error?.message),
      }))
      setProgressPercent(0)
    } finally {
      processingAbortRef.current = null
    }
  }

  const cancelProcessing = () => {
    processingAbortRef.current?.abort()
  }

  const reset = () => {
    setState({
      sourceImage: null,
      analysis: null,
      assets: [],
      isProcessing: false,
      error: null,
      progressMessage: "",
    })
    setProgressPercent(0)
    setSubmittedImageResults([])
  }

  const downloadAllGeneratedImages = () => {
    for (const item of submittedImageResults) {
      const link = document.createElement("a")
      link.href = item.imageUrl
      link.download = `admaster_${item.taskId}.png`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  }

  return (
    <div className="min-h-screen pb-40 selection:bg-white selection:text-black admaster-bg">
      <nav className="fixed top-0 w-full z-50 admaster-glass border-b border-white/10 px-8 py-5 flex justify-between items-center">
        <div className="flex items-center gap-3 cursor-pointer group" onClick={reset}>
          <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center group-hover:rotate-12 transition-transform duration-500">
            <Layers size={20} className="text-black" />
          </div>
          <span className="font-black text-xl tracking-[0.2em] uppercase">ADMASTER</span>
        </div>
        <div className="flex items-center gap-6">
          <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/40">
            {"Tenant Routed"}
          </span>
        </div>
      </nav>

      <main className="pt-32 max-w-[1400px] mx-auto px-8">
        <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center">
          <section className="w-full max-w-3xl">
            <div className="space-y-10">
              {!state.sourceImage ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="group relative border border-white/20 rounded-[3rem] p-20 hover:border-white/50 transition-all cursor-pointer bg-black/60 overflow-hidden"
                >
                  <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
                  <div className="relative flex items-center justify-center">
                    <ImagePlus className="text-white/75 group-hover:text-white transition-colors" size={52} />
                  </div>
                </div>
              ) : (
                <div className="relative group rounded-[3rem] overflow-hidden bg-black border border-white/10 p-3 aspect-video shadow-2xl">
                  <img src={state.sourceImage} className="w-full h-full object-contain rounded-[2.5rem]" alt="source" />
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-md">
                    <button
                      onClick={() => setState((p) => ({ ...p, sourceImage: null }))}
                      className="bg-white text-black px-10 py-4 rounded-full font-black uppercase tracking-widest text-xs hover:scale-105 transition-transform"
                    >
                      {"Change Product"}
                    </button>
                  </div>
                </div>
              )}

              {state.error && (
                <div className="p-6 bg-amber-400/15 border border-amber-400/45 text-amber-800 rounded-[2rem] text-sm font-bold uppercase tracking-widest">
                  {state.error}
                </div>
              )}

              {state.sourceImage && (
                <div className="rounded-[2rem] border border-zinc-300 bg-zinc-50 p-4">
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      disabled
                      onClick={() => {}}
                      className={`rounded-2xl px-5 py-4 text-sm font-bold uppercase tracking-[0.12em] transition-all ${
                        generationTarget === "video"
                          ? "bg-zinc-200 text-black border border-zinc-500 shadow-sm"
                          : "bg-zinc-100 text-zinc-500 border border-zinc-300 cursor-not-allowed"
                      }`}
                    >
                      Generate Video (Coming Soon)
                    </button>
                    <button
                      onClick={() => setGenerationTarget("images")}
                      className={`rounded-2xl px-5 py-4 text-sm font-bold uppercase tracking-[0.12em] transition-all ${
                        generationTarget === "images"
                          ? "bg-zinc-200 text-black border border-zinc-500 shadow-sm"
                          : "bg-zinc-100 text-black border border-zinc-300 hover:bg-zinc-200"
                      }`}
                    >
                      Generate Product Images
                    </button>
                  </div>
                  {generationTarget === "images" && (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <button
                        onClick={() => setStyle("ATHLETIC")}
                        className={`rounded-xl px-4 py-3 text-xs font-bold uppercase tracking-[0.12em] transition-all ${
                          style === "ATHLETIC"
                            ? "bg-zinc-200 text-black border border-zinc-500 shadow-sm"
                            : "bg-zinc-100 text-black border border-zinc-300 hover:bg-zinc-200"
                        }`}
                      >
                        Athletic
                      </button>
                      <button
                        onClick={() => setStyle("LUXURY")}
                        className={`rounded-xl px-4 py-3 text-xs font-bold uppercase tracking-[0.12em] transition-all ${
                          style === "LUXURY"
                            ? "bg-zinc-200 text-black border border-zinc-500 shadow-sm"
                            : "bg-zinc-100 text-black border border-zinc-300 hover:bg-zinc-200"
                        }`}
                      >
                        Luxury
                      </button>
                    </div>
                  )}
                </div>
              )}

              <button
                disabled={!state.sourceImage || state.isProcessing || generationTarget === "video"}
                onClick={startCampaignGeneration}
                className="w-full py-9 rounded-[2.5rem] bg-white text-black hover:bg-zinc-200 disabled:opacity-50 transition-all flex items-center justify-center gap-5 font-black text-2xl uppercase tracking-[0.2em] shadow-2xl shadow-black/40"
              >
                {state.isProcessing ? (
                  <RefreshCw className="animate-spin" />
                ) : generationTarget === "video" ? (
                  <>
                    {"Generate"} <ArrowRight size={28} />
                  </>
                ) : (
                  <>
                    {"Create Product Images"} <ArrowRight size={28} />
                  </>
                )}
              </button>
            </div>
          </section>
        </div>
      </main>

      {state.isProcessing && (
        <div
          className="fixed inset-y-0 right-0 z-[100] flex items-center justify-center bg-black/35 backdrop-blur-sm px-6"
          style={{ left: "var(--sidebar-width, 252px)" }}
        >
          <div className="w-full max-w-xl rounded-[2.5rem] border border-white/15 bg-black/95 p-12 shadow-2xl text-center">
            <div className="relative w-28 h-28 mb-10 mx-auto flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border border-white/10" />
              <div className="absolute inset-0 rounded-full border-t-2 border-white animate-[spin_1.2s_cubic-bezier(0.7,0,0.3,1)_infinite]" />
              <Loader2 className="text-white animate-spin" size={34} />
            </div>
            <h3 className="text-3xl font-black uppercase tracking-[0.2em] italic leading-none">{"Please Wait"}</h3>
            <div className="mt-6">
              <div className="h-2.5 w-full rounded-full bg-white/15 overflow-hidden">
                <div
                  className="h-full bg-white transition-all duration-300"
                  style={{ width: `${Math.max(3, progressPercent)}%` }}
                />
              </div>
              <p className="mt-3 text-xs uppercase tracking-[0.18em] text-white/70">{progressPercent}%</p>
            </div>
            <button
              onClick={cancelProcessing}
              className="mt-8 px-8 py-3 rounded-xl border border-white/40 bg-black text-white text-sm font-bold uppercase tracking-[0.12em] hover:bg-zinc-900 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showSubmitSuccess && (
        <div
          className="fixed inset-y-0 right-0 z-[110] flex items-center justify-center bg-black/30 backdrop-blur-[2px] px-6"
          style={{ left: "var(--sidebar-width, 252px)" }}
        >
          <div className="w-full max-w-lg rounded-[2.5rem] border border-white/15 bg-black p-12 shadow-2xl text-center">
            <div className="relative w-24 h-24 mx-auto mb-8 rounded-full border border-white/25 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border border-white/20 animate-ping" />
              <Check size={42} className="text-white" />
            </div>
            <p className="text-3xl font-black uppercase tracking-[0.18em] italic">
              {submittedImageResults.length > 0 ? "Task Completed" : "Task Submitted"}
            </p>
            <p className="mt-5 text-sm text-white/75 tracking-[0.08em]">
              {successMessage}
            </p>
            {submittedImageResults.length > 0 && (
              <div className="mt-6 grid grid-cols-2 gap-3 max-h-72 overflow-auto">
                {submittedImageResults.map((item) => (
                  <div key={item.taskId} className="rounded-xl border border-white/20 bg-white/5 p-2">
                    <img
                      src={item.thumbnailUrl || item.imageUrl}
                      alt={item.taskId}
                      className="w-full aspect-[3/4] object-cover rounded-lg border border-white/10"
                    />
                  </div>
                ))}
              </div>
            )}
            {submittedImageResults.length > 0 && (
              <button
                onClick={downloadAllGeneratedImages}
                className="mt-6 px-8 py-3 rounded-xl border border-white/40 bg-white text-black text-sm font-bold uppercase tracking-[0.12em] hover:bg-zinc-200 transition-colors"
              >
                Download All Results
              </button>
            )}
            <button
              onClick={() => setShowSubmitSuccess(false)}
              className="mt-8 px-8 py-3 rounded-xl bg-white text-black text-sm font-bold uppercase tracking-[0.12em] hover:bg-zinc-200 transition-colors"
            >
              Confirm
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

