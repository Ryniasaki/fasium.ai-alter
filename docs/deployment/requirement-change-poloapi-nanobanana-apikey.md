# 需求修改文档：PoloAPI 按模型拆分 APIKey（Nanobanana）

## 背景

`comfyui-tenant-service` 目前通过环境变量 `POLOAPI_APIKEY` 统一配置 PoloAPI 的鉴权密钥，所有 PoloAPI 模型调用都会使用同一个 key。

随着调用场景与配额管理需要细分，本次需要针对 `gemini-2.5-flash-image` / `gemini-3-pro-image-preview` 模型单独使用一把新的 PoloAPI key。

## 目标

- 在 `comfyui-tenant-service/.env` 中新增维护 `POLOAPI_NANOBANANA_APIKEY`。
- 当调用 PoloAPI 且模型为 `gemini-2.5-flash-image` 或 `gemini-3-pro-image-preview` 时，改用 `POLOAPI_NANOBANANA_APIKEY` 作为鉴权 key。
- 其他 PoloAPI 模型保持使用 `POLOAPI_APIKEY`。

## 需求范围

- 服务：`comfyui-tenant-service`
- 配置：`.env`（新增变量）、`.env.example`（示例补齐）
- 文档：环境变量参考文档更新

## 详细需求

1. **新增环境变量**
   - 新增 `POLOAPI_NANOBANANA_APIKEY`（字符串，必填）
   - 用途：仅用于 PoloAPI 模型 `gemini-2.5-flash-image` / `gemini-3-pro-image-preview`

2. **按模型选择 APIKey**
   - 当请求的 PoloAPI `model == "gemini-2.5-flash-image"` 或 `model == "gemini-3-pro-image-preview"` 时：
     - `Authorization` 头使用 `POLOAPI_NANOBANANA_APIKEY`
   - 当请求的 PoloAPI `model != "gemini-2.5-flash-image"` 时：
     - `Authorization` 头使用 `POLOAPI_APIKEY`

## 兼容性与迁移

- 若现阶段暂时不需要区分 key，可将 `POLOAPI_NANOBANANA_APIKEY` 先配置为与 `POLOAPI_APIKEY` 相同的值，以保证行为一致。
- 发布/部署时需同步更新 `comfyui-tenant-service/.env` 并重启服务。

## 验收标准

- `gemini-2.5-flash-image` / `gemini-3-pro-image-preview` 相关调用使用 `POLOAPI_NANOBANANA_APIKEY` 鉴权。
- 其他 PoloAPI 模型调用仍使用 `POLOAPI_APIKEY` 鉴权。
- 环境变量文档与 `.env.example` 反映新增变量与用途。
