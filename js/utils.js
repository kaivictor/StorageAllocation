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
/* 路径输入框的“静态显示值”（不含父前缀）：叶子取裸文件名；文件夹取去掉父级完整前缀后的相对段。
   与 pathNodeHTML 的显示一致，供失焦复位使用，避免保留完整路径导致与悬停前缀重复。 */
function pathDisplayValue(p) {
  if (!p) return '';
  if (!p.text.endsWith('/')) {                 // 叶子：裸文件名
    const cleaned = p.text.replace(/\/+$/, '');
    return cleaned.split('/').pop() || p.text;
  }
  if (p.parent) {
    let pf = fullPathOf(p.parent);
    if (pf && !pf.endsWith('/')) pf += '/';
    if (pf && p.text.startsWith(pf)) return p.text.slice(pf.length);
  }
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
