function addSpace() {
  state.spaces.push({
    id: nid('s'),
    info: { account: '', size: '', free: '', plan: '', unit: '', purpose: '', remark: '' },
    media: { name: '新空间', icon: 'disk0' }
  });
  render();
}
function addData() {
  const pid = nid('p'), rid = nid('r'), prid = nid('pr');
  const path = { id: pid, text: '/新路径/', app: false, parent: null };
  const record = { id: rid, alias: '新数据', freq: '冷数据', size: { value: '', unit: 'GB' }, purpose: '', custom: {}, structure: { name: '根', children: [] } };
  state.paths.push(path);
  state.records.push(record);
  state.pathRecords.push({ id: prid, pathId: pid, recordId: rid });
  lastPathId = pid; lastRecordId = rid;
  pendingFocus = pstr(['records', rid, 'alias']);
  deferArrange = true;
  render();
}

/* 按路径节点渲染中心，计算在点击 y 处插入 state.paths 的下标（扁平列表，精确落点） */
function pathInsertIndex(y) {
  const nodes = Array.from(document.querySelectorAll('.path-node'));
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    if (y < r.top + r.height / 2) {                 // 第一个中心在点击 Y 之下的节点
      const i = state.paths.findIndex(p => p.id === el.dataset.pathId);
      return i < 0 ? state.paths.length : i;        // 插到它之前
    }
  }
  return state.paths.length;                        // 点击在最底部空白：追加到末尾
}
/* 按记录节点渲染中心，计算在点击 y 处插入 state.records 的下标（扁平列表，精确落点） */
function recordInsertIndex(y) {
  const nodes = Array.from(document.querySelectorAll('.alias-node'));
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    if (y < r.top + r.height / 2) {
      const i = state.records.findIndex(r2 => r2.id === el.dataset.recordId);
      return i < 0 ? state.records.length : i;
    }
  }
  return state.records.length;
}

/* 双击“路径”列空白：在点击处新增一条普通路径（parent:null，不缩进）并进入编辑。
   路径列表为扁平列表，故新路径精确落在点击处（顶部/两路径之间/底部）。 */
function addPathAt(y) {
  const id = nid('p');
  const idx = pathInsertIndex(y);
  const path = { id, text: '/新路径/', app: false, parent: null };
  state.paths.splice(idx, 0, path);
  lastPathId = id;
  pendingFocus = pstr(['paths', id, 'text']);
  deferArrange = true;
  render();
}

/* 双击“数据别称/频率/大小/用途”列空白：在点击处新增一条记录（5 字段），
   并把它关联到点击位置最近的路径（建立 路径↔记录 连线），聚焦数据别称。 */
function addRecordAt(y, linkPathId) {
  const rid = nid('r');
  const idx = recordInsertIndex(y);
  const record = { id: rid, alias: '新数据', freq: '冷数据', size: { value: '', unit: 'GB' }, purpose: '', custom: {}, structure: { name: '根', children: [] } };
  state.records.splice(idx, 0, record);
  if (linkPathId) state.pathRecords.push({ id: nid('pr'), pathId: linkPathId, recordId: rid });
  lastRecordId = rid;
  pendingFocus = pstr(['records', rid, 'alias']);
  deferArrange = true;
  render();
}
/* 双击 5 列空白：关联到点击最近的路径 */
function addDataAt(which, y) {
  const pid = nearestPathId(y);
  addRecordAt(y, pid);
}

/* 双击“空间/空间信息”列空白：新增空间并聚焦名称，插入到点击处 */
function addSpaceAt(y) {
  const id = nid('s');
  const sp = { id, info: { account: '', size: '', free: '', plan: '', unit: '', purpose: '', remark: '' }, media: { name: '新空间', icon: 'disk0' } };
  state.spaces.splice(spaceInsertIndex(y), 0, sp);
  pendingFocus = pstr(['spaces', id, 'media', 'name']);
  deferArrange = true;
  render();
}
function spaceInsertIndex(y) {
  let idx = 0;
  for (let i = 0; i < state.spaces.length; i++) {
    const row = document.querySelector(`.row[data-space-row="${state.spaces[i].id}"]`);
    if (!row) continue;
    const r = row.getBoundingClientRect();
    if (y > r.top + r.height / 2) idx = i + 1;
  }
  return idx;
}

/* 点击路径节点“+”：新增一条记录（5 字段行）并与当前路径建立关联，不新增路径节点 */
function addRecordForPath(pathId) {
  const p = getPath(pathId);
  if (!p) return;
  const rid = nid('r');
  const record = { id: rid, alias: '新数据', freq: '冷数据', size: { value: '', unit: 'GB' }, purpose: '', custom: {}, structure: { name: '根', children: [] } };
  state.records.push(record);
  state.pathRecords.push({ id: nid('pr'), pathId, recordId: rid });
  lastRecordId = rid; lastPathId = pathId;
  pendingFocus = pstr(['records', rid, 'alias']);
  deferArrange = true;
  render();
}

/* 新增用户自定义属性：在指定固定列之后插入一列，所有记录获得对应空白值，并聚焦属性名输入框 */
function addCustomAttr(afterRef) {
  const id = nid('ca');
  /* afterRef 为组键（alias/freq/size）→ 插入该组开头；为某自定义列 id → 插入该列之后 */
  const group = ['alias', 'freq', 'size'].includes(afterRef)
    ? afterRef
    : (state.customAttrs.find(x => x.id === afterRef) || {}).after || 'alias';
  const obj = { id, name: '自定义属性', after: group, align: 'center' };
  if (['alias', 'freq', 'size'].includes(afterRef)) {
    const i = state.customAttrs.findIndex(x => x.after === group);   // 紧挨基础列（组首）
    if (i === -1) state.customAttrs.push(obj); else state.customAttrs.splice(i, 0, obj);
  } else {
    const i = state.customAttrs.findIndex(x => x.id === afterRef);   // 指定自定义列之后
    if (i === -1) state.customAttrs.push(obj); else state.customAttrs.splice(i + 1, 0, obj);
  }
  for (const r of state.records) { (r.custom = r.custom || {})[id] = ''; }
  pendingFocus = pstr(['customAttrs', id, 'name']);
  render();
}
/* 设置用户自定义属性列的对齐方式（左/中/右），应用于列头与值单元格 */
function setCustomAttrAlign(id, align) {
  const a = state.customAttrs.find(x => x.id === id);
  if (a) { a.align = align; render(); }
}
/* 删除用户自定义属性：移除列定义，并清理所有记录上的对应值 */
function deleteCustomAttr(id) {
  state.customAttrs = state.customAttrs.filter(a => a.id !== id);
  for (const r of state.records) { if (r.custom) delete r.custom[id]; }
  render();
}

/* 点击位置最近的路径 id（用于 5 列双击关联到路径） */
function nearestPathId(y) {
  let best = null, bestD = Infinity;
  document.querySelectorAll('.path-node').forEach(el => {
    const r = el.getBoundingClientRect();
    const d = Math.abs((r.top + r.height / 2) - y);
    if (d < bestD) { bestD = d; best = el.dataset.pathId; }
  });
  return best;
}

function exportData() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  /* 导出时间后缀（用 _ 连接；时间部分用 - 而非 :，避免 Windows 文件名非法字符） */
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `storage-allocation_${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
/* 清空所有数据（破坏性）：清空空间/路径/记录/连线/路径-记录，保留 UI 配置（自定义列、图标、列宽）。
   调用前需经确认（见 events.js 绑定），清空后落盘并重渲染。 */
function clearData() {
  state.spaces.length = 0;
  state.paths.length = 0;
  state.records.length = 0;
  state.connections.length = 0;
  state.pathRecords.length = 0;
  saveState();
  render();
}
function importData(e) {
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(reader.result);
      if (obj.spaces && obj.paths && obj.records && obj.connections && obj.pathRecords) {
        Object.assign(state, obj);
        let max = uid;
        for (const o of [].concat(state.spaces, state.paths, state.records, state.connections, state.pathRecords)) {
          const m = /^([a-z]+)(\d+)$/.exec(o.id || '');
          if (m) max = Math.max(max, +m[2]);
        }
        uid = Math.max(uid, max);   // 同步计数器，避免导入后新增 id 冲突
        render();
      } else alert('文件格式不正确（需要含 spaces/paths/records/connections/pathRecords）');
    } catch (err) { alert('解析失败：' + err.message); }
  };
  reader.readAsText(f);
  e.target.value = '';
}
