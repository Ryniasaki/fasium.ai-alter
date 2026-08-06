"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { CREDIT_GUARD_EVENT, type CreditGuardDetail } from "@/lib/credit-guard"

export function CreditWarningModal() {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<CreditGuardDetail | null>(null)

  useEffect(() => {
    const handler = (event: Event) => {
      const payload = (event as CustomEvent<CreditGuardDetail>).detail || {}
      setDetail(payload)
      setOpen(true)
    }
    window.addEventListener(CREDIT_GUARD_EVENT, handler)
    return () => window.removeEventListener(CREDIT_GUARD_EVENT, handler)
  }, [])

  const description = detail?.detail || "当前点数不足，无法继续调用服务。"

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg animate-in fade-in-0 duration-200">
        <DialogHeader>
          <DialogTitle>点数不足</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            请通过图中二维码或 <span className="font-medium text-foreground">jotoai@jototech.cn</span> 联系我们，获取更多点数。
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex flex-col items-center gap-4">
          <div className="relative aspect-square w-full max-w-[280px] overflow-hidden rounded-2xl border bg-white p-3 shadow-sm">
            <Image
              src="/support-contact-qr.webp"
              alt="联系我们获取更多点数的二维码"
              fill
              className="object-contain"
              priority
              sizes="280px"
            />
          </div>
          <p className="text-center text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
          <p className="text-center text-xs text-muted-foreground">
            邮箱联系：jotoai@jototech.cn
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
