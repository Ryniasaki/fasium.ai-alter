"use client"

import { useEffect, useRef } from "react"



export function FluidBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let animationFrameId = 0
    let particles: Particle[] = []
    const mouse = { x: -1000, y: -1000, radius: 160 }

    class Particle {
      x: number
      y: number
      baseX: number
      baseY: number
      density: number

      constructor(x: number, y: number) {
        this.x = x
        this.y = y
        this.baseX = x
        this.baseY = y
        this.density = Math.random() * 20 + 5
      }

      draw() {
        if (!ctx) return
        ctx.fillStyle = "rgba(59, 130, 246, 0.08)"
        ctx.beginPath()
        ctx.arc(this.x, this.y, 1, 0, Math.PI * 2)
        ctx.fill()
      }

      update() {
        const dx = mouse.x - this.x
        const dy = mouse.y - this.y
        const distance = Math.hypot(dx, dy)

        if (distance < mouse.radius) {
          const force = (mouse.radius - distance) / mouse.radius
          const directionX = (dx / distance) * force * this.density
          const directionY = (dy / distance) * force * this.density
          this.x -= directionX
          this.y -= directionY
        } else {
          if (this.x !== this.baseX) {
            const dxBack = this.x - this.baseX
            this.x -= dxBack / 15
          }
          if (this.y !== this.baseY) {
            const dyBack = this.y - this.baseY
            this.y -= dyBack / 15
          }
        }
      }
    }

    const init = () => {
      particles = []
      const spacing = 40
      for (let y = 0; y < canvas.height; y += spacing) {
        for (let x = 0; x < canvas.width; x += spacing) {
          particles.push(new Particle(x, y))
        }
      }
    }

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      particles.forEach((p) => {
        p.update()
        p.draw()
      })
      animationFrameId = window.requestAnimationFrame(animate)
    }

    const handleResize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      init()
    }

    const handleMouseMove = (event: MouseEvent) => {
      mouse.x = event.clientX
      mouse.y = event.clientY
    }

    window.addEventListener("resize", handleResize)
    window.addEventListener("mousemove", handleMouseMove)
    handleResize()
    animate()

    return () => {
      window.removeEventListener("resize", handleResize)
      window.removeEventListener("mousemove", handleMouseMove)
      window.cancelAnimationFrame(animationFrameId)
    }
  }, [])

  return <canvas ref={canvasRef} className="fixed inset-0 -z-10 pointer-events-none" />
}
