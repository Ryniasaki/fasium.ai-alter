import { createHmac, randomBytes } from "crypto"

const CAPTCHA_SECRET =
  process.env.CAPTCHA_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  "dev-captcha-secret-change-me"
const CAPTCHA_TTL_MS = 5 * 60 * 1000
const CAPTCHA_LENGTH = 4
const CAPTCHA_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

type CaptchaPayload = {
  code: string
  exp: number
  nonce: string
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url")
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8")
}

function signPayload(encodedPayload: string): string {
  return createHmac("sha256", CAPTCHA_SECRET).update(encodedPayload).digest("base64url")
}

function escapeSvgText(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;"
      case "<":
        return "&lt;"
      case ">":
        return "&gt;"
      case '"':
        return "&quot;"
      case "'":
        return "&#39;"
      default:
        return char
    }
  })
}

function createCaptchaCode(): string {
  let result = ""
  for (let index = 0; index < CAPTCHA_LENGTH; index += 1) {
    const randomIndex = randomBytes(1)[0] % CAPTCHA_ALPHABET.length
    result += CAPTCHA_ALPHABET[randomIndex]
  }
  return result
}

function createCaptchaSvg(code: string): string {
  const noise = Array.from({ length: 6 }, (_, index) => {
    const x1 = 12 + index * 28
    const x2 = x1 + 18
    const y1 = 14 + (index % 3) * 10
    const y2 = 44 - (index % 2) * 8
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(148,163,184,0.55)" stroke-width="1.5" />`
  }).join("")

  const chars = code
    .split("")
    .map((char, index) => {
      const rotate = index % 2 === 0 ? -8 : 7
      const x = 24 + index * 28
      const y = index % 2 === 0 ? 32 : 36
      return `<text x="${x}" y="${y}" transform="rotate(${rotate} ${x} ${y})" font-family="monospace" font-size="24" font-weight="700" fill="#0f172a">${escapeSvgText(char)}</text>`
    })
    .join("")

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="160" height="56" viewBox="0 0 160 56" role="img" aria-label="captcha">
      <rect width="160" height="56" rx="12" fill="#f8fafc" />
      <rect x="1" y="1" width="158" height="54" rx="11" fill="none" stroke="#cbd5e1" />
      ${noise}
      ${chars}
    </svg>
  `.trim()
}

export function issueCaptchaChallenge(): { token: string; svg: string; expiresInMs: number } {
  const payload: CaptchaPayload = {
    code: createCaptchaCode(),
    exp: Date.now() + CAPTCHA_TTL_MS,
    nonce: randomBytes(8).toString("hex"),
  }

  const encodedPayload = toBase64Url(JSON.stringify(payload))
  const signature = signPayload(encodedPayload)

  return {
    token: `${encodedPayload}.${signature}`,
    svg: createCaptchaSvg(payload.code),
    expiresInMs: CAPTCHA_TTL_MS,
  }
}

export function verifyCaptchaChallenge(token: string, input: string): boolean {
  if (!token || !input) {
    return false
  }

  const [encodedPayload, signature] = token.split(".")
  if (!encodedPayload || !signature) {
    return false
  }

  const expectedSignature = signPayload(encodedPayload)
  if (signature !== expectedSignature) {
    return false
  }

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload)) as CaptchaPayload
    if (!payload?.code || typeof payload.exp !== "number") {
      return false
    }
    if (Date.now() > payload.exp) {
      return false
    }
    return payload.code.toUpperCase() === input.trim().toUpperCase()
  } catch {
    return false
  }
}
