"use client"

import { usePathname } from "next/navigation"
import { CreditGuardProvider } from "@/components/credit-guard-provider"
import { CreditWarningModal } from "@/components/credit-warning-modal"

interface MainWrapperProps {
  children: React.ReactNode
}

export function MainWrapper({ children }: MainWrapperProps) {
  const pathname = usePathname() ?? ""
  const isAuthPage = pathname === "/" || pathname === "" || pathname.startsWith("/register")

  return (
    <>
      <CreditGuardProvider />
      <CreditWarningModal />
      <main
        className={isAuthPage ? "transition-all duration-300" : "transition-all duration-300 lg:ml-[var(--app-nav-offset,80px)]"}
      >
        {children}
      </main>
    </>
  )
}
