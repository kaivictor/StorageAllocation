/* ============================================================
 * 空间分配面板  app.js
 * 数据驱动渲染：HTML / CSS / JS 三分离
 *
 * 领域模型（路径为第一公民，无“数据”包裹单位）：
 *   spaces     空间（带空间信息）
 *   paths      路径（文本 / app / parent 父子层级）；路径列扁平列表
 *   records    数据记录（数据别称/频率/估计大小/用途/结构）；5 列扁平列表
 *   connections 空间 ↔ 路径（多对多），用 spaceId + pathId 寻址
 *   pathRecords 路径 ↔ 记录（多对多），用 pathId + recordId 寻址
 * ============================================================ */

/* ---------- 默认图标（来自 assets/*.svg，内联以便离线使用） ---------- */
const DEFAULT_ICONS = {
  disk0: `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
    <path d="M814.5 604.6h-605c-12.9 0-23.3 10.4-23.3 23.3v128.5c0 38.5 31.4 69.8 69.8 69.8h512c38.3 0 69.8-30.7 69.8-69.8V627.9c0-12.9-10.4-23.3-23.3-23.3z m-23.2 151.8c0 13.1-10.4 23.3-23.3 23.3H256c-12.7 0-23.3-10.5-23.3-23.3V651.2h558.5v105.2z"/>
    <path d="M458.5 733.1h107.1c12.9 0 23.3-10.4 23.3-23.3s-10.4-23.3-23.3-23.3H458.5c-12.9 0-23.3 10.4-23.3 23.3s10.4 23.3 23.3 23.3zM829.5 357.3c-0.4-1.4-0.9-2.7-1.5-4.1l-69.8-142.4c-3.9-8-12-13-20.9-13H286.7c-8.9 0-17 5.1-20.9 13L196 353.3c-0.7 1.3-1.2 2.7-1.6 4.1-5.2 7.5-8.3 16.7-8.3 26.6v155.9c0 12.9 10.4 23.3 23.3 23.3h605.1c12.9 0 23.3-10.4 23.3-23.3V384c0-10-3-19.1-8.3-26.7zM301.2 244.4h421.5l45.6 93.1H255.6l45.6-93.1z m490.1 272.3H232.7V384h558.5v132.7z"/>
    <path d="M458.5 477.1h107.1c12.9 0 23.3-10.4 23.3-23.3s-10.4-23.3-23.3-23.3H458.5c-12.9 0-23.3 10.4-23.3 23.3s10.4 23.3 23.3 23.3z"/></svg>`,
  disk1: `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
    <path d="M998.4 711.68l-119.467-512c-6.826-42.667-42.666-75.093-87.04-76.8H232.107c-44.374 1.707-80.214 35.84-87.04 78.507L25.6 711.68c-5.12 13.653-6.827 29.013-6.827 42.667 0 76.8 63.147 139.946 141.654 139.946H865.28c78.507 0 141.653-63.146 141.653-139.946 0-13.654-3.413-29.014-8.533-42.667zM394.24 366.933c1.707-51.2 56.32-92.16 124.587-92.16S640 315.733 640 365.227c44.373-1.707 81.92 23.893 83.627 58.026s-34.134 63.147-78.507 64.854h-6.827l-245.76 1.706c-44.373 0-80.213-27.306-80.213-59.733 0-35.84 37.547-63.147 81.92-63.147z m471.04 459.094H160.427c-39.254 0-69.974-30.72-69.974-69.974s32.427-69.973 69.974-69.973H865.28c39.253 0 69.973 30.72 69.973 69.973 1.707 37.547-30.72 69.974-69.973 69.974z m-35.84-92.16c-11.947 0-22.187 8.533-23.893 20.48 0 11.946 8.533 22.186 20.48 23.893h3.413c11.947 0 22.187-10.24 22.187-22.187 0-13.653-8.534-22.186-22.187-22.186z m-46.08 22.186c0-25.6 20.48-46.08 46.08-46.08s46.08 20.48 46.08 46.08-20.48 46.08-46.08 46.08-46.08-20.48-46.08-46.08z" fill="#8a8a8a"/></svg>`
};

/* ---------- 状态（含示例数据） ---------- */
let uid = 100;
const nid = (p) => p + (++uid);

const state = {
  /* 锁定开关：true=锁定（双击编辑 / 单击复制）；false=解锁（单击即编辑 / 无复制）。持久化。 */
  locked: true,
  /* 用户导入的自定义图标（base64 dataURL），置于图标选择菜单最前 */
  customIcons: [],
  /* 用户自定义属性列定义：{ id, name, after }；after ∈ {alias, freq, size}，表示插在该固定列之后 */
  customAttrs: [],
  /* 固定列宽：键为列标识（alias/freq/size 及自定义属性 id），值为像素；未设置则该列走自适应宽度 */
  laneWidths: {},
  spaces: [
    { id: 's1', info: { account: 'ACC123456', size: '512', free: '128', plan: 'Pro', unit: 'GB', purpose: '工作资料', remark: '主力固态盘' },
      media: { name: 'SSD 主盘', icon: 'disk0' } },
    { id: 's2', info: { account: 'SN9876543210', size: '2048', free: '640', plan: '企业版', unit: 'GB', purpose: '冷备份', remark: '归档机械盘' },
      media: { name: 'HDD 备份', icon: 'disk1' } },
    { id: 's3', info: { account: 'webdav_user', size: '-', free: '-', plan: 'WebDAV', unit: 'GB', purpose: '同步盘', remark: '不计空间' },
      media: { name: '网盘同步', icon: 'disk1' } }
  ],
  /* 路径：扁平列表，每条路径独立。parent 指向另一条路径（子文件夹），形成层级 */
  paths: [
    { id: 'p1', text: '/测试文件夹/', app: false, parent: null },
    { id: 'p2', text: '/子文件夹/', app: false, parent: 'p1' },
    { id: 'p3', text: '/test/', app: false, parent: null },
    { id: 'p4', text: '/case/', app: false, parent: null },
    { id: 'p5', text: 'obsidian', app: true, parent: null }
  ],
  /* 数据记录（5 列）：扁平列表，每条记录独立拥有 别称/频率/大小/用途/结构 */
  records: [
    { id: 'r1', alias: '测试', freq: '冷数据', size: { value: '10', unit: 'GB' }, purpose: '源代码与文档', custom: {},
      structure: { name: '项目根', children: [ { name: 'src', children: [ { name: 'main.js' }, { name: 'utils' } ] }, { name: 'docs' } ] } },
    { id: 'r2', alias: '开发', freq: '热数据', size: { value: '2', unit: 'GB' }, purpose: '子模块开发', custom: {},
      structure: { name: '子模块', children: [ { name: 'lib' }, { name: 'tests' } ] } },
    { id: 'r5', alias: 'obsidian', freq: '实时', size: { value: '', unit: 'GB' }, purpose: '笔记', custom: {},
      structure: { name: 'vault', children: [ { name: '日记' }, { name: '知识库' } ] } },
    { id: 'r6', alias: '案例库', freq: '温数据', size: { value: '25', unit: 'GB' }, purpose: '案例素材归档', custom: {},
      structure: { name: 'case', children: [ { name: '素材' }, { name: '成品' } ] } }
  ],
  /* 空间 ↔ 路径（多对多）：每条连接精确到一个路径 */
  connections: [
    { id: 'c1', spaceId: 's1', pathId: 'p1', status: '正常', method: 's3', account: 'key1', password: '***', port: '443', backup: '完全同步' },
    { id: 'c2', spaceId: 's2', pathId: 'p1', status: '待备份', method: '', account: '', password: '', port: '', backup: '复制' },
    { id: 'c3', spaceId: 's3', pathId: 'p4', status: '迁移进', method: 'webdav', account: 'webdav_user', password: 'pw', port: '5005', backup: '增量' },
    { id: 'c4', spaceId: 's1', pathId: 'p5', status: '正常', method: '', account: '', password: '', port: '', backup: '移动' },
    { id: 'c5', spaceId: 's2', pathId: 'p2', status: '待备份', method: '', account: '', password: '', port: '', backup: '复制' }
  ],
  /* 路径 ↔ 记录（多对多）：一条记录可被多条路径关联，一条路径可关联多条记录。
     示例：记录“测试”(r1) 关联 p1 / p3；/case/(p4) 单独关联“案例库”(r6)，拥有不同的数据别称 */
  pathRecords: [
    { id: 'pr1', pathId: 'p1', recordId: 'r1' },
    { id: 'pr3', pathId: 'p3', recordId: 'r1' },
    { id: 'pr4', pathId: 'p4', recordId: 'r6' },
    { id: 'pr2', pathId: 'p2', recordId: 'r2' },
    { id: 'pr5', pathId: 'p5', recordId: 'r5' }
  ]
};

/* ---------- 工具 ---------- */
const $ = (s, r = document) => r.querySelector(s);
const SVGNS = 'http://www.w3.org/2000/svg';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- 本地持久化（localStorage） ---------- */
const STORAGE_KEY = 'storage-allocation:v1';
function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { /* 忽略写入失败（如隐私模式 / 配额超限） */ }
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    if (obj && obj.spaces && obj.paths && obj.records && obj.connections && obj.pathRecords) {
      Object.assign(state, obj);
      /* 同步 uid 计数器：取已存 id 中最大数字，避免后续新增 id 与之冲突（id 形如 s1/p1/r1/c101/pr5） */
      let max = uid;
      for (const o of [].concat(state.spaces, state.paths, state.records, state.connections, state.pathRecords)) {
        const m = /^([a-z]+)(\d+)$/.exec(o.id || '');
        if (m) max = Math.max(max, +m[2]);
      }
      uid = Math.max(uid, max);
      return true;
    }
  } catch (e) { /* 解析失败则回退到默认示例数据 */ }
  return false;
}
