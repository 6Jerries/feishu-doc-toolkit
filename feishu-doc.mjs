#!/usr/bin/env node
// 飞书 docx 文档操作工具（自建应用 TAT 身份）
// 凭证: env FEISHU_APP_ID / FEISHU_APP_SECRET，或 ~/.config/devin/feishu-app.json {"app_id","app_secret"}
// 用法:
//   node feishu-doc.mjs token
//   node feishu-doc.mjs wiki-node <wikiToken>
//   node feishu-doc.mjs create <title>            # 建测试文档，输出 document_id
//   node feishu-doc.mjs blocks <docId>
//   node feishu-doc.mjs convert <mdFile>
//   node feishu-doc.mjs insert-md <docId> <parentBlockId> <index> <mdFile>
//   node feishu-doc.mjs insert-image <docId> <parentBlockId> <index> <imagePath>
//   node feishu-doc.mjs upload-image <docId> <imageBlockId> <imagePath>
//   node feishu-doc.mjs set-text <docId> <blockId> <text>   # 覆写文本块内容
//   node feishu-doc.mjs delete-children <docId> <parentBlockId> <startIndex> <endIndex>
//
// insert-md 支持的教材样式约定（在标准 markdown 之上扩展）:
//   > [!tip] 内容      → 高亮块（callout）💡浅绿    别名: tip|提示|hint
//   > [!note] 内容     → 高亮块 📝浅蓝              别名: note|注意|注意：
//   > [!warning] 内容  → 高亮块 ⚠️浅橙              别名: warning|警告
//   > [!important] 内容→ 高亮块 📌浅紫              别名: important|重要
//   ![alt](a.jpg "图5-1 标题")  → 图片居中 + 图题（native caption，title 缺省用 alt）
//   图片下一行是 *图x-x 说明* 的斜体段 → 并入图题
//   表格后紧跟 <!-- cols 2:3:1 --> → 列宽按 2:3:1 铺满 780px；无标注则等宽铺满
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const API = 'https://open.feishu.cn/open-apis';
const CRED_FILE = path.join(os.homedir(), '.config/devin/feishu-app.json');
const TOKEN_CACHE = '/tmp/feishu-tat.json';
const PAGE_WIDTH = 780; // docx 正文可用宽度（px），实测现有表格列宽和
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const CALLOUTS = {
  tip: { emoji: 'bulb', bg: 4 }, 提示: { emoji: 'bulb', bg: 4 }, hint: { emoji: 'bulb', bg: 4 },
  note: { emoji: 'memo', bg: 5 }, 注意: { emoji: 'memo', bg: 5 },
  warning: { emoji: 'warning', bg: 2 }, 警告: { emoji: 'warning', bg: 2 },
  important: { emoji: 'pushpin', bg: 6 }, 重要: { emoji: 'pushpin', bg: 6 },
};

function creds() {
  if (process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET)
    return { app_id: process.env.FEISHU_APP_ID, app_secret: process.env.FEISHU_APP_SECRET };
  if (fs.existsSync(CRED_FILE)) return JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'));
  die(`缺少凭证：设 FEISHU_APP_ID/FEISHU_APP_SECRET，或写 ${CRED_FILE}`);
}

function die(msg) { console.error('ERROR:', msg); process.exit(1); }

async function tat() {
  try {
    const c = JSON.parse(fs.readFileSync(TOKEN_CACHE, 'utf8'));
    if (c.expire > Date.now() + 60_000) return c.token;
  } catch {}
  const { app_id, app_secret } = creds();
  const r = await fetch(`${API}/auth/v3/tenant_access_token/internal`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id, app_secret }),
  }).then(r => r.json());
  if (r.code !== 0) die(`获取 TAT 失败: ${JSON.stringify(r)}`);
  fs.writeFileSync(TOKEN_CACHE, JSON.stringify({ token: r.tenant_access_token, expire: Date.now() + r.expire * 1000 }));
  return r.tenant_access_token;
}

async function api(method, url, body) {
  const t = await tat();
  const r = await fetch(`${API}${url}`, {
    method,
    headers: { Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (j.code !== 0) die(`${method} ${url} -> code=${j.code} ${j.msg} ${j.error?.log_id ?? ''}`);
  return j.data;
}

// ---------- 图片尺寸（jpeg/png/gif/webp 最小解析） ----------
function imageSize(file) {
  const b = fs.readFileSync(file);
  if (b[0] === 0x89 && b[1] === 0x50) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }; // png
  if (b[0] === 0x47 && b[1] === 0x49) return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) }; // gif
  if (b[0] === 0xFF && b[1] === 0xD8) { // jpeg
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xFF) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC)
        return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  if (b.slice(8, 12).toString() === 'WEBP') {
    const t = b.slice(12, 16).toString();
    if (t === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (t === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (t === 'VP8L') { const v = b.readUInt32LE(21); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
  }
  return {};
}

// ---------- markdown 源解析（与 convert 结果按出现顺序配对） ----------
// 图片: ![alt](src "title")  → [{src, alt, title}]
function mdImages(md) {
  return [...md.matchAll(/!\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+"([^"]*)")?\s*\)/g)]
    .map(m => ({ alt: m[1], src: m[2], title: m[3] ?? null }));
}
// 表格: 每个 ```|...|``` 连续段记为一张表；其后 <!-- cols a:b:c --> 记比例
function mdTableRatios(md) {
  const specs = [];
  const re = /((?:^\|[^\n]*\|[ \t]*\n?)+)/gm;
  let m;
  while ((m = re.exec(md))) {
    const after = md.slice(m.index + m[0].length).match(/^\s*<!--\s*cols?\s+([0-9:.\s]+)\s*-->/);
    specs.push(after ? after[1].trim().split(':').map(Number) : null);
  }
  return specs;
}

// ---------- convert 结果的块树变换 ----------
function elementsText(block) {
  const payload = Object.values(block).find(v => v && typeof v === 'object' && Array.isArray(v.elements));
  return (payload?.elements ?? []).map(e => e.text_run?.content ?? '').join('');
}
function payloadOf(block) {
  return Object.values(block).find(v => v && typeof v === 'object' && Array.isArray(v.elements));
}

// 引用块(15) → 高亮块(19)；quote.elements 是内联内容，需包成 text 子块
function toCallout(block, spec, newBlocks) {
  const els = block.quote?.elements ?? [];
  const e0 = els[0];
  if (e0?.text_run) e0.text_run.content = e0.text_run.content.replace(/^\s*\[!?[^\]]{1,12}\]\s*\n?/, '');
  if (e0?.text_run && !e0.text_run.content) els.shift(); // 剥完空元素移除
  if (!els.length) els.push({ text_run: { content: ' ' } }); // 保底不空
  const childId = 'txt-' + block.block_id;
  newBlocks.push({ block_id: childId, block_type: 2, children: [], text: { elements: els } });
  block.block_type = 19;
  delete block.quote;
  block.callout = {
    emoji_id: spec.emoji,
    background_color: spec.bg,
    border_color: spec.bg,
  };
  block.children = [childId];
}

function transformBlocks(conv, md) {
  const byId = new Map(conv.blocks.map(b => [b.block_id, b]));
  const imgs = mdImages(md);
  const ratios = mdTableRatios(md);
  let imgIdx = 0, tblIdx = 0;
  const dropIds = new Set();
  const newBlocks = [];

  // 文档序遍历（first_level + children DFS），用于图片/表格与 markdown 源按序配对
  const ordered = [];
  const walk = (ids) => ids?.forEach(id => {
    const b = byId.get(id);
    if (!b) return;
    ordered.push(b);
    walk(b.children);
  });
  walk(conv.first_level_block_ids);
  // 兜底：不在树内的块（理论上没有）也追加
  for (const b of conv.blocks) if (!ordered.includes(b)) ordered.push(b);

  for (const b of ordered) {
    delete b.parent_id;
    if (b.table) {
      delete b.table.cells; // 输出态字段，创建时不收
      delete b.table.merge_info;
      delete b.table.property?.merge_info; // merge_info 是只读属性，带入会报 invalid param
      const prop = b.table.property ?? b.table;
      if (prop?.column_width) {
        const cols = prop.column_size ?? prop.column_width.length;
        const r = ratios[tblIdx];
        const sum = (r && r.length === cols) ? r.reduce((a, c) => a + c, 0) : cols;
        prop.column_width = Array.from({ length: cols }, (_, i) =>
          Math.round(PAGE_WIDTH * ((r?.[i] ?? 1) / sum)));
      }
      tblIdx++;
    }
    if (b.block_type === 27 && b.image) {
      delete b.image.token;
      b.image.align = 2; // 图片居中
      const spec = imgs[imgIdx];
      const cap = spec?.title ?? spec?.alt;
      if (cap) b.image.caption = { content: cap };
      imgIdx++;
    }
    if (b.block_type === 15 && b.quote) { // quote → 可能是 callout
      const firstText = (b.quote.elements ?? []).map(e => e.text_run?.content ?? '').join('');
      const m = firstText.match(/^\s*\[!?([^\]]{1,12})\]/);
      const spec = m && CALLOUTS[m[1].trim().toLowerCase()];
      if (spec) toCallout(b, spec, newBlocks);
    }
  }

  // 第二遍：图片后跟 *图x-x* 斜体段 → 并入 caption，删除该段
  const topIds = conv.first_level_block_ids;
  for (let i = 0; i < topIds.length - 1; i++) {
    const cur = byId.get(topIds[i]), nxt = byId.get(topIds[i + 1]);
    if (cur?.block_type !== 27 || nxt?.block_type !== 2) continue;
    const p = payloadOf(nxt);
    if (!p?.elements?.length || !p.elements.every(e => e.text_run?.text_element_style?.italic)) continue;
    const text = p.elements.map(e => e.text_run?.content ?? '').join('').trim();
    if (!/^图[\d\-—.]*/.test(text)) continue;
    (cur.image ??= {}).caption = { content: text };
    dropIds.add(topIds[i + 1]);
  }

  return {
    first_level_block_ids: topIds.filter(id => !dropIds.has(id)),
    descendants: [...ordered, ...newBlocks].filter(b => !dropIds.has(b.block_id)),
  };
}

// ---------- 命令 ----------
const [cmd, ...a] = process.argv.slice(2);

if (cmd === 'token') {
  console.log(await tat());
} else if (cmd === 'wiki-node') {
  const d = await api('GET', `/wiki/v2/spaces/get_node?token=${a[0]}`);
  console.log(JSON.stringify(d.node, null, 2));
} else if (cmd === 'create') {
  const d = await api('POST', '/docx/v1/documents', { title: a[0] ?? 'API 测试文档' });
  console.log(JSON.stringify(d.document, null, 2));
} else if (cmd === 'blocks') {
  const docId = a[0];
  let pageToken, items = [];
  do {
    const d = await api('GET', `/docx/v1/documents/${docId}/blocks?page_size=500&document_revision_id=-1${pageToken ? `&page_token=${pageToken}` : ''}`);
    items.push(...d.items); pageToken = d.has_more ? d.page_token : null;
  } while (pageToken);
  for (const b of items) {
    const payload = Object.values(b).find(v => v && typeof v === 'object' && Array.isArray(v.elements)) ?? { elements: [] };
    const txt = payload.elements.map(e => e.text_run?.content ?? e.mention_doc?.title ?? '').join('');
    console.log(`${b.block_id}\ttype=${b.block_type}\tparent=${b.parent_id}\t${txt.slice(0, 60)}`);
  }
} else if (cmd === 'convert') {
  const content = fs.readFileSync(a[0], 'utf8');
  const d = await api('POST', '/docx/v1/documents/blocks/convert', { content_type: 'markdown', content });
  console.log(JSON.stringify(d, null, 2));
} else if (cmd === 'insert-md') {
  const [docId, parentId, index, mdFile] = a;
  const md = fs.readFileSync(mdFile, 'utf8');
  const imgSpecs = mdImages(md);
  // 本地路径换成占位 URL，保证 convert 必然产出图片块（真实图片由本地上传回填）
  const mdForConvert = md.replace(/(!\[[^\]]*\]\()\s*[^\s)]+((?:\s+"[^"]*")?\s*\))/g, '$1https://placeholder.local/i$2');
  const conv = await api('POST', '/docx/v1/documents/blocks/convert', { content_type: 'markdown', content: mdForConvert });
  const { first_level_block_ids, descendants } = transformBlocks(conv, md);
  await sleep(400);
  const ins = await api('POST', `/docx/v1/documents/${docId}/blocks/${parentId}/descendant`,
    { children_id: first_level_block_ids, descendants, index: Number(index) });
  // temp_id → 真实 block_id
  const relMap = new Map((ins.block_id_relations ?? []).map(r => [r.temporary_block_id, r.block_id]));
  const created = descendants.filter(b => b.block_type === 27)
    .map(b => relMap.get(b.block_id) ?? b.block_id);
  if (created.length !== imgSpecs.length)
    console.warn(`警告：图片块数(${created.length})与 markdown 图片数(${imgSpecs.length})不一致，按序回填可能错位`);
  console.log(`插入完成: first_level=${ins.children.length} blocks, 图片块=${created.length}`);
  const dir = path.dirname(path.resolve(mdFile));
  for (let i = 0; i < created.length; i++) {
    const spec = imgSpecs[i];
    if (!spec) { console.warn(`图片块 ${created[i]} 无对应 src，跳过`); continue; }
    const fp = path.isAbsolute(spec.src) ? spec.src : path.join(dir, spec.src);
    if (!fs.existsSync(fp)) { console.warn(`找不到图片文件 ${fp}，块 ${created[i]} 留空`); continue; }
    await uploadIntoBlock(docId, created[i], fp);
  }
} else if (cmd === 'insert-image') {
  const [docId, parentId, index, file] = a;
  const r = await api('POST', `/docx/v1/documents/${docId}/blocks/${parentId}/children`,
    { children: [{ block_type: 27, image: {} }], index: Number(index) });
  const bid = r.children[0].block_id;
  console.log(`图片块已建: ${bid}`);
  await uploadIntoBlock(docId, bid, file);
} else if (cmd === 'upload-image') {
  await uploadIntoBlock(a[0], a[1], a[2]);
} else if (cmd === 'insert-text') {
  const [docId, parentId, index, content] = a;
  const r = await api('POST', `/docx/v1/documents/${docId}/blocks/${parentId}/children`,
    { children: [{ block_type: 2, text: { elements: [{ text_run: { content } }] } }], index: Number(index) });
  console.log(`文本块已插: ${r.children[0].block_id}`);
} else if (cmd === 'set-text') {
  const [docId, blockId, content] = a;
  const r = await api('PATCH', `/docx/v1/documents/${docId}/blocks/${blockId}`,
    { update_text_elements: { elements: [{ text_run: { content } }] } });
  console.log(JSON.stringify(r));
} else if (cmd === 'delete-children') {
  const [docId, parentId, s, e] = a;
  const r = await api('DELETE', `/docx/v1/documents/${docId}/blocks/${parentId}/children/batch_delete`,
    { start_index: Number(s), end_index: Number(e) });
  console.log(JSON.stringify(r));
} else {
  console.log(`未知命令 ${cmd}\n` + fs.readFileSync(new URL(import.meta.url).pathname, 'utf8').split('\n').slice(0, 30).join('\n'));
}

async function uploadIntoBlock(docId, blockId, file) {
  await sleep(400); // 文档级编辑频控 3/s
  const size = fs.statSync(file).size;
  const form = new FormData();
  form.append('file_name', path.basename(file));
  form.append('parent_type', 'docx_image');
  form.append('parent_node', blockId);
  form.append('size', String(size));
  form.append('extra', JSON.stringify({ drive_route_token: docId }));
  form.append('file', new Blob([fs.readFileSync(file)]), path.basename(file));
  const t = await tat();
  const up = await fetch(`${API}/drive/v1/medias/upload_all`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}` }, body: form,
  }).then(r => r.json());
  if (up.code !== 0) die(`上传图片失败 ${file}: ${JSON.stringify(up)}`);
  const dims = imageSize(file);
  await sleep(400);
  await api('PATCH', `/docx/v1/documents/${docId}/blocks/${blockId}`,
    { replace_image: { token: up.data.file_token, ...dims } });
  console.log(`图片已回填: block=${blockId} token=${up.data.file_token} ${dims.width ?? '?'}x${dims.height ?? '?'}`);
}
