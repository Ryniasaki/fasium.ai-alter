import { locales } from "@/lib/i18n/locale-config"

export const LOCALE_PREFERENCE_KEY = "fasium_locale"
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

export const isLocale = (value: string | undefined | null): value is (typeof locales)[number] => {
  if (!value) return false
  return locales.includes(value as (typeof locales)[number])
}
