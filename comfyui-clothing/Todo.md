# Fasium Sheet Migration TODO

[x] **Bring over UI + state containers**
   - Synced `app/sheet/page.tsx` with Fasium-bandan’s App logic (state machine + handlers) while adapting imports to `@/`.
   - Confirmed all Fasium sheet components and shared types live under `components/sheet/*` and `@/lib/sheet`.

[x] **Replace Gemini visual generation with existing text-to-cloth workflow**
   - `generateVisualConcepts` now submits prompts to the RunningHub text-to-image workflow, polls task status, downloads the resulting image, and converts it to base64 (`comfyui-clothing/lib/sheet/gemini-service.ts`).
   - Preserved the “reference image→single render / text-only→four options” control flow at the page level; only the visual generation backend changed.

[x] **Rebuild multistep GPT-4o services**
   - Added Next.js proxy routes under `/api/proxy/llm/sheet/*` that forward authenticated JSON payloads to the tenant service (`technical_sketches`, `lining_sketch`, `tech_pack`, `cost_estimation`).
   - Updated `lib/sheet/gemini-service.ts` so all non-visual generators call those endpoints (with auth headers + fallbacks), ready for GPT-4o responses once the tenant API is wired up.

[x] **Tenant-service support**
   - Added `/proxy/llm/sheet/*` FastAPI endpoints (technical_sketches, lining_sketch, tech_pack, cost_estimation) that resolve tenant LLM config, forward prompts/images to GPT‑4o, and emit structured JSON/base64 responses.
   - Next.js proxies now forward `/api/proxy/llm/sheet/*` requests, so the sheet UI can call them without exposing tenant credentials.

5. **Shared types & utilities**
   - Move `types.ts`, helpers (annotation layout, etc.) into `@/lib/sheet`.
   - Ensure cost/tech pack data structures stay aligned with UI expectations.

6. **Testing & docs**
   - Smoke-test `/sheet` flow end-to-end (text-only brief + with reference image).
   - Update README/ARCHITECTURE note describing new GPT-4o + RunningHub integration path.
