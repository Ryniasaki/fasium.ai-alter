# How `/extract_stripe` talks to GPT‑4o

This note reverse‑engineers the current LLM workflow so you can replicate or extend it.

## 1. Front‑end trigger
- `app/extract_stripe/page.tsx:289` & `533` call `extractApiClient.requestColorPalettes(file)` whenever the user uploads a stripe reference image. The UI hands the raw `File` object to the client and shows the returned stripe units/palette groups.

## 2. Next.js API proxy
- `lib/extract-api-client.ts:154-171` builds a `FormData` payload with two fields:
  1. `file`: the original image blob.
  2. `prompt`: a long Chinese instruction telling the LLM to output JSON containing palette groups + `stripePatternUnit`.
- The client POSTs this form to `/api/proxy/llm/palette_from_image` with the user’s bearer token.
- `app/api/proxy/llm/palette_from_image/route.ts:10-41` simply replays the multipart form to the tenant service (`TENANT_API_BASE/proxy/llm/palette_from_image`) and streams the JSON back to the browser. No additional processing happens in the Next.js layer, so any new use case should follow the same “frontend ➜ Next proxy ➜ tenant service” pattern.

## 3. Tenant service: image + prompt ➜ GPT‑4o
The heavy lifting happens inside `comfyui-tenant-service/app/routers/proxy.py` in the `palette_from_image` handler (~lines 430-640). Key points:

1. **Tenant‑aware config**
   - Reads `tenant.settings.llm` to resolve `llm_service_url`, `llm_api_key`, `vision_path`, and `default_model`. Fallbacks come from `.env` (`llm_service_url=https://api.openai.com/v1`, `llm_api_key=sk-…`, `llm_default_model=gpt-4o` etc.).

2. **Multipart ingestion + compression**
   - Pulls `file` and `prompt` from the incoming form. If the file is >1 MB and Pillow is available, it auto-compresses to <512 KB (JPEG + size downscaling). This keeps the final base64 payload within OpenAI limits.

3. **Convert to `image_url` content**
   - The (possibly compressed) bytes are converted into a `data:{mime};base64,…` URL. Instead of uploading the binary to OpenAI’s upload API, the code embeds the data URL directly into the chat payload.

4. **Chat payload sent to GPT‑4o**
   ```jsonc
   {
     "model": "gpt-4o",                // or per-tenant override
     "messages": [
       {"role": "system", "content": "你是服装配色顾问，只输出JSON，无多余文字。"},
       {"role": "user", "content": [
         {"type": "text", "text": "<custom prompt from FE>"},
         {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,..."}}
       ]}
     ],
     "response_format": {"type": "json_object"},
     "stream": false
   }
   ```
   - `llm_vision_path` defaults to `/chat/completions`, so the final request hits `${llm_service_url}/chat/completions`.
   - The handler logs a preview with image size instead of raw base64 to avoid bloating logs.

5. **Response parsing**
   - Attempts to parse the OpenAI‑style `{ choices[0].message.content }` JSON string. If that fails, falls back to `json.loads(resp.text)` and finally defaults to `{ groups: [] }`. The tenant service then returns the parsed JSON directly to the Next.js proxy.

## 4. Consuming the result
- The browser receives `PaletteResponse` (`groups`, `isStripePattern`, `stripePatternUnit`). `/extract_stripe` stores it in local state and allows users to keep or edit the AI‑suggested stripe unit.

## Reusing this pattern
To add more GPT‑4o calls that need both prompt + image:
1. **Frontend**: wrap your new use case in a helper similar to `requestColorPalettes` (build `FormData`, include `prompt`, call `/api/proxy/llm/...`).
2. **Next.js route**: proxy multipart requests unchanged and enforce Authorization.
3. **Tenant service**: reuse the `palette_from_image` logic—especially the compression + `image_url` packaging—by either sharing the helper or adding a new endpoint that follows the same steps but customizes the prompt/system role/model.
4. **Env/config**: ensure `llm_service_url`, `llm_api_key`, and (optionally) per-tenant overrides are set so the router can talk to GPT‑4o. Switch `llm_vision_path` if you point to a non-OpenAI-compatible endpoint.

Following these steps guarantees GPT‑4o receives both the descriptive prompt and the inlined image in one `/chat/completions` call, exactly as `/extract_stripe` does today.
