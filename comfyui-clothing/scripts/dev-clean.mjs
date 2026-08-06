import { spawn } from "child_process"
import "./clean-next.mjs"

const projectRoot = process.cwd()

const child = spawn("next", ["dev"], {
  cwd: projectRoot,
  stdio: "inherit",
  shell: true,
})

child.on("exit", (code) => {
  process.exit(code ?? 0)
})
