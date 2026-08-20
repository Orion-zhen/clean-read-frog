# Pure 构建

`pure` 发行版是 Read Frog 的下游构建版本，不包含 Read Frog 账号/云端功能，也不包含推广的模型服务商集成。

它会移除：

- Read Frog 登录、账号、套餐、订阅和托管 AI 相关界面；
- 基于账号的 AI 字幕转录和 Notebase 集成；
- 内置的托管 AI 服务商；
- 赞助/推广服务商（目前包括 Jalapeno Cloud、Atlas Cloud 和 Tensdaq），以及它们的默认配置、添加服务商选项、持久化配置和深层链接；
- 身份验证 Cookie 权限以及自动打开的 Read Frog 网站新手引导。

本地翻译服务商、由用户提供 API Key 的服务商、自定义 AI 操作、常规字幕翻译、Google Drive 配置同步以及扩展的其他功能仍然可用。

## 常规构建

```bash
pnpm install
pnpm build:pure
```

其他浏览器及压缩包构建命令：

```bash
pnpm build:pure:edge
pnpm build:pure:firefox
pnpm zip:pure:all
```

生产环境的 Pure 构建不需要 Read Frog 的 Google/PostHog 环境变量。如果自行构建的软件包需要使用 Google Drive 同步，请自行设置 `WXT_GOOGLE_CLIENT_ID`。

## 构建本地 Firefox XPI

以下步骤用于生成未签名的 Pure Firefox XPI，并覆盖安装当前具有相同扩展 ID 的 Read Frog。

### 1. 准备环境

在仓库根目录安装依赖：

```bash
pnpm install --frozen-lockfile
```

### 2. 设置本地版本号

在 `package.json` 中，将 `version` 修改为高于 Firefox 当前已安装版本的、尚未使用过的版本号。例如，当前安装的是 `1.46.3`，可以改为：

```json
{
  "version": "1.46.4"
}
```

不要使用远高于当前版本的版本号，否则将来可能无法被正常的官方更新覆盖。

### 3. 仅构建 Firefox 产物

如需检查构建结果但暂时不打包，运行：

```bash
pnpm build:pure:firefox
```

构建结果位于：

```text
.output/firefox-mv3/
```

### 4. 构建并打包 XPI

运行 Firefox Pure 打包命令：

```bash
pnpm zip:pure:firefox
```

WXT 会在 `.output/` 下生成 Firefox ZIP。将它复制为 `.xpi` 文件：

```bash
VERSION=$(node -p "require('./package.json').version")

cp \
  ".output/read-frogextension-${VERSION}-firefox.zip" \
  ".output/read-frogextension-${VERSION}-firefox-unsigned.xpi"
```

最终可安装文件为：

```text
.output/read-frogextension-<version>-firefox-unsigned.xpi
```

XPI 本质上是使用 `.xpi` 扩展名的 ZIP 包。上述 XPI 没有经过 Mozilla 签名。

### 5. 配置 Firefox 允许安装未签名扩展

正式版 Firefox 无法永久安装未签名 XPI。请使用 Firefox Developer Edition、Nightly，或支持关闭签名检查的 ESR，然后：

1. 打开 `about:config`；
2. 搜索 `xpinstall.signatures.required`；
3. 将其设置为 `false`；
4. 打开 `about:addons`；
5. 点击右上角齿轮，选择“从文件安装附加组件”；
6. 选择上一步生成的 `*-firefox-unsigned.xpi`。

### 6. 保持扩展 ID 不变

Firefox Pure 构建继续使用 `wxt.config.ts` 中的扩展 ID：

```text
{bd311a81-4530-4fcc-9178-74006155461b}
```

要让本地构建覆盖当前安装的 Read Frog，并继续使用同一份扩展存储数据，必须保持该 ID 不变。安装时不要先卸载当前扩展；直接安装版本号更高的本地 XPI，让 Firefox 将其作为更新处理。

安装前建议备份 Firefox Profile。虽然相同扩展 ID 通常会保留 `storage.local` 等数据，但如果新旧版本的数据结构不兼容，仍可能出现配置迁移问题。

为了防止本地版本被 AMO 上的官方版本自动替换，可以在 `about:addons` 的 Read Frog 详情页中关闭该扩展的自动更新。

## 构建策略

Pure 发行版采用失败关闭（fail-closed）策略：

- 每个 API 服务商都必须显式标记为 `neutral`、`sponsored` 或 `referral`；
- 赞助/推广服务商会从服务商目录、默认值、已存储配置、链接和输出资源中移除；
- 账号、oRPC、Hosted AI、Notebase 和基于账号的字幕网关会替换为不发起网络请求的 Pure 适配层；
- 如果新的账号/云端模块引入代码但没有显式提供 Pure 适配层，构建将直接失败；
- 每次 Pure 构建完成后，都会审计生成的 manifest 和入口点。

功能服务商注册表与设置搜索注册表共享同一套能力策略，因此禁用的功能不会留下无效设置或命令面板入口。

## 跟进上游更新

此 fork 将自己的修改保留在 `main` 分支。要将这些修改重新应用到最新的上游版本：

```bash
git fetch upstream
git rebase upstream/main
SKIP_FREE_API=true pnpm test
pnpm test:pure
pnpm type-check
pnpm build:pure
git push --force-with-lease origin main
```
