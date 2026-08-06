"use client"

import { DragEvent, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import { ImageIcon, Loader2, Search, Send } from "lucide-react"

import { useAuth } from "@/contexts/auth-context"

type ToolPlanItem = {
  tool?: string
  href?: string
  reason?: string
  steps?: string[]
}

type AgentResponse = {
  summary?: string
  plan?: ToolPlanItem[]
  missingInfo?: string[]
  raw_response?: unknown
}

export default function ChatbotPage() {
  const { isAuthenticated, user, token } = useAuth()
  const router = useRouter()
  const [inputValue, setInputValue] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [inputHeight, setInputHeight] = useState(52)
  const [isLoading, setIsLoading] = useState(false)
  const [agentResult, setAgentResult] = useState<AgentResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [prefilledFromCookie, setPrefilledFromCookie] = useState(false)
  const hasAutoSentRef = useRef(false)

  useEffect(() => {
    if (!isAuthenticated) {
      router.push("/")
    }
  }, [isAuthenticated, router])

  useEffect(() => {
    const match = document.cookie.split(";").find((entry) => entry.trim().startsWith("chatbot_prefill="))
    if (match) {
      const value = decodeURIComponent(match.split("=")[1] ?? "")
      if (value) {
        setInputValue(value)
        setPrefilledFromCookie(true)
      }
      // clear after use
      document.cookie = "chatbot_prefill=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT"
    }

    const storedImage = sessionStorage.getItem("chatbot_prefill_image")
    if (storedImage) {
      setImagePreview(storedImage)
      sessionStorage.removeItem("chatbot_prefill_image")
    }
  }, [])

  useEffect(() => {
    if (!textareaRef.current) return
    const textarea = textareaRef.current
    textarea.style.height = "auto"
    const clamped = Math.min(Math.max(textarea.scrollHeight, 52), 200)
    textarea.style.height = `${clamped}px`
    setInputHeight(clamped)
  }, [inputValue])

  useEffect(() => {
    if (!prefilledFromCookie || hasAutoSentRef.current) return
    const trimmed = inputValue.trim()
    if (!trimmed) return
    hasAutoSentRef.current = true
    void handleSend()
  }, [inputValue, prefilledFromCookie])

  const placeholder = useMemo(
    () =>
      "例如：为针织线条做灵感探索、帮我写面料打样请求、为这组 Look 制作走秀文案、推荐适合提花的工艺路径…",
    [],
  )

  const handleSend = async () => {
    const content = inputValue.trim()
    if ((!content && !imagePreview) || !token) {
      setError("请先登录后提问")
      return
    }

    setError(null)
    setIsLoading(true)

    try {
      const response = await fetch("/api/proxy/agent/tools", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ question: content, imageDataUrl: imagePreview }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.detail || "Agent 请求失败")
      }

      setAgentResult({
        summary: data?.summary,
        plan: Array.isArray(data?.plan) ? data.plan : [],
        missingInfo: Array.isArray(data?.missingInfo) ? data.missingInfo : [],
        raw_response: data?.raw_response,
      })
    } catch (err) {
      console.error("Agent request failed:", err)
      setError(err instanceof Error ? err.message : "Agent 请求失败")
    } finally {
      setIsLoading(false)
    }
  }

  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === "string") {
        setImagePreview(result)
      }
    }
    reader.readAsDataURL(file)
  }

  const clearImage = () => {
    setImagePreview(null)
    if (imageInputRef.current) imageInputRef.current.value = ""
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (!file || !file.type.startsWith("image/")) return
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === "string") {
        setImagePreview(result)
      }
    }
    reader.readAsDataURL(file)
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-10">
        <motion.div
          className="w-full"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <div
            className={`flex w-full items-center gap-3 border bg-white/10 px-5 py-4 backdrop-blur-lg transition ${
              inputHeight > 64 ? "rounded-2xl" : "rounded-full"
            } ${isDragging ? "border-blue-300/70 bg-white/15" : "border-white/30 hover:border-white/60"}`}
            onDragOver={(event) => {
              event.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <Search className="h-5 w-5 text-white/80" />
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              placeholder={placeholder}
              className={`w-full min-h-[52px] max-h-[200px] resize-none overflow-hidden bg-transparent text-lg text-white placeholder:text-white/60 transition-[height] duration-200 ease-out focus:outline-none ${
                inputHeight <= 64 ? "leading-[52px] py-0" : "leading-relaxed py-1"
              }`}
              rows={1}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  void handleSend()
                }
              }}
            />
            <div className="flex items-center gap-2">
              {imagePreview ? (
                <div className="flex items-center gap-2 rounded-full border border-white/30 px-2 py-1">
                  <img src={imagePreview} alt="preview" className="h-8 w-8 rounded-full object-cover" />
                  <button
                    type="button"
                    onClick={clearImage}
                    className="text-xs text-white/70 hover:text-white"
                    aria-label="移除图片"
                  >
                    移除
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/30 text-white transition hover:bg-white hover:text-black"
                aria-label="上传图片"
              >
                <ImageIcon className="h-5 w-5" />
              </button>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageSelect}
              />
            </div>
            <button
              type="button"
              onClick={() => void handleSend()}
              className="flex items-center justify-center rounded-full bg-white p-2 text-black transition hover:bg-neutral-200"
              aria-label="发送"
            >
              {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
              <span className="sr-only">发送</span>
            </button>
          </div>
        </motion.div>

        <div className="flex flex-1 pb-12">
          <div className="flex w-full flex-col gap-4 rounded-3xl border border-white/15 bg-white/5 px-6 py-6 text-neutral-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.2em] text-white/50">Tool Agent</p>
                <p className="text-lg font-semibold text-white">推荐顺序</p>
              </div>
              {user?.username && <p className="text-sm text-white/60">当前用户：{user.username}</p>}
            </div>

            {error && (
              <div className="rounded-xl border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                {error}
              </div>
            )}

            {agentResult ? (
              <div className="flex flex-col gap-4">
                {agentResult.summary && (
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white">
                    <p className="text-sm text-white/60">方案概述</p>
                    <p className="mt-1 text-base font-medium leading-relaxed">{agentResult.summary}</p>
                  </div>
                )}

                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <div className="flex items-center justify-between pb-3">
                    <p className="text-sm text-white/60">调用顺序</p>
                    {isLoading && (
                      <div className="flex items-center gap-2 text-xs text-white/60">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        正在请求…
                      </div>
                    )}
                  </div>
                  {agentResult.plan && agentResult.plan.length > 0 ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      {agentResult.plan.map((item, idx) => (
                        <div
                          key={`${item.tool}-${idx}`}
                          className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white">
                                {idx + 1}
                              </span>
                              <p className="text-base font-semibold text-white">{item.tool || "未命名工具"}</p>
                            </div>
                            {item.href && (
                              <button
                                type="button"
                                onClick={() => {
                                  const target = item.href || "/tools"
                                  window.open(target, "_blank", "noopener,noreferrer")
                                }}
                                className="text-sm text-blue-200 underline-offset-4 hover:underline"
                              >
                                打开
                              </button>
                            )}
                          </div>
                          {item.reason && <p className="text-sm text-white/70">{item.reason}</p>}
                          {item.steps && item.steps.length > 0 && (
                            <ul className="list-disc space-y-1 pl-6 text-sm text-white/70">
                              {item.steps.map((step, stepIdx) => (
                                <li key={stepIdx}>{step}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-white/60">暂未获得可执行的工具方案。</p>
                  )}
                </div>

                {agentResult.missingInfo && agentResult.missingInfo.length > 0 && (
                  <div className="rounded-2xl border border-amber-300/30 bg-amber-400/10 px-4 py-3">
                    <p className="text-sm font-semibold text-amber-100">还需要补充</p>
                    <ul className="mt-1 list-disc space-y-1 pl-6 text-sm text-amber-50">
                      {agentResult.missingInfo.map((item, idx) => (
                        <li key={`${item}-${idx}`}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex w-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/5 px-6 py-12 text-center text-neutral-300">
                <p className="text-lg font-medium text-white/80">对话结果区域</p>
                <p className="mt-2 text-sm text-white/60">提交问题后，Agent 会根据 /tools 列表给出推荐。</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
