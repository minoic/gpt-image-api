# GPT Image API for OpenClaw

OpenClaw 图片生成 provider，使用 OpenAI 兼容的 `/images/generations` 和 `/images/edits`。Provider ID 是 `new`，调用时模型名例如 `new/gpt-image-2.6-flare`。插件只请求指定模型，不做自动选模、回退或 Gemini 协议转换。

## 状态

- 目标环境：Node.js 22+，OpenClaw 2026.10.5。已在隔离的 2026.10.5 环境验证安装、加载和请求路由，并通过本地测试；**尚未使用真实 Sub2API 凭证完成端到端生成与编辑验证**。
- `baseUrl` 指向 OpenAI 兼容 API 的 v1 根路径，例如 `https://example.com/v1`。插件不会自动追加 `/v1`。
- 插件通过 OpenClaw 的 HTTP SDK 发起请求，遵守其网络策略。支持 `b64_json` 图片响应；返回 URL 的上游当前会明确报错，避免不受控制地下载地址。
- 实际参数、可用尺寸、模型和权限由上游决定。

## 安装

克隆本仓库后，使用现有 OpenClaw 安装命令：

```sh
openclaw plugins install --link /path/to/gpt-image-api
```

插件会请求能力确认，按照 OpenClaw 提示完成。之后按网关的部署方式重载插件或重启 Gateway。安装前确保 `new` 未被其他插件占用；本插件不会替换 `newapi`。

## 配置

在 Gateway 进程的环境中设置：

```sh
GPT_IMAGE_BASE_URL=https://example.com/v1
GPT_IMAGE_API_KEY=your-api-key
GPT_IMAGE_MODEL_ID=gpt-image-2
```

不要将实际密钥提交到仓库或粘贴到公开日志。也可以通过 OpenClaw 的 `models.providers.new.baseUrl` 和 `apiKey` 配置端点及密钥，或使用 OpenClaw 的 provider 授权配置。baseUrl 优先级为 OpenClaw provider 配置、环境变量；密钥优先使用 OpenClaw 授权配置，再使用 provider 配置和环境变量。未设置 `GPT_IMAGE_MODEL_ID` 时默认模型为 `gpt-image-2`。显式传入 `new/<model-id>` 始终使用该模型，不会悄悄切换。

```json5
{
  agents: { defaults: { mediaModels: { image: { primary: "new/gpt-image-2.6-flare" } } } }
}
```

按照你部署的 OpenClaw 配置约定设置模型白名单或 provider 信息；配置修改后验证插件已加载。

## 调用

```sh
openclaw infer image generate --model new/gpt-image-2.6-flare --prompt "A small red circle" --size 1024x1024 --quality high --json
openclaw infer image edit --model new/gpt-image-2.6-flare --file /path/input.png --prompt "Make it blue" --json
```

支持 OpenClaw 传入的 `prompt`、`model`、`count`、`size`、`quality`、`outputFormat`、`background` 和 `providerOptions.openai` 中的 `moderation`、`outputCompression`、`user`、`inputFidelity`、`complexity`、`frameCount`、`frameDurationMs`、`responseFormat`、`partialImages`。编辑支持最多五张输入图片，使用 multipart `image[]`。上游可能不支持其中某些字段，请以具体模型和 API 为准。当前不支持 mask、流式响应或 URL 形式的结果。

**GIF/SVG 和 2.6 参数边界：**插件核心包含对应参数到 OpenAI 字段的映射，并可识别返回的 GIF/SVG 数据，但 OpenClaw 2026.10.5 的共享 `image_generate` 类型只允许 png/jpeg/webp，也未提供 GIF 帧数、时长和 complexity 的标准工具参数。正常 CLI/agent 调用不能保证传入这些值或正确交付 GIF/SVG；必须等宿主支持或另做工具入口，并用真实 Sub2API 和账号验证。不能将内部映射视为端到端支持。

## 开发

```sh
npm test
npm run check
```

源码为原生 ESM JavaScript，无编译步骤或运行时 npm 依赖；OpenClaw SDK 由宿主提供。`src/core.js` 负责请求和响应映射，`src/index.js` 负责 OpenClaw 注册、认证和安全 HTTP 请求。

## 来源

参考了 `@wstanfeng/newapi-image` 的 ClawHub 0.1.6 已发布 JavaScript 和插件清单，以及 OpenClaw SDK 文档。原 npm 包查询返回 404；原 GitHub 仓库不可公开访问。此仓库是针对所需功能重新实现的精简代码，并非原 TypeScript 源码或完整恢复的 Git 历史；原插件未见许可证文件，原作者保留其代码权利，本仓库尚未声明许可证。
