"use client"

import { useRef } from "react"
import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from "framer-motion"

type DynamicCardProps = {
  children: React.ReactNode
  className?: string
  title?: string
  delay?: number
  mouseX: MotionValue<number>
  mouseY: MotionValue<number>
}

export function DynamicCard({ children, className = "", title, delay = 0, mouseX, mouseY }: DynamicCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)

  const springConfig = { damping: 30, stiffness: 200, mass: 0.5 }

  const rotateX = useSpring(
    useTransform(mouseY, (y: number) => {
      if (!cardRef.current) return 0
      const rect = cardRef.current.getBoundingClientRect()
      const centerY = rect.top + rect.height / 2
      const distance = (y - centerY) * 0.015
      return Math.max(Math.min(distance * -1, 5), -5)
    }),
    springConfig,
  )

  const rotateY = useSpring(
    useTransform(mouseX, (x: number) => {
      if (!cardRef.current) return 0
      const rect = cardRef.current.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const distance = (x - centerX) * 0.015
      return Math.max(Math.min(distance, 5), -5)
    }),
    springConfig,
  )

  const translateY = useSpring(
    useTransform([mouseX, mouseY], ([x, y]: [number, number]) => {
      if (!cardRef.current) return 0
      const rect = cardRef.current.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      const dist = Math.hypot(x - centerX, y - centerY)
      return dist < 300 ? (300 - dist) * 0.02 : 0
    }),
    springConfig,
  )

  const glow = useTransform([mouseX, mouseY], ([x, y]: [number, number]) => {
    if (!cardRef.current) return "none"
    const rect = cardRef.current.getBoundingClientRect()
    const lx = x - rect.left
    const ly = y - rect.top
    return `radial-gradient(circle at ${lx}px ${ly}px, rgba(59, 130, 246, 0.08) 0%, transparent 70%)`
  })

  return (
    <motion.div
      ref={cardRef}
      style={{ rotateX, rotateY, y: translateY, perspective: 1000 }}
      initial={{ opacity: 0, scale: 0.96, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      className={`relative overflow-hidden rounded-3xl border border-white/60 bg-white/80 p-5 shadow-[0_18px_50px_rgba(12,24,52,0.12)] backdrop-blur-2xl ${className}`}
    >
      <motion.div style={{ background: glow }} className="absolute inset-0 pointer-events-none" />
      {title && <h3 className="text-slate-800 font-semibold text-base mb-3 tracking-tight relative z-10">{title}</h3>}
      <div className="relative z-10 h-full">{children}</div>
    </motion.div>
  )
}
