# 翻书随手记（微信小程序）

## 项目概要
阅读记录工具小程序：在读/已读书架、笔记（心得+金句）、书单、作者管理、分享卡、AI 读书心得生成。

## 技术栈
- 微信小程序（基础库 3.15.2）
- WeUI + Vant 组件库
- 微信云开发（云数据库 + 云函数）
- 语音插件 WechatSI

## 数据模型
- `books` — 书籍（不含 notes 嵌套数组）
- `notes` — 笔记（独立集合，bookId 索引，_openid 隔离）
- `authors` — 作者
- `wishlist` — 书单
- `recent_notes` — 最近笔记索引（首页展示）
- `users` — 用户资料
- `ai_quota` — AI 生成次数配额

## 约定
- 读操作：直接读 DB，openid 过滤 + 云端安全规则
- 写操作：走云函数 bookOperations（openid 云端校验）
- Service 层：bookService / noteService / authorService / userService / adminService

## Phase 0 已完成
notes 从 books 嵌套数组拆为独立集合。需上传云函数 bookOperations、adminPanel（以及获取 openid 用的 quickstartFunctions）。

## 常用命令
- npm install：在 cloudfunctions/bookOperations、adminPanel、quickstartFunctions 三个目录下执行
- 云函数部署：开发者工具中右键上传部署
