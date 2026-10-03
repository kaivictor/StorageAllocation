function layerRect() { return linkLayer.getBoundingClientRect(); }
function rightOf(el) { const r = el.getBoundingClientRect(), lr = layerRect(); return { x: r.right - lr.left, y: r.top + r.height / 2 - lr.top }; }
function leftOf(el) { const r = el.getBoundingClientRect(), lr = layerRect(); return { x: r.left - lr.left, y: r.top + r.height / 2 - lr.top }; }
function centerOf(el) { const r = el.getBoundingClientRect(), lr = layerRect(); return { x: r.left + r.width / 2 - lr.left, y: r.top + r.height / 2 - lr.top }; }

function curve(a, b) {
  const dir = b.x >= a.x ? 1 : -1;          // 让控制点始终朝向终点方向，避免反向时外凸成锯齿
  const dx = Math.max(20, Math.abs(b.x - a.x) * 0.5); // 控制柄为半程，汇聚于中点，曲线平滑
  return `M ${a.x} ${a.y} C ${a.x + dir * dx} ${a.y}, ${b.x - dir * dx} ${b.y}, ${b.x} ${b.y}`;
}

function drawConnections() {
  linkLayer.innerHTML = '';

  /* 子→父连线箭头标记（每次重绘重建 defs；箭头落在父端，表示“子文件夹 → 父文件夹”方向） */
  const defs = document.createElementNS(SVGNS, 'defs');
  const marker = document.createElementNS(SVGNS, 'marker');
  marker.setAttribute('id', 'arrow-sub');
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '9');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '9');
  marker.setAttribute('markerHeight', '9');
  marker.setAttribute('markerUnits', 'userSpaceOnUse');
  marker.setAttribute('orient', 'auto');
  const tri = document.createElementNS(SVGNS, 'path');
  tri.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
  marker.appendChild(tri);
  defs.appendChild(marker);
  linkLayer.appendChild(defs);

  /* 1) 空间 ↔ 路径（多对多）：每条连接精确到一个路径节点（dataId 现即 pathId） */
  for (const c of state.connections) {
    const sEl = panel.querySelector(`.space-node[data-space-id="${c.spaceId}"] .space-anchor`);
    const pAnchor = panel.querySelector(`.path-node[data-path-id="${c.pathId}"] .path-anchor`);
    if (!sEl || !pAnchor) continue;
    const a = rightOf(sEl), b = leftOf(pAnchor);
    const d = curve(a, b);

    const g = document.createElementNS(SVGNS, 'g');
    g.classList.add('conn');
    g.dataset.connId = c.id;

    const hit = document.createElementNS(SVGNS, 'path');
    hit.setAttribute('d', d); hit.setAttribute('class', 'link-hit');

    const vis = document.createElementNS(SVGNS, 'path');
    vis.setAttribute('d', d); vis.setAttribute('class', 'link ' + statusClass(c.status));

    g.appendChild(hit); g.appendChild(vis);

    const stText = document.createElementNS(SVGNS, 'text');
    stText.setAttribute('x', (a.x + b.x) / 2); stText.setAttribute('y', (a.y + b.y) / 2 - 6);
    stText.setAttribute('class', 'link-label'); stText.setAttribute('text-anchor', 'middle');
    stText.textContent = c.status || '正常';
    g.appendChild(stText);

    g.addEventListener('mouseenter', () => {
      if (reorder || drag) return;
      if (Date.now() < connGuardUntil && activeConnId !== c.id) return;
      cancelConnEditorHide();
      emphasize(new Set([c.spaceId]), new Set([c.pathId]));
      g.classList.add('active', 'hover');
    });
    const openConn = () => {
      if (reorder || drag) return;
      cancelConnEditorHide();
      emphasize(new Set([c.spaceId]), new Set([c.pathId]));
      g.classList.add('active', 'hover', 'open');
      showConnEditor(c, vis);
    };
    /* 连线打开编辑器：锁定态双击、解锁态单击（与全局锁模式一致） */
    g.addEventListener('click', () => { if (!state.locked) openConn(); });
    g.addEventListener('dblclick', openConn);
    g.addEventListener('mouseleave', () => {
      if (reorder || drag) return;
      if (activeConnId === c.id) {
        connGuardUntil = Date.now() + 500;
        scheduleConnEditorHide();
      } else {
        clearEmph();
        g.classList.remove('active', 'hover');
      }
    });
    linkLayer.appendChild(g);
  }

  /* 2) 记录 → 多条路径（扇出连线：每条 pathRecord 一条连线，体现 路径↔记录 多对多）。
     每条连线包在 <g class="fan-group" data-pr-id> 内，含透明命中区（可右击/点击）与可见线，
     以便“删除关联（路径↔数据别称）”的右键菜单能精确删除某一条关联。 */
  for (const pr of state.pathRecords) {
    const srcEl = panel.querySelector(`.alias-node[data-record-id="${pr.recordId}"]`);
    if (!srcEl) continue;
    const pEl = panel.querySelector(`.path-node[data-path-id="${pr.pathId}"]`);
    if (!pEl) continue;
    const a = leftOf(srcEl), b = rightOf(pEl);
    const d = curve(a, b);
    const g = document.createElementNS(SVGNS, 'g');
    g.classList.add('fan-group');
    g.dataset.prId = pr.id;
    const hit = document.createElementNS(SVGNS, 'path');
    hit.setAttribute('d', d); hit.setAttribute('class', 'link-hit');
    const vis = document.createElementNS(SVGNS, 'path');
    vis.setAttribute('d', d); vis.setAttribute('class', 'link-fan');
    g.appendChild(hit); g.appendChild(vis);
    g.addEventListener('mouseenter', () => { if (reorder || drag) return; g.classList.add('hover'); });
    g.addEventListener('mouseleave', () => g.classList.remove('hover'));
    linkLayer.appendChild(g);
  }

  /* 3) 子文件夹 → 父文件夹（贝塞尔，从子文件夹“后部”指向父路径；同一层级内子项关系） */
  for (const p of state.paths) {
    if (!p.parent) continue;
    const child = panel.querySelector(`.path-node[data-path-id="${p.id}"]`);
    const parent = panel.querySelector(`.path-node[data-path-id="${p.parent}"]`);
    if (!child || !parent) continue;
    const a = rightOf(child), b = rightOf(parent);
    const mx = Math.max(a.x, b.x) + 32;
    const path = document.createElementNS(SVGNS, 'path');
    path.setAttribute('d', `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`);
    path.setAttribute('class', 'link-sub');
    path.setAttribute('marker-end', 'url(#arrow-sub)');
    linkLayer.appendChild(path);
  }
}

/* ---------- 结构树连线：上下级节点之间曲线连接 ----------
   根（用途列中的 用途 attr-node）与其在“结构”列的二级子节点之间，
   以及任意父节点与其子节点之间，均用曲线连接（与空间↔路径连线同一套曲线）。 */
function drawStructLinks() {
  const canvas = $('#right-canvas');
  if (!canvas) return;
  const prev = linkLayer.querySelector('.struct-links');
  if (prev) prev.remove();          // 重绘前清除旧组，保证可反复调用（拖拽实时重绘时不叠加重复连线）
  const g = document.createElementNS(SVGNS, 'g');
  g.classList.add('struct-links');
  for (const r of state.records) {
    const root = canvas.querySelector(`.lane-purpose .attr-node[data-record-id="${cssAttr(r.id)}"]`);
    const container = canvas.querySelector(`.lane-structure .attr-node[data-record-id="${cssAttr(r.id)}"] > .struct-children`);
    if (root && container) drawStructConnector(g, root, container);
  }
  linkLayer.appendChild(g);
}
function drawStructConnector(g, parentEl, container) {
  container.querySelectorAll(':scope > .struct-tree').forEach(tree => {
    const cn = tree.querySelector(':scope > .struct-node');
    if (!cn) return;
    const path = document.createElementNS(SVGNS, 'path');
    path.setAttribute('d', curve(rightOf(parentEl), leftOf(cn)));
    path.setAttribute('class', 'link-struct');
    g.appendChild(path);
    const sub = tree.querySelector(':scope > .struct-children');
    if (sub) drawStructConnector(g, cn, sub);
  });
}

/* ============================================================
 * 强调 / 弱化（以 pathId 为路径粒度，以 recordId 为记录粒度）
 * ============================================================ */
function emphasize(directSpaces, directPaths, directRecords = new Set()) {
  const neutralPaths = new Set();
  for (const pid of directPaths) {
    const p = getPath(pid);
    if (!p) continue;
    if (p.parent && getPath(p.parent)) neutralPaths.add(p.parent);             // 父文件夹
    for (const q of state.paths) if (q.parent === pid) neutralPaths.add(q.id); // 子文件夹
  }
  /* 关联了“直接/中立路径”的记录，或被直接 hover 的记录：保持可见（不被弱化） */
  const relRecords = new Set();
  for (const pr of state.pathRecords) {
    if (directPaths.has(pr.pathId) || neutralPaths.has(pr.pathId)) relRecords.add(pr.recordId);
  }
  /* 空间：直接相关的整行 active，其余弱化 */
  panel.querySelectorAll('.row[data-space-row]').forEach(n => {
    const id = n.dataset.spaceRow;
    n.classList.toggle('active', directSpaces.has(id));
    n.classList.toggle('faded', !directSpaces.has(id));
  });
  /* 路径节点：直接连线 active；其父/子文件夹中立；其余 faded */
  panel.querySelectorAll('.path-node').forEach(n => {
    const k = n.dataset.pathId;
    const direct = directPaths.has(k);
    const neutral = !direct && neutralPaths.has(k);
    n.classList.toggle('active', direct);
    n.classList.toggle('faded', !direct && !neutral);
  });
  /* 记录节点（别名/频率/大小/用途/结构）：相关记录不弱化，其余 faded（不描边高亮） */
  panel.querySelectorAll('.attr-node[data-record-id]').forEach(n => {
    const rid = n.dataset.recordId;
    const rel = relRecords.has(rid) || directRecords.has(rid);
    n.classList.toggle('faded', !rel);
  });
  /* 记录整体白卡（数据四列背景）：与记录关联判定一致地弱化 */
  panel.querySelectorAll('.rec-frame[data-record-id]').forEach(n => {
    const rid = n.dataset.recordId;
    n.classList.toggle('faded', !(relRecords.has(rid) || directRecords.has(rid)));
  });
  /* 连线：仅“空间与路径两端均直接匹配”的连线高亮，其余弱化 */
  panel.querySelectorAll('.conn[data-conn-id]').forEach(g => {
    const c = state.connections.find(x => x.id === g.dataset.connId);
    if (!c) { g.classList.add('faded'); return; }
    const direct = directSpaces.has(c.spaceId) && directPaths.has(c.pathId);
    g.classList.toggle('active', direct);
    g.classList.toggle('faded', !direct);
  });
}
function clearEmph() {
  panel.querySelectorAll('.faded, .active').forEach(n => n.classList.remove('faded', 'active'));
  hidePathTip();
}
/* 强调某空间（含其空间信息）所直接连线关联的路径，弱化其余 */
function emphasizeSpace(sid) {
  const directPaths = new Set(state.connections.filter(c => c.spaceId === sid).map(c => c.pathId));
  emphasize(new Set([sid]), directPaths);
}
/* 子文件夹完整路径：规范化返回“/父/子/”形式。
   文本本身已是绝对路径（以 '/' 开头）时直接规范化即可，切勿再沿父链拼接 leaf，
   否则会把已是完整的父前缀重复拼上（如 B=/test1/test2/ 算成 /test1/test1/test2/）。
   仅当文本为相对片段（不以 '/' 开头，理论上不会发生）才沿父链兜底拼接。 */
function fullPathOf(pid) {
  const p = getPath(pid);
  if (!p) return '';
  const t = p.text || '';
  if (t.startsWith('/')) return t.replace(/\/+$/, '') + '/';
  if (!p.parent) return t.replace(/\/+$/, '') + '/';
  const parentPath = (fullPathOf(p.parent) || '').replace(/\/+$/, '');
  const leaf = t.replace(/^\/+/, '').replace(/\/+$/, '');
  return parentPath + '/' + leaf + '/';
}
/* 连线即时编辑面板 */
let connEditorEl = null, connEditorTimer = null;
let activeConnId = null;        // 当前面板所属的连线
let connGuardUntil = 0;         // 离开线后的 0.5s 内忽略其他连线
function connEditorFields(c) {
  const opt = (vals, sel) => vals.map(v => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const statusOpts = opt(['正常', '待备份', '迁移出', '迁移进'], c.status);
  const backupOpts = opt(['复制', '增量', '移动', '完全同步'], c.backup);
  return `
    <div class="ce-head">连接属性</div>
    <div class="ce-row"><label>状态</label><select data-cap="status">${statusOpts}</select></div>
    <div class="ce-row"><label>连接方式</label><input data-cap="method" value="${esc(c.method || '')}" placeholder="—"></div>
    <div class="ce-row"><label>账号</label><input data-cap="account" value="${esc(c.account)}" placeholder="—"></div>
    <div class="ce-row"><label>密码</label><input data-cap="password" value="${esc(c.password)}" placeholder="—"></div>
    <div class="ce-row"><label>地址</label><input data-cap="port" value="${esc(c.port)}" placeholder="—"></div>
    <div class="ce-row"><label>备份方式</label><select data-cap="backup">${backupOpts}</select></div>
    <div class="ce-row"><label>网盘实际路径</label><input data-cap="actualPath" value="${esc(c.actualPath || '')}" placeholder="—"></div>`;
}
function showConnEditor(c, visEl) {
  cancelConnEditorHide();
  if (!connEditorEl) {
    connEditorEl = document.createElement('div');
    connEditorEl.className = 'conn-editor';
    connEditorEl.addEventListener('mouseenter', cancelConnEditorHide);
    connEditorEl.addEventListener('mouseleave', scheduleConnEditorHide);
    connEditorEl.addEventListener('change', (e) => {
      const cap = e.target.dataset && e.target.dataset.cap;
      if (!cap) return;
      const c2 = state.connections.find(cc => cc.id === connEditorEl.dataset.connId);
      if (!c2) return;
      c2[cap] = e.target.value;
      if (cap === 'status') {
        const g2 = linkLayer.querySelector(`.conn[data-conn-id="${c2.id}"]`);
        const lp = g2 && g2.querySelector('.link');
        if (lp) lp.setAttribute('class', 'link ' + statusClass(c2.status));
      }
    });
    document.body.appendChild(connEditorEl);
  }
  connEditorEl.dataset.connId = c.id;
  activeConnId = c.id;
  connEditorEl.innerHTML = connEditorFields(c);
  connEditorEl.style.display = 'block';
  const w = connEditorEl.offsetWidth, h = connEditorEl.offsetHeight;
  const r = visEl.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  let x = Math.max(8, Math.min(cx - w / 2, window.innerWidth - w - 8));
  let y = r.top - 20 - h;
  if (y < 8) y = r.bottom + 20;
  if (y + h > window.innerHeight - 8) y = Math.max(8, window.innerHeight - h - 8);
  connEditorEl.style.left = x + 'px';
  connEditorEl.style.top = y + 'px';
}
function hideConnEditor() {
  const og = linkLayer && linkLayer.querySelector('.conn.open');
  if (og) og.classList.remove('open', 'hover');
  if (connEditorEl) { connEditorEl.remove(); connEditorEl = null; }
  activeConnId = null; connGuardUntil = 0; connEditorTimer = null;
  clearEmph();
}
function scheduleConnEditorHide() { connEditorTimer = setTimeout(hideConnEditor, 500); }
function cancelConnEditorHide() { if (connEditorTimer) { clearTimeout(connEditorTimer); connEditorTimer = null; } }
