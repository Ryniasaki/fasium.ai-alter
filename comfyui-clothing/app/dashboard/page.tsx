"use client"

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "framer-motion"
import {
  CheckCircle2,
  Copy,
  CreditCard,
  Plus,
  UserCheck,
  UserMinus,
  Users,
} from "lucide-react"

import { useAuth } from "@/contexts/auth-context"
import { apiClient, type EmployeeAccount } from "@/lib/api-client"

const CREDENTIALS_STORAGE_KEY = "manager_employee_credentials_v1"

type Toast = {
  type: "success" | "error"
  message: string
}

export default function DashboardPage() {
  const { isAuthenticated, user } = useAuth()
  const router = useRouter()

  const isManager = user?.role === "manager" && user?.group !== 1000
  const [employees, setEmployees] = useState<EmployeeAccount[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [createdEmployee, setCreatedEmployee] = useState<{ username: string; password: string } | null>(null)
  const [employeeCredentials, setEmployeeCredentials] = useState<Record<string, string>>({})
  const [consumedByUsername, setConsumedByUsername] = useState<Record<string, number>>({})
  const [totalConsumed, setTotalConsumed] = useState(0)

  const [employeeId, setEmployeeId] = useState("")
  const [employeeEnabled, setEmployeeEnabled] = useState(true)

  const showToast = useCallback((type: Toast["type"], message: string) => {
    setToast({ type, message })
  }, [])

  const generateRandomPassword = useCallback(() => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*"
    let value = ""
    for (let index = 0; index < 12; index += 1) {
      value += chars[Math.floor(Math.random() * chars.length)]
    }
    return value
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!isAuthenticated) {
      router.push("/")
      return
    }
    if (user && !isManager) {
      router.push("/board")
    }
  }, [isAuthenticated, isManager, router, user])

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const raw = window.localStorage.getItem(CREDENTIALS_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as Record<string, string>
      if (parsed && typeof parsed === "object") {
        setEmployeeCredentials(parsed)
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem(CREDENTIALS_STORAGE_KEY, JSON.stringify(employeeCredentials))
    } catch {
      // ignore
    }
  }, [employeeCredentials])

  const loadEmployees = useCallback(async () => {
    if (!isManager) return
    setIsLoading(true)
    try {
      const [employeeData, consumptionData] = await Promise.all([
        apiClient.listEmployees(),
        apiClient.getEmployeeConsumption(),
      ])
      setEmployees(Array.isArray(employeeData?.employees) ? employeeData.employees : [])
      const items = Array.isArray(consumptionData?.items) ? consumptionData.items : []
      const nextConsumed: Record<string, number> = {}
      items.forEach((item) => {
        if (item?.username) {
          nextConsumed[item.username] = Number(item.consumed_credit || 0)
        }
      })
      setConsumedByUsername(nextConsumed)
      setTotalConsumed(Number(consumptionData?.total_consumed || 0))
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to load employees")
    } finally {
      setIsLoading(false)
    }
  }, [isManager, showToast])

  useEffect(() => {
    void loadEmployees()
  }, [loadEmployees])

  const activeCount = useMemo(() => employees.filter((item) => item.is_active).length, [employees])
  const maxActive = user?.max_active_employees ?? 5
  const managerEmail = (user?.username || "").trim()
  const managerDomain = useMemo(() => {
    const atIndex = managerEmail.indexOf("@")
    if (atIndex < 0) return ""
    return managerEmail.slice(atIndex + 1)
  }, [managerEmail])
  const finalUsername = useMemo(() => {
    const id = employeeId.trim()
    if (!id || !managerDomain) return "-"
    return `${id}@${managerDomain}`
  }, [employeeId, managerDomain])

  const validateEmployeeId = useCallback((id: string) => {
    if (!id) return "Employee id is required"
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id) || id.includes("@")) {
      return "Employee id must not be an email"
    }
    return null
  }, [])

  const handleCreateEmployee = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault()
      if (!isManager) return

      const id = employeeId.trim()
      const idError = validateEmployeeId(id)
      if (idError) {
        showToast("error", idError)
        return
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(managerEmail)) {
        showToast("error", "Manager username must be an email")
        return
      }

      const password = generateRandomPassword()
      setIsCreating(true)
      setCreatedEmployee(null)
      try {
        const created = await apiClient.createEmployee({
          username: id,
          password,
          is_active: employeeEnabled,
        })
        setEmployeeId("")
        setEmployeeEnabled(true)
        setCreatedEmployee({ username: created.username, password })
        setEmployeeCredentials((prev) => ({ ...prev, [created.username]: password }))
        showToast("success", `Password reset and copied for ${created.username}`)
        await navigator.clipboard.writeText(`Account: ${created.username}\nPassword: ${password}`)
        await loadEmployees()
      } catch (err) {
        showToast("error", err instanceof Error ? err.message : "Failed to create employee")
      } finally {
        setIsCreating(false)
      }
    },
    [
      employeeEnabled,
      employeeId,
      generateRandomPassword,
      isManager,
      loadEmployees,
      managerEmail,
      showToast,
      validateEmployeeId,
    ],
  )

  const handleToggleEmployee = useCallback(
    async (employee: EmployeeAccount) => {
      if (!isManager) return
      try {
        await apiClient.updateEmployeeStatus(employee.username, !employee.is_active)
        showToast("success", `${employee.username} ${employee.is_active ? "disabled" : "enabled"}`)
        await loadEmployees()
      } catch (err) {
        showToast("error", err instanceof Error ? err.message : "Failed to update employee")
      }
    },
    [isManager, loadEmployees, showToast],
  )

  const copyCredentialsForEmployee = useCallback(
    async (employee: EmployeeAccount) => {
      const knownPassword = employeeCredentials[employee.username]
      if (knownPassword) {
        try {
          await navigator.clipboard.writeText(`Account: ${employee.username}\nPassword: ${knownPassword}`)
          showToast("success", `Credentials copied for ${employee.username}`)
        } catch {
          showToast("error", "Failed to copy credentials")
        }
        return
      }

      const newPassword = generateRandomPassword()
      try {
        await apiClient.resetEmployeePassword(employee.username, newPassword)
        setEmployeeCredentials((prev) => ({ ...prev, [employee.username]: newPassword }))
        await navigator.clipboard.writeText(`Account: ${employee.username}\nPassword: ${newPassword}`)
        showToast("success", `Password reset and copied for ${employee.username}`)
      } catch (err) {
        showToast("error", err instanceof Error ? err.message : "Failed to reset/copy credentials")
      }
    },
    [employeeCredentials, generateRandomPassword, showToast],
  )

  const handleCopyCreated = useCallback(async () => {
    if (!createdEmployee) return
    try {
      await navigator.clipboard.writeText(
        `Account: ${createdEmployee.username}\nPassword: ${createdEmployee.password}`,
      )
      showToast("success", "Credentials copied")
    } catch {
      showToast("error", "Failed to copy credentials")
    }
  }, [createdEmployee, showToast])

  if (!isAuthenticated || !isManager) return null

  return (
    <div className="min-h-screen bg-[#f9fafb] text-[#111827]">
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed left-1/2 top-6 z-50 -translate-x-1/2 rounded-full border border-gray-200 bg-white px-6 py-3 shadow-xl"
          >
            <div className="flex items-center gap-3">
              <CheckCircle2 className={`size-5 ${toast.type === "success" ? "text-emerald-500" : "text-rose-500"}`} />
              <span className="text-sm font-medium text-gray-700">{toast.message}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mx-auto max-w-5xl px-6 py-12">
        <header className="mb-10">
          <h1 className="text-3xl font-semibold tracking-tight">Manager Dashboard</h1>
          <p className="mt-2 text-lg text-gray-500">Manage employee accounts under your manager account.</p>
        </header>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="space-y-6">
            <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
              <div className="mb-6 flex items-center gap-4">
                <div className="flex size-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
                  <Users className="size-6" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Manager</p>
                  <p className="font-medium text-gray-900">{managerEmail || "-"}</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-gray-50 py-3">
                  <span className="text-sm text-gray-500">Active Employees</span>
                  <span className="text-sm font-semibold">
                    {activeCount} / {maxActive}
                  </span>
                </div>
                <div className="flex items-center justify-between py-3">
                  <span className="text-sm text-gray-500">Shared Credit</span>
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <CreditCard className="size-4 text-gray-400" />
                    {user?.credit ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between py-3">
                  <span className="text-sm text-gray-500">Employee Consumed</span>
                  <span className="text-sm font-semibold">{totalConsumed}</span>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
              <h2 className="mb-6 text-lg font-semibold">Create Employee</h2>
              <form onSubmit={handleCreateEmployee} className="space-y-5">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Employee ID (not email)
                  </label>
                  <input
                    type="text"
                    value={employeeId}
                    onChange={(event) => setEmployeeId(event.target.value)}
                    placeholder="e.g. eason"
                    className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm transition-all focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Enable now</span>
                  <button
                    type="button"
                    onClick={() => setEmployeeEnabled((prev) => !prev)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${employeeEnabled ? "bg-indigo-600" : "bg-gray-200"}`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${employeeEnabled ? "translate-x-6" : "translate-x-1"}`}
                    />
                  </button>
                </div>

                <div className="rounded-xl bg-gray-50 p-4">
                  <p className="mb-1 text-xs uppercase tracking-wider text-gray-400">Final username</p>
                  <p className="font-mono text-sm font-medium text-gray-700">{finalUsername}</p>
                </div>

                <button
                  type="submit"
                  disabled={!employeeId.trim() || isCreating}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 py-3 font-medium text-white transition-all hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="size-4" />
                  {isCreating ? "Creating..." : "Create Employee"}
                </button>
              </form>

              {createdEmployee && (
                <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
                  <p className="font-medium text-gray-800">Username: {createdEmployee.username}</p>
                  <p className="font-medium text-gray-800">Password: {createdEmployee.password}</p>
                  <button
                    type="button"
                    onClick={() => void handleCopyCreated()}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 transition hover:bg-white"
                  >
                    <Copy className="size-4" />
                    Copy Credentials
                  </button>
                </div>
              )}
            </section>
          </div>

          <div className="lg:col-span-2">
            <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-gray-50 px-6 py-5">
                <h2 className="text-lg font-semibold">Employee List</h2>
                <div className="text-xs font-medium text-gray-400">{employees.length} total</div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="bg-gray-50/50">
                      <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Username</th>
                      <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Email</th>
                      <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Consumed</th>
                      <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Status</th>
                      <th className="px-6 py-4 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {isLoading && (
                      <tr>
                        <td className="px-6 py-6 text-gray-400" colSpan={5}>
                          Loading...
                        </td>
                      </tr>
                    )}

                    {!isLoading && employees.length === 0 && (
                      <tr>
                        <td className="px-6 py-16 text-center text-gray-400" colSpan={5}>
                          <Users className="mx-auto mb-3 size-10 opacity-30" />
                          No employees found
                        </td>
                      </tr>
                    )}

                    {!isLoading &&
                      employees.map((employee) => (
                        <motion.tr layout key={employee.username} className="group transition-colors hover:bg-gray-50/50">
                          <td className="px-6 py-4 font-medium text-gray-900">{employee.username}</td>
                          <td className="px-6 py-4 text-gray-400">{employee.email || "-"}</td>
                          <td className="px-6 py-4 text-gray-700">{consumedByUsername[employee.username] ?? 0}</td>
                          <td className="px-6 py-4">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                employee.is_active ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"
                              }`}
                            >
                              {employee.is_active ? "enabled" : "disabled"}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => void handleToggleEmployee(employee)}
                                className={`rounded-lg p-2 transition-colors ${
                                  employee.is_active
                                    ? "text-gray-400 hover:bg-rose-50 hover:text-rose-600"
                                    : "text-gray-400 hover:bg-emerald-50 hover:text-emerald-600"
                                }`}
                                title={employee.is_active ? "Disable" : "Enable"}
                              >
                                {employee.is_active ? <UserMinus className="size-4" /> : <UserCheck className="size-4" />}
                              </button>
                              <button
                                type="button"
                                onClick={() => void copyCredentialsForEmployee(employee)}
                                className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                                title="Copy Credentials"
                              >
                                <Copy className="size-4" />
                              </button>
                            </div>
                          </td>
                        </motion.tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
