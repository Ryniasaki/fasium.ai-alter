# Project Architecture

This repository contains three cooperating services that power the image redesign (image edit) experience. This document explains the roles, key endpoints, and the end‑to‑end request flow when the frontend “Redesign” page triggers the image edit workflow. The content focuses on stable concepts and paths rather than line‑specific implementation details.

## Components

- comfyui-clothing (Next.js)
  - User interface and Next.js API routes under `/api/*`.
  - Handles user auth state (Bearer token in localStorage) and proxies browser requests to the Tenant Service.
  - Redesign page merges user drawings with the base image(s) in the browser before sending to the backend.

- comfyui-tenant-service (FastAPI)
  - Multi‑tenant API, auth verification, and a proxy to RunningHub.
  - Persists lightweight task records and serves stored output images via a static proxy route.
  - Normalizes requests/responses across services and adds `tenantTaskId` for tracking.

- comfyui-runninghub (FastAPI)
  - Workflow layer exposing:
    - Dynamic workflow endpoints: `POST /v1/generate/{workflow_name}`
    - Convenience endpoints:
      - `POST /v1/complete_image_edit` (image edit: upload + edit)
      - `POST /v1/complete_pattern_extract` (pattern extract: upload + extract)
  - Each workflow assembles a `node_info_list` and enqueues a task for processing, returning a `taskId` for polling.

## Configuration & Addresses

- Frontend → Tenant Service base URL: `NEXT_PUBLIC_TENANT_API_URL` (defaults to `http://localhost:8081`).
- Tenant Service → RunningHub base URL: `settings.runninghub_service_url` (prefixes `/v1`).
- The RunningHub server enables CORS for local development.

## Key Responsibilities

- Frontend
  - Collects images and a prompt; merges user brush/eraser mask onto images in‑browser.
  - Sends multipart form‑data for image edit requests; polls status and retrieves results via API routes.

- Tenant Service
  - Verifies Authorization, identifies tenant/user, and proxies requests to RunningHub.
  - For `complete_image_edit`, creates a tenant task record and returns both `taskId` and `tenantTaskId`.
  - On completion, fetches outputs from RunningHub, downloads them locally under `output/<user>/...`, updates the task record, and returns local storage paths.
  - Serves stored images via a static route for the frontend to display.

- RunningHub
  - Accepts image edit requests and implements workflows.
  - For `complete_image_edit`, uploads received image files, builds a workflow config (`webapp_id` + `node_info_list`), and enqueues a task. Returns a `taskId` immediately.
  - Exposes task status and output retrieval endpoints.

## End‑to‑End Flow: Redesign (Complete Image Edit)

1) User action (Frontend UI)
   - User uploads up to 4 images and optionally draws on an overlay.
   - The page merges overlay with each base image client‑side, then builds a combined prompt.
   - The frontend calls its API route with multipart form‑data containing: `file` (+ optional `file_2..file_4`) and `prompt`.

2) Next.js API proxy → Tenant Service
   - `POST /api/proxy/complete_image_edit` forwards the request and Authorization header to `POST {TENANT_API_BASE}/proxy/complete_image_edit`.

3) Tenant Service → RunningHub
   - Validates the user/tenant, then proxies to `POST {RUNNINGHUB}/v1/complete_image_edit` as multipart form‑data.
   - On success, Tenant Service creates a tenant task record and augments the response with `tenantTaskId` before returning to the frontend.

4) RunningHub workflow execution
   - The `complete_image_edit` workflow:
     - Uploads each provided image file to its internal storage/uploader.
     - Builds a `node_info_list` that references the uploaded image names and the text prompt.
     - Enqueues the task using the workflow’s `webapp_id` and returns a `taskId` (without waiting for completion).

5) Status polling (Frontend)
   - Frontend polls `GET /api/proxy/tasks/{taskId}` → Tenant Service proxies to `GET {RUNNINGHUB}/v1/tasks/{taskId}`.
   - Stops when status is `SUCCESS` or `FAILED`.

6) Finalization and outputs (Frontend → Tenant Service)
   - Frontend calls `POST /api/proxy/tasks/{taskId}/complete`.
   - Tenant Service fetches `GET {RUNNINGHUB}/v1/tasks/{taskId}/outputs`, downloads all images into `output/<username>/...`, updates the task record, and returns `storagePaths`.
   - Frontend maps returned `storagePaths` to accessible URLs under `/api/proxy/static/images/{relativePath}` to display results.

## End‑to‑End Flow: Extract (Complete Pattern Extract)

1) User action (Frontend UI)
   - User uploads a garment/model image on `/extract` and clicks “Extract Patterns”.
   - The frontend sends multipart form‑data with `file` to its API route.

2) Next.js API proxy → Tenant Service
   - `POST /api/proxy/complete_pattern_extract` forwards the request and Authorization header to `POST {TENANT_API_BASE}/proxy/complete_pattern_extract`.

3) Tenant Service → RunningHub
   - Validates the user/tenant, then proxies to `POST {RUNNINGHUB}/v1/complete_pattern_extract`.
   - On success, creates a tenant task record (type `pattern_extract`) and augments the response with `tenantTaskId`.

4) RunningHub workflow execution
   - The `complete_pattern_extract` workflow:
     - Uploads the received image file to the upstream.
     - Builds a `node_info_list` for extract (e.g., a single `image` node with `nodeId=224`).
     - Enqueues the task with its `webapp_id` and returns `taskId`.

5) Status polling (Frontend)
   - Frontend polls `GET /api/proxy/tasks/{taskId}` → Tenant Service proxies to `GET {RUNNINGHUB}/v1/tasks/{taskId}` until completion.

6) Finalization and outputs (Frontend → Tenant Service)
   - Frontend calls `POST /api/proxy/tasks/{taskId}/complete`.
   - Tenant Service pulls `GET {RUNNINGHUB}/v1/tasks/{taskId}/outputs`, downloads images to `output/<username>/...`, updates the task record, and returns `storagePaths`.
   - Frontend displays images via `/api/proxy/static/images/{relativePath}` and switches the preview tab to “Extracted”.

## Key Endpoints (Stable Paths)

- Frontend (Next.js API → Tenant Service)
  - `POST /api/proxy/complete_image_edit` → `POST {TENANT}/proxy/complete_image_edit`
  - `POST /api/proxy/complete_pattern_extract` → `POST {TENANT}/proxy/complete_pattern_extract`
  - `GET  /api/proxy/tasks/{taskId}` → `GET  {TENANT}/proxy/tasks/{taskId}`
  - `POST /api/proxy/tasks/{taskId}/complete` → `POST {TENANT}/proxy/tasks/{taskId}/complete`
  - `GET  /api/proxy/static/images/{...}` → serves images via Tenant Service

- Tenant Service (Proxy → RunningHub)
  - `POST /proxy/complete_image_edit` → `POST {RUNNINGHUB}/v1/complete_image_edit`
  - `POST /proxy/complete_pattern_extract` → `POST {RUNNINGHUB}/v1/complete_pattern_extract`
  - `GET  /proxy/tasks/{taskId}` → `GET  {RUNNINGHUB}/v1/tasks/{taskId}`
  - `GET  /proxy/tasks/{taskId}/outputs` → `GET {RUNNINGHUB}/v1/tasks/{taskId}/outputs` (internal use during completion)
  - `POST /proxy/tasks/{taskId}/complete` → pulls outputs, downloads, stores, and responds with local paths
  - `GET  /proxy/tasks/history` → returns per‑user task history with image URLs mapped to the static route
  - `GET  /proxy/static/images/{...}` → serves stored image files from the local `output/` folder

- RunningHub (Workflow + Task Management)
  - `POST /v1/complete_image_edit`
  - `POST /v1/complete_pattern_extract`
  - `POST /v1/generate/{workflow_name}` (dynamic workflows; e.g., classical `image_edit` expects pre‑uploaded image names)
  - `GET  /v1/tasks/{taskId}`
  - `GET  /v1/tasks/{taskId}/outputs`

## Task History Filtering

- Tenant Service supports filtering task history by type via `GET /proxy/tasks/history?task_type=<type>`.
- The frontend uses this to show page‑specific histories:
  - `/redesign` requests `task_type=targeted_redesign`.
  - `/extract` requests `task_type=pattern_extract`.

## Alternative Path: Classic Image Edit (Pre‑uploaded image names)

- Instead of sending raw files to `complete_image_edit`, clients can:
  1) Upload files first to receive image names.
  2) Call `POST /v1/generate/image_edit` with `{ prompt, image_name, ... }`.
- The frontend currently prefers the `complete_image_edit` endpoint because it combines upload + edit into a single call and aligns better with multi‑image + overlay workflows.

## Task Records, Storage, and Static Serving

- Tenant Service records per‑user tasks with fields such as `tenant_task_id`, `runninghub_task_id`, type, status, timestamps, and (on completion) `storage_paths`/`image_urls`.
- On finalization, images are downloaded under `output/<username>/...` and exposed through the Tenant Service static route. Frontend uses the Next.js API proxy path to retrieve them.

## Authentication and Headers

- Frontend attaches a Bearer token in the `Authorization` header to Next.js API routes.
- Next.js forwards the header to the Tenant Service, which validates the user and tenant context.
- Tenant Service proxies only the necessary payload and metadata to RunningHub (it does not forward the original token to RunningHub).

## Failure Modes and Diagnostics

- If RunningHub is unavailable or times out, Tenant Service responds with a suitable HTTP error (gateway, timeout) and logs details.
- The frontend displays errors from the proxy responses and stops polling.
- A diagnostic endpoint exists on the Tenant Service to check RunningHub availability (docs, health, API prefix).

## Project Grouping via `project.json`

- When the Tenant Service runs in JSON-storage mode it now initializes `project.json` beside `task_records.json`.
- Each project entry contains:
  - `project_id` (auto-generated `project_<uuid>` if omitted),
  - `user_id` (owner, matching `task_records.user_id`),
  - `project_content` (arbitrary metadata plus a `task_ids` array of `tenant_task_id` values),
  - `created_at` / `updated_at` timestamps.
- `JSONStorage` exposes helpers to create/update projects, attach or detach task IDs, and list projects per user.
- `TaskRecordService.create_task_record` accepts optional `project_id`/`project_content` arguments so new tasks can immediately join a project. Even when SQL is the main task store, grouping metadata still lives in `project.json`, avoiding schema changes to `tenant_task_records`.

---

This document should remain accurate even when internal file names or line numbers change, since it focuses on stable endpoints, responsibilities, and data flow between services.
