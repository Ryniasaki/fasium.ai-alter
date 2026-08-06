"use client"

import type { CSSProperties } from "react"

interface WatermarkOverlayProps {
  /** 水印文字，默认"AI生成" */
  text?: string
  /** 位置，默认右下角 */
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left"
  /** 额外样式 */
  className?: string
  style?: CSSProperties
}

const positionStyles: Record<string, CSSProperties> = {
  "bottom-right": { bottom: 8, right: 8 },
  "bottom-left": { bottom: 8, left: 8 },
  "top-right": { top: 8, right: 8 },
  "top-left": { top: 8, left: 8 },
}

export function WatermarkOverlay({
  text = "AI生成",
  position = "bottom-right",
  className = "",
  style,
}: WatermarkOverlayProps) {
  const pos = positionStyles[position]

  return (
    <div
      className={`pointer-events-none select-none z-10 ${className}`}
      style={{
        position: "absolute",
        ...pos,
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 8px",
        borderRadius: 6,
        background: "rgba(0, 0, 0, 0.45)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        fontSize: 11,
        fontWeight: 600,
        color: "rgba(255, 255, 255, 0.85)",
        letterSpacing: "0.02em",
        lineHeight: 1.4,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0, opacity: 0.8 }}
      >
        <path d="M12 2a4 4 0 0 1 4 4v2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h2V6a4 4 0 0 1 4-4z" />
        <circle cx="12" cy="14" r="3" />
        <line x1="12" y1="14" x2="12" y2="17" />
      </svg>
      {text}
    </div>
  )
}

/**
 * 图片 + 水印包装器。
 * 用于包裹任意图片展示区域，在底部右下角叠加"AI生成"标识。
 */
interface WatermarkedImageWrapperProps {
  children: React.ReactNode
  text?: string
  className?: string
  style?: CSSProperties
}

export function WatermarkedImageWrapper({
  children,
  text = "AI生成",
  className = "",
  style,
}: WatermarkedImageWrapperProps) {
  return (
    <div
      className={`relative inline-block overflow-hidden ${className}`}
      style={style}
    >
      {children}
      <WatermarkOverlay text={text} />
    </div>
  )
}
