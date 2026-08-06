export type ToolApp = {
  name: string;
  description: string;
  llmDescription?: string;
  href: string;
  accent: string;
  category: string;
  focus: string;
  displayName: string;
  impact: string;
  status?: string;
};

export const toolApps: ToolApp[] = [
  {
    name: "Targeted Redesign",
    description: "通用改图工具，最多支持 4 张参考图；在提示词中描述更改。",
    llmDescription:
      "通用改图工具，可上传 1-4 张参考图。写 prompt 时请交代：要改的部位/元素、想要的风格或参考品牌、必须保持的内容（如姿势/构图）。支持局部改、换色、换材质等。",
    href: "/redesign",
    accent: "from-emerald-400 to-green-500",
    category: "设计提案",
    focus: "款式升级",
    displayName: "改图",
    impact: "版型与面料双向联动",
  },
  {
    name: "High Resolution",
    description: "提升图像清晰度，适合提升素材和细节展示。",
    href: "/hi_res",
    accent: "from-slate-200 to-slate-500",
    category: "展示输出",
    focus: "细节修复",
    displayName: "高清增强",
    impact: "高清回传可直接上架",
  },
  {
    name: "Background Removal",
    description: "自动抠出主体并生成带透明图层的png图片。",
    href: "/remove_background",
    accent: "from-amber-200 to-orange-500",
    category: "展示输出",
    focus: "去除背景",
    displayName: "去除背景",
    impact: "透明底图即刻使用",
  },
  {
    name: "SVG Vectorization",
    description: "把参考图快速转成可编辑的 SVG 矢量文件。",
    href: "/svg",
    accent: "from-emerald-300 to-cyan-500",
    category: "展示输出",
    focus: "矢量复刻",
    displayName: "转矢量图",
    impact: "与 CAD 打通",
  },
  {
    name: "Seamless Patterns",
    description: "生成无缝铺陈的花型，支持重复与导出。",
    href: "/seamless-patterns",
    accent: "from-violet-400 to-purple-500",
    category: "设计提案",
    focus: "花型生成",
    displayName: "无缝花型",
    impact: "重复单元自动对齐",
  },
];

export const toolCategories = [
  "全部功能",
  ...Array.from(new Set(toolApps.map((tool) => tool.category))),
];
