import fs from "fs"
import path from "path"
import ts from "typescript"

const projectRoot = process.cwd()
const sourceRoots = ["app", "components", "contexts", "lib"]
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"])
const suspiciousPatterns = [
  { label: "replacement-char", regex: /\uFFFD/ },
  { label: "mojibake-ellipsis", regex: /鈥\?/ },
  { label: "mojibake-zh-cn", regex: /涓枃|鐧诲綍|鍏抽棴|璇疯緭鍏|鎺у埗鍙|宸ヤ綔鍙|娆㈣繋/ },
]

function collectFiles(rootDir) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue
    }

    const fullPath = path.join(rootDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath))
      continue
    }

    if (extensions.has(path.extname(entry.name))) {
      files.push(fullPath)
    }
  }

  return files
}

function getScriptKind(filePath) {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX
  if (filePath.endsWith(".ts")) return ts.ScriptKind.TS
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX
  return ts.ScriptKind.JS
}

const issues = []

for (const relativeRoot of sourceRoots) {
  const absoluteRoot = path.join(projectRoot, relativeRoot)
  if (!fs.existsSync(absoluteRoot)) {
    continue
  }

  for (const filePath of collectFiles(absoluteRoot)) {
    const content = fs.readFileSync(filePath, "utf8")
    const relativePath = path.relative(projectRoot, filePath)

    for (const pattern of suspiciousPatterns) {
      if (pattern.regex.test(content)) {
        issues.push(`${relativePath}: suspicious content detected (${pattern.label})`)
      }
    }

    const sourceFile = ts.createSourceFile(
      relativePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      getScriptKind(filePath),
    )

    for (const diagnostic of sourceFile.parseDiagnostics) {
      const position = diagnostic.start != null
        ? sourceFile.getLineAndCharacterOfPosition(diagnostic.start)
        : null
      const lineInfo = position ? `:${position.line + 1}:${position.character + 1}` : ""
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
      issues.push(`${relativePath}${lineInfo}: syntax error: ${message}`)
    }
  }
}

if (issues.length > 0) {
  console.error("Source integrity check failed.\n")
  for (const issue of issues) {
    console.error(`- ${issue}`)
  }
  process.exit(1)
}

console.log("Source integrity check passed.")
