# 前端开发规范

## 目录结构

```
comfyui-clothing/
├── app/
│   ├── api/                # Next.js API Routes（后端代理层）
│   │   ├── auth/           # 认证相关
│   │   ├── feedback/       # 反馈代理
│   │   ├── proxy/          # 工作流代理
│   │   ├── admin/          # 管理端
│   │   ├── models/         # LoRA 模型
│   │   ├── chatbot/        # AI 聊天
│   │   └── trending/       # 趋势相关
│   ├── redesign/           # 改款页面
│   ├── extract/            # 花型提取
│   ├── board/              # 设计画板
│   ├── feedback/           # 反馈中心
│   ├── dashboard/          # 仪表盘
│   ├── try-on/             # 虚拟试衣
│   ├── text_to_cloth/      # 文生服装
│   ├── ...                 # 其他功能页面
│   ├── page.tsx            # 首页
│   └── layout.tsx          # 根布局
├── components/
│   ├── ui/                 # shadcn/ui 基础组件（60+）
│   ├── sheet/              # Sheet 相关组件
│   ├── navigation.tsx      # 导航栏
│   ├── login-modal.tsx     # 登录弹窗
│   └── ...
├── contexts/
│   ├── auth-context.tsx    # 认证状态
│   └── i18n-context.tsx    # 国际化
├── hooks/                  # 自定义 Hooks
├── lib/
│   ├── api-client.ts       # 通用 API 客户端
│   ├── redesign-api-client.ts
│   ├── extract-api-client.ts
│   ├── text-to-image-api-client.ts
│   ├── video-generation-api-client.ts
│   ├── pantone.ts          # Pantone 色卡工具
│   ├── credit-guard.ts     # 积分校验
│   └── i18n/               # 国际化配置
├── styles/                 # 全局样式
└── public/                 # 静态资源
```

## 页面路由与功能对照

| 路由 | 功能 | 对应工作流 |
|------|------|------------|
| `/redesign` | 图片改款/局部重绘 | complete_image_edit |
| `/extract` | 花型/纹理提取 | complete_pattern_extract |
| `/extract_plaid` | 格纹提取 | complete_pattern_extract |
| `/extract_stripe` | 条纹提取 | complete_pattern_extract |
| `/text_to_cloth` | 文生服装 | text_to_image |
| `/try-on` | 虚拟试衣 | complete_image_edit |
| `/seamless-patterns` | 无缝花型 | complete_seamless_pattern |
| `/remove_background` | 背景移除 | remove_background |
| `/hi_res` | 超分辨率 | super_resolution |
| `/svg` | SVG 矢量化 | svg_vectorization |
| `/video-generation` | 视频生成 | complete_video_generation |
| `/variants` | 配色对比 | variant_overlay |
| `/trending` | 爆款/同款 | — |
| `/board` | 设计画板 | — |
| `/feedback` | 反馈中心 | — |
| `/sheet` | 工艺单 | LLM 服务 |
| `/project` | 项目管理 | — |
| `/model` | LoRA 管理 | — |
| `/chatbot` | AI 助手 | LLM 服务 |
| `/admin` | 管理端 | — |
| `/admin/reset-password` | 重置密码 | — |
| `/tasks-record` | 任务记录 | — |
| `/settings` | 设置 | — |

## 组件体系

UI 基于 [shadcn/ui](https://ui.shadcn.com/)（底层为 Radix UI），组件位于 `components/ui/`。

常用组件：
- `Button`, `Card`, `Dialog`, `Form`, `Input`, `Select` — 基础交互
- `Tabs`, `Accordion`, `Collapsible` — 布局容器
- `Toast` (Sonner), `Tooltip`, `Popover` — 提示反馈
- `Carousel` (Embla), `Chart` (Recharts) — 展示类

添加新 shadcn/ui 组件：
```bash
npx shadcn@latest add <component-name>
```

## API 客户端

每个主要功能有对应的 API 客户端（`lib/` 目录），封装了：
- 请求构建（FormData / JSON）
- Authorization header 注入
- 错误处理

典型使用方式：

```typescript
import { submitRedesign, pollTaskStatus, completeTask } from '@/lib/redesign-api-client';

// 1. 提交任务
const { taskId, tenantTaskId } = await submitRedesign(formData, token);

// 2. 轮询状态
const status = await pollTaskStatus(taskId, token);

// 3. 获取结果
const result = await completeTask(taskId, token);
```

## 状态管理

项目使用 React Context API，不使用第三方状态库。

### auth-context

- 管理用户登录状态、token、用户信息
- 提供 `login()`, `logout()`, `register()` 方法
- 建立 WebSocket 连接接收积分更新
- Token 存储在 localStorage

### i18n-context

- 管理语言切换（中文 zh / 英文 en）
- 提供 `t()` 翻译函数
- 语言偏好存储在 localStorage + Cookie

## 国际化

翻译文件位于 `lib/i18n/translations.ts`，使用方式：

```typescript
const { t } = useI18n();
return <p>{t('redesign.title')}</p>;
```

## 样式规范

- 使用 Tailwind CSS 编写样式，避免自定义 CSS
- 主题色通过 CSS 变量定义（`globals.css`），支持亮色/暗色模式
- 颜色使用 HSL 格式
- 响应式布局优先使用 Tailwind 断点（`sm:`, `md:`, `lg:`）
