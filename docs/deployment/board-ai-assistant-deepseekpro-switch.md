# Board AI Assistant：审核走 DeepSeek，主流程走 Cherry

## 目标

这次不是把 `/board` 的全部对话都切到 DeepSeek，而是把链路拆成两段：

- 前置安全审核单独走 DeepSeek
- 后续真实业务处理、主对话和两个辅助请求继续走 Cherry / PoloAPI

这样可以保留原来的 Cherry 模型调用方式，同时把安全审核独立出来。

## 请求分流

### 1) 安全审核

前端会先发这一个请求：

```text
POST /api/proxy/llm/poloapi/chat_messages_audit
```

tenant service 再转到：

```text
POST /proxy/llm/poloapi/chat_messages_audit
```

这条链路使用 `POLOAPI_AUDIT_*` 配置，建议接 DeepSeek：

- `POLOAPI_AUDIT_BASE_URL=https://api.deepseek.com`
- `POLOAPI_AUDIT_APIKEY=<DeepSeek API Key>`
- `POLOAPI_AUDIT_MODEL=deepseek-v4-pro`

安全审核会读取当前画板上下文的文本信息和数量摘要，先判断是否违规；由于 DeepSeek 这条审核链路是文本接口，后端不会把 `image_url` 图像块转给它。如果判定不安全，前端直接返回固定拒绝语，不再继续后面的请求。

### 2) 主对话

审核通过后，主对话继续走原来的 Cherry / PoloAPI 文本链路：

```text
POST /api/proxy/llm/poloapi/chat_messages
```

tenant service 对应的是：

```text
POST /proxy/llm/poloapi/chat_messages
```

这条链路使用 `POLOAPI_TEXT_*` 配置。`POLOAPI_TEXT_APIKEY` 可以留空，留空后会回退到 `POLOAPI_APIKEY`。

### 3) 两个辅助请求

主对话后面的建议问题请求、能力路由请求，仍然继续走 `chat_messages` 这条 Cherry 链路，不会切到 DeepSeek。

## 推荐配置

### Cherry 主流程

```env
POLOAPI_APIKEY=<Cherry / PoloAPI key>
POLOAPI_BASE_URL=https://open.cherryin.net/v1
POLOAPI_TEXT_BASE_URL=https://open.cherryin.net/v1
POLOAPI_TEXT_APIKEY=
POLOAPI_TEXT_MODEL=gemini-3-flash-preview
```

Cherry 请求会由后端自动补 `Authorization: Bearer <key>`，所以这里填写的是原始 `sk-...` API Key，不要手动再加 `Bearer` 前缀。

### DeepSeek 审核

```env
POLOAPI_AUDIT_BASE_URL=https://api.deepseek.com
POLOAPI_AUDIT_APIKEY=<DeepSeek API Key>
POLOAPI_AUDIT_MODEL=deepseek-v4-pro
```

### 保持不变的图像链路

```env
POLOAPI_IMAGE_BASE_URL=https://open.cherryin.net/v1
POLOAPI_IMAGE_APIKEY=<图像链路 key>
POLOAPI_IMAGE_MODEL=google/gemini-3.1-flash-image-preview
```

## 安全审核行为

安全审核请求会传入：

- `messages`：包含审核专用 system prompt 和用户输入
- `projectId` / `assetIds`：让后端定位当前画板上下文，并在 prompt 里补充数量摘要
- `response_format: {"type":"json_object"}`
- `temperature: 0`

返回值约定为：

```json
{
  "isSafe": true,
  "reason": "",
  "refusal": ""
}
```

处理规则：

- 如果内容包含绝对禁止内容、越狱诱导或明显违规信息，前端直接视为不安全
- 如果 `isSafe=false`，前端直接回复 `抱歉，我无法提供该内容。`
- 如果安全审核失败或返回不可解析结果，前端不会继续发送主对话和两个辅助请求
- 只有审核通过后，才会继续后续业务请求

## 验证方法

1. 重启 tenant service 或整套 compose。
2. 打开 `/board`。
3. 发送一句正常问题，例如“你好，帮我分析这个设计思路”。
4. 再发一句明显违规或越狱诱导内容，确认只返回拒绝语，不会继续进入主对话。

## 回滚方法

如果以后想把审核也切回 Cherry，只需要把 `POLOAPI_AUDIT_*` 改回 Cherry 对应配置，或者直接让审核请求重新指向 `chat_messages`。
