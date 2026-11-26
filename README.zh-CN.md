# Markpad Live

Markpad Live 是基于 [Markpad](https://github.com/sftwrdotdev/Markpad) 的桌面 Markdown 编辑器。使用 Milkdown 在渲染后的文档中编辑，并将结果保存为 Markdown。图表、数学公式、标注块及其他扩展语法可在预览窗格中查看。

支持多标签、多窗口、会话恢复、目录、自动保存、图片粘贴、HTML 导出及 PDF 打印。编辑界面沿用 Markpad 的工具栏和主题。分栏模式左侧为可视化编辑器，右侧为可编辑的 Markdown 源码。代码图标可切换到独立源码编辑。没有可视化编辑支持的扩展块以原文显示。改动格式化段落时，其 Markdown 标记可能会重新序列化。

技术栈为 Tauri 2、Rust、SvelteKit、TypeScript 和 Milkdown Kit。构建步骤与兼容性说明见 [README](README.md)。原项目的 BSD 3-Clause 许可证和版权声明保存在 [LICENSE](LICENSE)。
