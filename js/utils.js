function getByPath(arr) {
  let o = state;
  for (const k of arr) { o = stepInto(o, k); if (o == null) return undefined; }
  return o;
}
function setByPath(arr, val) {
  let o = state;
  for (let i = 0; i < arr.length - 1; i++) { o = stepInto(o, arr[i]); if (o == null) return; }
  o[arr[arr.length - 1]] = val;
}
/* state.spaces / state.paths / state.records 均为数组，路径/记录以字符串 id 寻址；
   此处按 id 解析数组项 */
function stepInto(o, k) {
  if (o == null) return undefined;
  if (Array.isArray(o) && typeof k !== 'number') return o.find(x => x && x.id === k);
  return o[k];
}
function pstr(arr) { return JSON.stringify(arr); }
function parr(s) { return JSON.parse(s); }

/* ---------- 路径 / 记录 便捷查询 ---------- */
function getPath(pid) { return state.paths.find(p => p.id === pid); }
function getRecord(rid) { return state.records.find(r => r.id === rid); }
/* 路径输入框进入编辑态时，把内容切换为“完整路径”（覆盖静态显示的“父前缀 + 相对名”）；
   静态显示保持不变，仅编辑时可见完整路径。仅对 .path-input 生效。 */
function enterPathEdit(el) {
  if (!el || el.tagName !== 'INPUT' || !el.classList.contains('path-input')) return;
  const arr = el.dataset.path ? parr(el.dataset.path) : null;
  const p = arr && arr[0] === 'paths' ? getPath(arr[1]) : null;
  if (p && el.value !== p.text) { el.value = p.text; if (el.select) { try { el.select(); } catch (e) {} } }
  const node = el.closest('.path-node');   // 标记编辑态：隐藏父级前缀，避免与完整路径重复
  if (node) node.classList.add('editing');
}
/* 计算路径应折叠隐藏的“父级前缀”：仅当 state.paths 中存在另一条路径，其文本恰为该路径的
   合法父级时才返回该前缀（规范化为以 '/' 结尾）；否则返回 ''（显示完整路径）。
   规则：前缀不等于任何“其他路径”时不隐藏前缀——
   · 文件夹（以 '/' 结尾）：最长合法“/”前缀路径。例：只有 /test1/test2/ 而无 /test1/ → 显示完整；
     有 /test1/ 则折叠为 test2/。
   · 叶子文件（不以 '/' 结尾）：最后一个 '/' 之前的目录段为前缀。例：/test1/obsidian 有 /test1/ →
     显示 obsidian；无 /test1/ → 显示完整 /test1/obsidian（不剥成 basename）。 */
function parentPrefixOf(p) {
  if (!p) return '';
  const text = p.text;
  if (text.endsWith('/')) {
    /* 文件夹：最长合法“/”前缀路径 */
    let best = '', bestLen = -1;
    for (const q of state.paths) {
      if (q.id === p.id) continue;
      let qt = q.text;
      if (!qt.endsWith('/')) qt += '/';
      if (text.startsWith(qt) && qt.length < text.length && qt.length > bestLen) { best = qt; bestLen = qt.length; }
    }
    return best;
  }
  /* 叶子（文件）：目录前缀 = 最后一个 '/' 之前（含）的部分；恰为某条存在的路径（或其最长前缀）才隐藏 */
  const i = text.lastIndexOf('/');
  if (i <= 0) return '';                       // 无目录（如 obsidian）→ 不隐藏
  const dir = text.slice(0, i + 1);            // '/test1/'
  let best = '', bestLen = -1;
  for (const q of state.paths) {
    if (q.id === p.id) continue;
    let qt = q.text;
    if (!qt.endsWith('/')) qt += '/';
    if (dir.startsWith(qt) && qt.length <= dir.length && qt.length > bestLen) { best = qt; bestLen = qt.length; }
  }
  return best;
}
/* 路径输入框的“静态显示值”（不含父前缀）：与 pathNodeHTML 显示一致，供失焦复位使用 */
function pathDisplayValue(p) {
  if (!p) return '';
  const pf = parentPrefixOf(p);
  if (pf && p.text.startsWith(pf)) return p.text.slice(pf.length);
  return p.text;
}
/* 某记录关联的全部路径 id（多对多） */
function recordPathIds(rid) { return state.pathRecords.filter(pr => pr.recordId === rid).map(pr => pr.pathId); }
/* 某路径关联的全部记录 id（多对多） */
function pathRecordIds(pid) { return state.pathRecords.filter(pr => pr.pathId === pid).map(pr => pr.recordId); }

/* 子路径先序遍历（父节点必在其子树之前）；用于保持树结构的有效顺序 */
/* 路径扁平重排：把单个路径 pid 移动到 beforePid 之前（null=末尾），仅调整 state.paths 顺序。
   不再有“数据”包裹，跨父子自由排序。 */
function reorderPathFlat(pid, beforePid) {
  const order = state.paths.map(p => p.id);
  const without = order.filter(k => k !== pid);
  let idx = beforePid == null ? without.length : without.indexOf(beforePid);
  if (idx < 0) idx = without.length;
  without.splice(idx, 0, pid);
  state.paths = without.map(id => state.paths.find(p => p.id === id));
}

/* 把单个路径 pid 的 parent 上提到 newParent（或 null）；子路径的 parent 跟随改写 */
function setPathParent(pid, newParent) {
  const p = getPath(pid);
  if (!p) return;
  p.parent = newParent || null;
}

/* 按文本前缀自动识别父子：若某条（更短）路径文本是当前路径文本的前缀，则设为 parent，取最长匹配 */
function autoParent(pid) {
  const p = getPath(pid);
  if (!p) return;
  const text = p.text;
  let best = null, bestLen = -1;
  for (const q of state.paths) {
    if (q.id === pid) continue;
    const t = q.text;
    if (text.startsWith(t) && t.length < text.length && t.length > bestLen) { best = q.id; bestLen = t.length; }
  }
  p.parent = best;
}
/* 重新识别全部路径的父子关系：用于从持久化/导入数据载入后，纠正可能陈旧的 parent 字段。
   否则依赖 parent 的缩进（depth）、子→父连线、强调中立判定都会与“按文本前缀实时推导”的
   显示前缀不一致（如同级文件夹与叶子缩进不同）。 */
function recomputeParents() {
  for (const p of state.paths) autoParent(p.id);
}

const statusClass = (st) => ({
  '正常': 'link-normal', '待备份': 'link-pending',
  '迁移出': 'link-move-out', '迁移进': 'link-move-in'
}[st] || 'link-normal');

/* ============================================================
 * 渲染
 * ============================================================ */
let pendingFocus = null;   // 新增后自动聚焦的字段选择器（进入编辑模式）
let lastDataId = null;     // 最近编辑的路径/记录（结构“+”定位用，新模型下为 pathId 或 recordId，保留兼容）
let lastPathId = null;     // 最近编辑的路径 id
let lastRecordId = null;   // 最近编辑的记录 id（结构“+”定位用）
let deferArrange = false;  // 新增后（本次渲染）暂不重排：仅展示+聚焦，焦点离开后再排
