import fs from "fs"
import path from "path"

const nextDir = path.join(process.cwd(), ".next")

fs.rmSync(nextDir, { recursive: true, force: true })
