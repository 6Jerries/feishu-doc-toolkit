# feishu-markdown-importer

把 Markdown 一键导入飞书云文档（docx）的命令行工具。零依赖，Node 18+ 直接跑。

- Markdown → 飞书原生块（标题/列表/代码/表格/引用/分隔线…）
- 本地图片自动上传并回填到图片块，自动写入真实宽高
- 教材级样式扩展：高亮块（callout）、图片居中 + 原生图题（caption）、表格列宽比例铺满
- 原子操作：块列表 / 插文本 / 改文本 / 插图 / 删块，可拼任意局部修改

## 工作原理

```
markdown ──convert──▶ 飞书块树 ──transform──▶ descendant 批量插入
                          │
                          ├─ > [!warning] 引用 → callout 高亮块（emoji+配色）
                          ├─ ![alt](图) → image 块（align=2 居中 + caption 图题）
                          └─ 表格 → 列宽按比例铺满页宽（780px）

本地图片 ──▶ drive/v1/medias/upload_all（parent_node=图片块ID）
        ──▶ PATCH replace_image 回填 file_token + 真实宽高
```

全部走飞书开放平台 OpenAPI，身份为自建应用（tenant_access_token），不需要浏览器、不需要登录态。

## 快速开始

### 1. 创建企业自建应用（约 3 分钟）

1. 打开 [飞书开发者后台](https://open.feishu.cn/app) → 「创建企业自建应用」，名称随意
2. 「凭证与基础信息」页复制 **App ID** 和 **App Secret**
3. 「权限管理」→「批量导入」导入以下权限（也可逐个搜索开通）：
   ```json
   {"scopes":{"tenant":[
     "docx:document",
     "docx:document.block:convert",
     "docs:document.media:upload",
     "wiki:wiki"
   ]}}
   ```
   | 权限 | 用途 |
   |---|---|
   | `docx:document` | 读写文档块 |
   | `docx:document.block:convert` | markdown → 飞书块 |
   | `docs:document.media:upload` | 上传图片/附件 |
   | `wiki:wiki` | 解析知识库节点（wiki token → document_id） |
4. 「版本管理与发布」→ 创建版本 → 发布（个人版租户免审，企业租户需管理员审批）

### 2. 授权应用操作文档

应用只能动**被显式授权过的文档**：

- **单篇文档**：打开文档 → 右上「···」→ 更多 → 「添加文档应用」→ 搜应用名 → **可编辑**
- 未授权的文档读都读不了，不影响其他文档安全

> 注意：用应用凭证调用 API **创建**的文档归应用所有，在你的「我的空间」里看不到。所以要导入的文档请自己先建好，再添加应用。

### 3. 配置凭证

二选一：

```bash
# 方式 A：环境变量
export FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
export FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx

# 方式 B：凭证文件（默认读取）
echo '{"app_id":"cli_xxxxxxxxxxxxxxxx","app_secret":"xxxxxxxxxxxxxxxxxxxxxxxx"}' \
  > ~/.config/devin/feishu-app.json
```

> **App Secret 就是应用的全部权限**，不要提交 git、不要发给任何人。泄露了去开发者后台「凭证与基础信息」重置。

### 4. 使用

```bash
# wiki 文档：先从分享链接拿 wiki token，解析出 document_id
node feishu-doc.mjs wiki-node <wikiToken>
# 输出 node.obj_token 即 docx document_id，后续操作都用它

# 整段 markdown 导入（含本地图片自动上传）
node feishu-doc.mjs insert-md <docId> <父块ID> <插入位置index> <md文件>
# 父块ID 通常就是 docId（顶层）；index 从 0 开始

# 其他常用命令
node feishu-doc.mjs blocks <docId>                          # 列出块树（定位用）
node feishu-doc.mjs insert-text <docId> <父块> <index> <文本>  # 插一段文字
node feishu-doc.mjs set-text <docId> <块ID> <新文本>          # 覆写文本块
node feishu-doc.mjs insert-image <docId> <父块> <index> <图片>  # 建图块+上传
node feishu-doc.mjs upload-image <docId> <图块ID> <图片>       # 给空图块传图
node feishu-doc.mjs delete-children <docId> <父块> <start> <end>  # 删子块区间
```

## Markdown 样式约定

在标准 Markdown 之上扩展三种教材样式：

### 高亮块（callout）

```markdown
> [!tip] 内容……        → 💡 浅绿高亮块（别名: tip|提示|hint）
> [!note] 内容……       → 📝 浅蓝（别名: note|注意）
> [!warning] 内容……    → ⚠️ 浅橙（别名: warning|警告）
> [!important] 内容……  → 📌 浅紫（别名: important|重要）
```

标签行会被剥掉，正文内容（支持 `code`、**加粗**、多行）包成高亮块内的文本子块。

### 图片居中 + 图题

```markdown
![图5-9 $$ 双向绑定效果](assets/shot.jpeg)          → 居中图片 + 原生图题（alt 即图题）
![x](a.jpeg "图5-9 更精确的图题")                   → title 优先于 alt 作图题
![x](a.jpeg)                                       → 下一行若是 *图x-x …* 全斜体段，
*图5-9 斜体图题*                                      会被并入图题并从正文移除
```

本地图片路径相对 md 文件所在目录解析，自动上传并写入真实尺寸（jpeg/png/gif/webp）。

### 表格列宽

表格默认按列数等宽铺满正文宽（780px）。需要自定义比例时在表格后紧跟一行注释：

```markdown
| 装饰器 | 方向 | 场景 |
|---|---|---|
| `@State` | 内部 | 自身状态 |
<!-- cols 3:2:4 -->
```

三列即按 3:2:4 分配 780px。

## 常见问题

| 报错 | 原因 | 解法 |
|---|---|---|
| `1770001 invalid param` | 插入 index 越界 | index 必须在 0 ~ 父块现有 children 数之间，用 `blocks` 命令先数 |
| `1770001 invalid param` | 块里带了只读字段 | 本工具已剔除 `merge_info`/`cells`，自己拼块时注意 |
| `1770032 forBidden` | 文档没给应用授权 | 「···→更多→添加文档应用」给可编辑（读也需要，不只是写） |
| `99991672` scope 缺失 | 应用权限没开全 | 回开发者后台补齐上面 4 个权限并**重新发布版本** |
| `131006` wiki denied | 想在知识库建节点 | 建 wiki 节点需要应用是**知识库成员**，非必须——导入到已有文档不需要 |
| 图片块有了但图是空的 | upload 缺 `drive_route_token` | 本工具已处理；手拼 multipart 时 `extra` 里必须带 |

两个容易踩的坑：

- **wiki 链接里的 token 不是 document_id**。先 `wiki-node` 解析，用返回的 `obj_token` 调 docx API。
- **descendant 插入的返回值**：临时 ID → 真实 ID 的映射在 `data.block_id_relations`，不在 `descendants` 字段。

## 目录约定提示

导入长文档建议按一级节切块多次 `insert-md`（每块插入位置 = 上次插入数累加），比单次巨型插入更好定位失败点。编辑接口有 ~3 次/秒频控，工具内已做节流。

## License

MIT
