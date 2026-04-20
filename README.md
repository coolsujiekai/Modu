# 翻书随手记（微信小程序）

一个极简的阅读记录工具：在读/已读书架、每本书的笔记、书单（想读列表）、书名/作家搜索等。

**新增功能**：
- 阅读统计：累计阅读书本数、产生灵感（心得）数、收集金句数，支持按年/月分组查看
- 搜索结果关键字高亮
- 个性化设置中深色模式支持（基于系统 prefers-color-scheme 和 WeUI dark theme）
- 统一优化的丰富空状态与加载动画

## 技术栈

- 小程序前端 + WeUI
- 微信云开发（云数据库为主）

## 数据与隐私（重要）

本项目采用“免注册”的方式：用户打开即可使用，数据隔离依赖微信云开发身份与云数据库安全规则。

- **用户私有集合（必须按用户隔离）**：`books`、`wishlist`、`authors`
- **隔离原则**：仅数据创建者可读写（通过 `_openid` / `auth.openid` 规则实现）
- **头像/昵称**：默认不获取；仅在「更多 → 个性化设置」中用户主动开启时才会请求授权

## 本地开发 / 运行

1. 使用微信开发者工具打开本仓库根目录（项目配置见 `project.config.json`）。
2. 开通云开发并创建环境（推荐使用正式环境ID）。
3. **必须上传云函数**：在开发者工具中右键 `cloudfunctions/quickstartFunctions` 文件夹，选择「上传并部署 - 云函数」，确保 `quickstartFunctions` 函数部署成功。这是获取 openid 的必要步骤。
4. 在 `miniprogram/app.js` 中确认 `wx.cloud.init({ env })` 指向你的云环境 ID（当前默认 `reading-log-6gz8yfff5189799d`，请替换为你的环境）。
5. 如果看到 “[db] No openid...” 警告，说明云函数未成功部署或网络问题，数据隔离仍由云安全规则保护。

**常见问题**：
- `FunctionName parameter could not be found`：必须上传 `quickstartFunctions` 云函数。
- 查询 timeout：请在云控制台为 `books` 集合的 `status` + `startTime`、`endTime` 等字段创建索引。

## 云函数（必须部署）

本项目有两个云函数，均需部署：

### quickstartFunctions
获取 openid（用于客户端 `_openid` 过滤，提供安全防御纵深）。

**部署步骤**：
1. 在微信开发者工具左侧「云开发」面板，切换到你的环境。
2. 右键 `cloudfunctions/quickstartFunctions` 文件夹 → 「上传并部署 - 云函数」。
3. 部署成功后，`quickstartFunctions` 会出现在云函数列表中。

### bookOperations（v2 新增）
统一处理所有书籍/笔记写操作，云端强制校验 `_openid`，即使客户端伪造也无法越权读写他人数据。

**部署步骤**：
1. 右键 `cloudfunctions/bookOperations` 文件夹 → 「上传并部署 - 云函数」。
2. 依赖会自动部署（`wx-server-sdk ~2.4.0`）。
3. 部署成功后，客户端写操作会自动路由至此函数。

> 注意：`bookOperations` 的 `config.json` 暂未申请 `openapi` 权限，如有额外需求请按需添加。

## 云数据库（需要你在控制台完成）

### 1) 创建集合

在云开发控制台创建：

- `books`
- `wishlist`
- `authors`

### 2) 配置安全规则（上线前必须）

将上述集合设置为“仅创建者可读写”（按 `_openid` / `auth.openid` 进行校验），避免不同用户之间数据互相可见或可修改。

**推荐索引**（减少 timeout，提升性能，必须在上线前创建）：

| 集合 | 索引字段（顺序重要） | 索引类型 | 用途 |
|------|---------------------|---------|------|
| `books` | `status` ASC, `startTime` DESC | 复合 | 在读列表按开始时间排序 |
| `books` | `status` ASC, `endTime` DESC | 复合 | 已读列表按结束时间排序 |
| `books` | `authorId` ASC, `status` ASC | 复合 | 按作者筛选书籍 |
| `books` | `_openid` ASC | 单字段 | 用户数据隔离过滤 |
| `authors` | `_openid` ASC | 单字段 | 作者列表过滤 |
| `wishlist` | `_openid` ASC | 单字段 | 想读列表过滤 |

创建方式：云开发控制台 → 数据库 → 选择集合 → 索引管理 → 添加索引。

> 说明：规则和索引在云开发控制台配置，不随仓库自动同步。

## 发布前检查清单

- 云函数 `quickstartFunctions` 已上传部署（用于 openid 获取）
- 云函数 `bookOperations` 已上传部署（v2 新增，统一处理所有写操作）
- 云环境 ID 为正式环境（非临时/测试）
- `books`/`wishlist`/`authors` 安全规则已收紧为仅创建者可读写
- **索引已创建**（必须，否则已读/在读列表可能查不出来）
- 用两个不同微信号验证互相不可见、不可改（含搜索/联想等入口）
- “更多”页隐私指引文案已就绪（`pages/privacy/privacy`）
- **HarmonyOS 兼容**：基础库 ≥ 3.7.0 已支持，建议在未来版本中逐步替换 `wx.getSystemInfo()` 为 `wx.getDeviceInfo()`（当前警告来自基础库/WeUI，可忽略）

**注意**：客户端 `_openid` 过滤是“防御纵深”，即使 openid 未加载，主隔离仍依赖云数据库安全规则。


## v2 升级说明

本版本进行了以下架构升级，建议在测试环境充分验证后再合入正式版：

- **Service 层**：`miniprogram/services/` 下新增 `bookService.js`、`noteService.js`、`authorService.js`，业务逻辑收敛，不再散落在 Page 对象里
- **云函数写操作**：书籍/笔记/作者的所有写操作（增/删/改）统一走 `bookOperations` 云函数，云端强制校验 `_openid`，即使客户端伪造也无法越权
- **分享卡 URL 参数**：改为 `wx.setStorage` 中转，解决长书单跳转时的 URL 长度限制
- **Bug 修复**：personalize.js 重复方法、personalize.wxml 重复区块、bookNotes 不读 noteTimeMode 设置等问题已一并修复

