# 功能总览

Fasium 提供完整的 AI 服装设计工具链，覆盖从灵感到成品的全流程。

## 功能列表

| 功能 | 页面路由 | 工作流 | 说明 |
|------|----------|--------|------|
| 图片改款 (Redesign) | `/redesign` | complete_image_edit | 局部重绘：改领型、袖口、面料等 |
| 花型提取 (Extract) | `/extract` | complete_pattern_extract | 从服装图中提取图案、纹理、花型 |
| 格纹提取 | `/extract_plaid` | complete_pattern_extract | 针对格纹优化的提取 |
| 条纹提取 | `/extract_stripe` | complete_pattern_extract | 针对条纹优化的提取 |
| 无缝花型 (Seamless) | `/seamless-patterns` | complete_seamless_pattern | 生成可重复拼接的面料花型 |
| 文生服装 (Text-to-Cloth) | `/text_to_cloth` | text_to_image | 通过文字描述生成服装设计图 |
| 虚拟试衣 (Try-on) | `/try-on` | complete_image_edit | 模特展示效果图生成 |
| 配色对比 (Variants) | `/variants` | variant_overlay | 面料/配色/细节多版本对比 |
| 视频生成 | `/video-generation` | complete_video_generation | 从图片生成展示视频 |
| 背景移除 | `/remove_background` | remove_background | 一键抠图 |
| 超分辨率 (Hi-Res) | `/hi_res` | super_resolution | 图片高清放大 |
| SVG 矢量化 | `/svg` | svg_vectorization | 位图转矢量图 |
| 爆款/同款 (Trending) | `/trending` | — | 基于趋势图做相似款式 |
| 工艺单 (Sheet) | `/sheet` | LLM 服务 | 技术图、里布图、技术包、成本估算 |
| AI 助手 (Chatbot) | `/chatbot` | LLM 服务 | 智能对话，辅助设计决策 |
| 设计画板 (Board) | `/board` | — | 灵感收集、素材整理、方案对比 |
| 反馈中心 (Feedback) | `/feedback` | — | 提交反馈并按月奖励 500 点，管理员可查看全部反馈 |
| 项目管理 (Project) | `/project` | — | 项目分组、任务归档 |
| LoRA 模型 | `/model` | — | 上传和管理自定义风格模型 |
| 任务记录 | `/tasks-record` | — | 查看历史任务，复用参数 |
| 管理端 (Admin) | `/admin` | — | 用户管理、计费设置、数据查看 |
| 用户设置 | `/settings` | — | 账号信息、密码修改 |

## 核心设计流程

```
灵感探索                    落地打样
  ↓                         ↓
Text-to-Cloth/Trending  →  Redesign（改款）
  ↓                         ↓
Extract（提取花型）     →  Variants（配色对比）
  ↓                         ↓
Seamless（无缝花型）    →  Try-on（试穿展示）
  ↓                         ↓
Board（整理方案）       →  Sheet（工艺单）
                            ↓
                        Hi-Res / Remove BG（输出成品图）
```

## 辅助功能

| 功能 | 说明 |
|------|------|
| 积分系统 | 每次 AI 生成消耗积分，管理员可配置费率和兑换码 |
| 反馈激励 | 每次成功提交反馈奖励 500 点，每个自然月最多奖励 3 次 |
| 团队协作 | 项目共享、成员邀请、权限管理 |
| 国际化 | 中文/英文双语切换 |
| 暗色模式 | 支持亮色/暗色主题 |
| 任务历史 | 按类型筛选，查看输入参数和结果，支持复用 |
