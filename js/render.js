function render() {
  renderLeft();
  syncLeftColWidths();   // 左栏“空间信息/空间”两列按最宽内容共享列宽（仅水平，不改垂直/排序）
  renderRight();        // 内部已先 fitPathColumn + syncLaneWidths 再 positionDataNodes
  alignHeights();
  /* 每次渲染都重排定位：保证路径均匀排布、记录节点与关联路径对齐。
     deferArrange 仅用于推迟“聚类重排”（父子靠拢 / 顺序调整），不影响定位——
     新增项先以自然顺序（追加在末位）均匀呈现，焦点离开后由 commitChange
     触发 autoParent 再靠拢，从而实现“新增后不立即重排”。 */
  positionDataNodes();
  drawRecordFrames();   // 每条记录的 4 个数据单元格（数据别称/频率/估计大小/用途）整体加一个外框
  drawConnections();
  drawStructLinks();
  deferArrange = false;
  lockInputs();
  /* 新增后自动聚焦对应字段（编辑模式）；失焦后由 change 提交并重排 */
  if (pendingFocus) {
    const spec = pendingFocus; pendingFocus = null;
    const isDd = spec.startsWith('dd:');
    const wanted = isDd ? spec.slice(3) : spec;
    const el = [...document.querySelectorAll('[data-path]')].find(e => e.dataset.path === wanted && (!isDd || e.classList.contains('dd')));
    if (el) {
      if (isDd) openDropdown(el);
      else { el.readOnly = false; el.focus(); if (el.select) { try { el.select(); } catch (e) {} } enterPathEdit(el); }
    }
  }
  saveState();   // 每次渲染后持久化（含排序：数组顺序即显示与排序顺序）
}

/* 左栏两列共享列宽：把“空间信息”“空间”各自按所有行最宽内容对齐，
   使右对齐 / 铺满在跨行时真正生效；列宽 = 该列最宽内容（“恰好能放得下当前内容”）。
   仅水平方向，不改动任何垂直布局，也不影响拖拽排序。 */
function syncLeftColWidths() {
  const rows = Array.from(document.querySelectorAll('#left-rows .row[data-space-row]'));
  if (!rows.length) return;
  const infoCells = [], spaceCells = [];
  rows.forEach(r => {
    const info = r.querySelector(':scope > .cell.subcol-info');
    const space = r.querySelector(':scope > .cell.subcol-space');
    if (info) infoCells.push(info);
    if (space) spaceCells.push(space);
  });
  infoCells.forEach(c => c.style.width = '');
  spaceCells.forEach(c => c.style.width = '');
  let wInfo = 0, wSpace = 0;
  infoCells.forEach(c => { wInfo = Math.max(wInfo, c.getBoundingClientRect().width); });
  spaceCells.forEach(c => { wSpace = Math.max(wSpace, c.getBoundingClientRect().width); });
  infoCells.forEach(c => { c.style.width = Math.ceil(wInfo) + 'px'; });
  spaceCells.forEach(c => { c.style.width = Math.ceil(wSpace) + 'px'; });
  const hInfo = document.querySelector('#left-body .col-head-cell.subcol-info');
  const hSpace = document.querySelector('#left-body .col-head-cell.subcol-space');
  if (hInfo) hInfo.style.width = Math.ceil(wInfo) + 'px';
  if (hSpace) hSpace.style.width = Math.ceil(wSpace) + 'px';
}

/* 右侧 5 条泳道自适应宽度：.attr-node 是绝对定位，默认不会撑开列宽，
   导致列宽只等于表头文字。这里临时把 attr-node 改回流内，测量内容所需宽度，
   再显式设回列宽。路径列由 path-stack 本身撑开，无需处理。 */
/* 计算某泳道的自适应宽度（与 syncLaneWidths 的测量一致，但不写回），用于固定宽度判定 */
function laneTargetWidth(lane) {
  const head = lane.querySelector('.lane-head');
  const nodes = Array.from(lane.querySelectorAll('.attr-node'));
  const saved = nodes.map(n => ({
    el: n, position: n.style.position, transform: n.style.transform,
    top: n.style.top, left: n.style.left, right: n.style.right
  }));
  const headSaved = head ? head.style.whiteSpace : '';
  /* 用途列测量时把 textarea 临时钉成 200px，避免其按自身文本长度撑开（自适应）；
     这样列宽稳定 = 200 + 徽标 + gap + padding，与“拖拽调列宽时 textarea 跟随列宽伸缩”互不冲突。 */
  const purposeTA = lane.classList.contains('lane-purpose')
    ? Array.from(lane.querySelectorAll('textarea.inline-edit')) : [];
  purposeTA.forEach(t => { t.dataset._mw = t.style.width; t.style.width = '200px'; });
  nodes.forEach(n => { n.style.position = 'static'; n.style.transform = 'none'; n.style.top = 'auto'; n.style.left = 'auto'; n.style.right = 'auto'; });
  const oldW = lane.style.width, oldMin = lane.style.minWidth;
  lane.style.width = 'max-content'; lane.style.minWidth = '0';
  if (head) head.style.whiteSpace = 'nowrap';   // 测“表头刚好不换行”的宽度
  const headW = head ? head.getBoundingClientRect().width : 0;
  const contentW = lane.getBoundingClientRect().width;
  lane.style.width = oldW; lane.style.minWidth = oldMin;
  if (head) head.style.whiteSpace = headSaved;
  saved.forEach(s => { s.el.style.position = s.position; s.el.style.transform = s.transform; s.el.style.top = s.top; s.el.style.left = s.left; s.el.style.right = s.right; });
  purposeTA.forEach(t => { t.style.width = t.dataset._mw || ''; delete t.dataset._mw; });
  /* 最小列宽需把“列自身”的左右 padding/border 算进去（box-sizing:border-box 下列宽含 padding，
     不加上会导致内容区比表头窄 12px 而换行）：
     用途列 140px；其余列 = 表头文字宽 + 列左右 padding + 列左右 border（margin 是列间间距，不计入列宽）。 */
  const cs = getComputedStyle(lane);
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const borderX = parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
  const headMin = Math.ceil(headW + padX + borderX);
  const minW = lane.classList.contains('lane-purpose') ? 140 : headMin;
  return Math.max(contentW, minW);
}
function syncLaneWidths() {
  const lanes = document.querySelectorAll('.right-canvas > .lane:not(.lane-path)');
  lanes.forEach(lane => {
    if (lane.classList.contains('lane-custom')) {
      const a = state.customAttrs.find(x => x.id === lane.dataset.customId);
      if (a && a.width != null) { lane.style.width = Math.ceil(a.width) + 'px'; return; }   // 自定义列固定宽度优先
    } else {
      const key = lane.dataset.resize;
      if (key && state.laneWidths && state.laneWidths[key] != null) { lane.style.width = Math.ceil(state.laneWidths[key]) + 'px'; return; }   // 基础列固定宽度优先
    }
    lane.style.width = Math.ceil(laneTargetWidth(lane)) + 'px';
  });
}

/* 编辑/只读模式：由全局 state.locked 决定。
   锁定态（默认）：所有输入框只读/禁用（纯文本外观），需双击某个输入框才解锁编辑；
   解锁态：所有输入框直接可编辑（单击即编辑），不存在“只读”概念。 */
function lockInputs() {
  document.querySelectorAll('.inline-edit').forEach(el => {
    if (state.locked) {
      if (el.tagName === 'SELECT') el.disabled = true;
      else el.readOnly = true;
    } else {
      if (el.tagName === 'SELECT') el.disabled = false;
      else el.readOnly = false;
    }
  });
  document.body.classList.toggle('unlocked', !state.locked);
}

/* 列宽配置 */
const LEFT_COLS = [
  { label: '空间信息', cls: 'subcol-info', align: 'right' },
  { label: '空间', cls: 'subcol-space', align: 'center' }
];
const RIGHT_COLS = [
  { label: '路径', cls: 'subcol-path' },
  { label: '数据别称', cls: 'subcol-alias' },
  { label: '频率', cls: 'subcol-freq' },
  { label: '估计大小', cls: 'subcol-size' },
  { label: '用途', cls: 'subcol-purpose' },
  { label: '结构', cls: 'subcol-structure' }
];

function headRow(cols) {
  return `<div class="col-head-row">` +
    cols.map(c => `<div class="col-head-cell ${c.cls}${c.align ? ' align-' + c.align : ''}">${c.label}</div>`).join('') +
    `</div>`;
}

/* ---------- 左：存储空间 ---------- */
function renderLeft() {
  const body = $('#left-body');
  let html = headRow(LEFT_COLS);
  html += `<div class="rows" id="left-rows">`;
  for (const sp of state.spaces) {
    const id4 = (sp.info.account || '').slice(0, 4) || '----';
    html += `<div class="row${sp.disabled ? ' is-disabled' : ''}" data-space-row="${sp.id}">`;
    html += `<div class="cell subcol-info">
      <div class="space-info">
        <div class="si-col si-col-left">
          <div class="si-field"><span class="si-label">用途</span>
            <input class="inline-edit" data-path='${pstr(['spaces', sp.id, 'info', 'purpose'])}' value="${esc(sp.info.purpose)}" placeholder="—" /></div>
          <div class="si-field"><span class="si-label">备注</span>
            <input class="inline-edit" data-path='${pstr(['spaces', sp.id, 'info', 'remark'])}' value="${esc(sp.info.remark)}" placeholder="—" /></div>
        </div>
        <div class="si-col si-col-right">
          <div class="si-field"><span class="si-label">账号</span>
            <input class="inline-edit" data-path='${pstr(['spaces', sp.id, 'info', 'account'])}' value="${esc(sp.info.account)}" placeholder="—" /></div>
          <div class="si-field"><span class="si-label">大小</span>
            <div class="si-combo">
              <input class="inline-edit si-pill" data-path='${pstr(['spaces', sp.id, 'info', 'size'])}' value="${esc(sp.info.size)}" placeholder="-" />
              <div class="dd dd-unit" data-path='${pstr(['spaces', sp.id, 'info', 'unit'])}' data-options="MB|GB|TB" data-value="${esc(sp.info.unit || 'GB')}" tabindex="0"><span class="dd-val">${esc(sp.info.unit || 'GB')}</span></div>
              <span class="brk">(</span>
              <input class="inline-edit si-pill" data-path='${pstr(['spaces', sp.id, 'info', 'free'])}' value="${esc(sp.info.free)}" placeholder="-" />
              <div class="dd dd-unit" data-path='${pstr(['spaces', sp.id, 'info', 'freeUnit'])}' data-options="MB|GB|TB" data-value="${esc(sp.info.freeUnit || 'GB')}" tabindex="0"><span class="dd-val">${esc(sp.info.freeUnit || 'GB')}</span></div>
              <span class="brk">)</span>
              <input class="inline-edit si-pill" data-path='${pstr(['spaces', sp.id, 'info', 'plan'])}' value="${esc(sp.info.plan)}" placeholder="-" />
            </div></div>
        </div>
      </div></div>`;
    const iconHTML = sp.media.icon && DEFAULT_ICONS[sp.media.icon]
      ? DEFAULT_ICONS[sp.media.icon]
      : (sp.media.icon && sp.media.icon.startsWith('data:') ? `<img src="${sp.media.icon}" alt="">` : DEFAULT_ICONS.disk0);
    /* 相连路径按完整路径文本排序，使父子文件夹在 title 中聚在一起 */
    const linkedPaths = state.connections.filter(c => c.spaceId === sp.id).map(c => getPath(c.pathId)).filter(Boolean).sort((a, b) => a.text < b.text ? -1 : a.text > b.text ? 1 : 0);
    const spaceTitle = linkedPaths.length ? linkedPaths.map(p => p.text).join('\n') : '（未关联路径）';
    html += `<div class="cell subcol-space">
      <div class="space-node" data-space-id="${sp.id}" title="${esc(spaceTitle)}">
        <div class="space-icon">${iconHTML}</div>
        <div class="space-meta">
          <input class="inline-edit space-name" data-path='${pstr(['spaces', sp.id, 'media', 'name'])}' value="${esc(sp.media.name)}" placeholder="—" />
          <div class="space-id" title="识别号（账号/序列号前4位）">（${esc(id4)}）</div>
        </div>
        <span class="grip" data-reorder="space" data-space-id="${sp.id}" title="长按拖动以调整排序">⠿</span>
        <div class="space-anchor" data-space-id="${sp.id}" title="拖拽到数据建立连线"></div>
      </div></div>`;
    html += `</div>`;
  }
  html += `</div>`;
  body.innerHTML = html;
}

/* ---------- 右：路径（扁平列表）+ 记录（扁平列表，5 列） ---------- */
/* 用户自定义属性列：列头为可双击重命名的属性名（输入框），主体为每条记录的空白属性值 */
function customLaneHTML(a) {
  let nodes = '';
  for (const r of state.records) {
    const rid = r.id;
    const val = (r.custom && r.custom[a.id] != null) ? r.custom[a.id] : '';
    nodes += `<div class="attr-node" data-record-id="${rid}">
      <input class="inline-edit" data-path='${pstr(['records', rid, 'custom', a.id])}' value="${esc(val)}" placeholder="—" />
    </div>`;
  }
  return `<div class="lane lane-custom align-${a.align || 'center'}" data-custom-id="${a.id}">
    <div class="lane-head align-center custom-attr-head">
      <input class="inline-edit custom-attr-name" data-path='${pstr(['customAttrs', a.id, 'name'])}' value="${esc(a.name)}" placeholder="属性名" />
    </div>
    <div class="attr-stack">${nodes}</div>
  </div>`;
}
/* 泳道间“新增自定义属性”插入符：默认隐藏，hover 显示 +；+ 下方为列宽调整控件 */
function inserterHTML(after) {
  return `<div class="lane-inserter" data-after="${after}" title="新增用户自定义属性">
    <div class="inserter-head"><button class="inserter-add" type="button" aria-label="新增自定义属性">+</button></div>
    <div class="inserter-resize" data-after="${after}" title="按住左右拖动调整左侧列宽"></div>
  </div>`;
}
function renderRight() {
  const body = $('#right-body');
  let html = `<div class="right-canvas" id="right-canvas">`;

  /* 1) 路径泳道：所有路径按 state.paths 顺序竖向排布（扁平列表，无数据包裹） */
  html += `<div class="lane lane-path"><div class="lane-head align-center">路径</div><div class="path-stack">`;
  for (const p of state.paths) html += pathNodeHTML(p.id, p);
  html += `</div></div>`;

  /* 2) 数据别称 / 频率 / 大小 / 用途 / 结构：按记录扁平渲染（每条记录一组 5 节点，data-record-id 关联） */
  const lane = { alias: '', freq: '', size: '', purpose: '', structure: '' };
  for (const r of state.records) {
    const rid = r.id;
    lane.alias += `<div class="attr-node alias-node" data-record-id="${rid}">
        <input class="inline-edit" data-path='${pstr(['records', rid, 'alias'])}' value="${esc(r.alias)}" placeholder="—" />
      </div>`;
    lane.freq += `<div class="attr-node" data-record-id="${rid}">
        <div class="dd" data-path='${pstr(['records', rid, 'freq'])}' data-options="冷数据|热数据|常读不常写|常写不常读|只读|只写" data-value="${esc(r.freq)}">
          <span class="dd-val">${esc(r.freq)}</span></div></div>`;
    lane.size += `<div class="attr-node" data-record-id="${rid}">
        <div class="size-row">
          <input class="inline-edit" data-path='${pstr(['records', rid, 'size', 'value'])}' value="${esc(r.size.value)}" placeholder="-" />
          <div class="dd dd-unit" data-path='${pstr(['records', rid, 'size', 'unit'])}' data-options="MB|GB|TB" data-value="${esc(r.size.unit)}"><span class="dd-val">${esc(r.size.unit)}</span></div>
        </div></div>`;
    lane.purpose += `<div class="attr-node" data-record-id="${rid}">
        <textarea class="inline-edit" data-path='${pstr(['records', rid, 'purpose'])}' placeholder="—">${esc(r.purpose)}</textarea>
        ${(r.structure.children && r.structure.children.length) ? `<span class="child-count" data-action="toggle" data-path='${pstr(['records', rid, 'structure'])}' title="点击折叠/展开下级节点（直接子级 ${r.structure.children.length} 个）">${r.structure.children.length}</span>` : `<span class="child-count" title="直接子级数量">0</span>`}
        <span class="rec-add-sib" data-action="add" data-path='${pstr(['records', rid, 'structure'])}' title="新增子节点（在“结构”列中显示为二级节点）">+</span></div>`;
    lane.structure += `<div class="attr-node" data-record-id="${rid}">
        ${structColumnHTML(rid, r)}</div>`;
  }

  html += `<div class="lane lane-alias" data-resize="alias"><div class="lane-head align-left">数据别称</div><div class="attr-stack">${lane.alias}</div></div>`;
  html += inserterHTML('alias');   /* 起始插入符：永远紧挨“数据别称”，添加后保留 */
  for (const a of state.customAttrs.filter(x => x.after === 'alias')) { html += customLaneHTML(a); html += inserterHTML(a.id); }
  html += `<div class="lane lane-freq" data-resize="freq"><div class="lane-head align-center">频率</div><div class="attr-stack">${lane.freq}</div></div>`;
  html += inserterHTML('freq');
  for (const a of state.customAttrs.filter(x => x.after === 'freq')) { html += customLaneHTML(a); html += inserterHTML(a.id); }
  html += `<div class="lane lane-size" data-resize="size"><div class="lane-head align-right">估计大小</div><div class="attr-stack">${lane.size}</div></div>`;
  html += inserterHTML('size');
  for (const a of state.customAttrs.filter(x => x.after === 'size')) { html += customLaneHTML(a); html += inserterHTML(a.id); }
  html += `<div class="lane lane-purpose" data-resize="purpose"><div class="lane-head align-left">用途</div><div class="attr-stack">${lane.purpose}</div></div>`;
  html += `<div class="lane-inserter resize-only" data-after="purpose"><div class="inserter-resize" data-after="purpose" title="按住左右拖动调整左侧列宽（用途）"></div></div>`;
  html += `<div class="lane lane-structure"><div class="lane-head align-center">结构</div><div class="attr-stack">${lane.structure}</div></div>`;

  html += `</div>`;
  body.innerHTML = html;
  fitPathColumn();        // 先定稿路径列宽（含 hover 预留）
  syncLaneWidths();       // 再定稿数据列宽——用途 textarea 宽度最终化后，field-sizing:content 才能使高度与最终渲染一致
  positionDataNodes();     // 此时测量的单元格高度才是最终值（不再被“宽度未定→窄列→文字多行→虚高”污染）
}

/* 路径列自适应：列宽 = max( min(普通), min(hovered) ) */
function fitPathColumn() {
  const lane = document.querySelector('.lane-path');
  if (!lane) return;
  const stack = lane.querySelector('.path-stack');
  const nodes = Array.from(lane.querySelectorAll('.path-node'));
  if (!nodes.length) return;

  const savedLaneMin = lane.style.minWidth, savedLaneW = lane.style.width;
  const savedStackMin = stack.style.minWidth, savedStackW = stack.style.width;
  const savedNodeW = nodes.map(n => n.style.width);
  const prefixes = Array.from(lane.querySelectorAll('.path-node.is-sub .path-prefix'));
  const savedPrefix = prefixes.map(p => p.style.display);

  nodes.forEach(n => { n.style.width = 'max-content'; });
  lane.style.minWidth = '0'; lane.style.width = 'max-content';
  if (stack) { stack.style.minWidth = '0'; stack.style.width = 'max-content'; }
  prefixes.forEach(p => { p.style.display = 'inline'; });

  const needed = lane.getBoundingClientRect().width;

  prefixes.forEach((p, i) => { p.style.display = savedPrefix[i]; });
  nodes.forEach((n, i) => { n.style.width = savedNodeW[i]; });
  if (stack) { stack.style.minWidth = savedStackMin; stack.style.width = savedStackW; }
  lane.style.minWidth = savedLaneMin; lane.style.width = savedLaneW;

  lane.style.minWidth = Math.ceil(needed) + 'px';
}

/* 浮动节点定位：
   - 带高 = max(min(数据记录), min(路径), min(空间))；
   - 路径节点在带内 space-evenly 分布；空间行均匀分布；
   - 记录节点以“关联路径中心均值 / 按序均布”定位，相邻块按上下界留最小间距 PAD(12px) 规避，不强制均匀分布。 */
function positionDataNodes() {
  const canvas = $('#right-canvas');
  if (!canvas) return;
  const pathStack = canvas.querySelector('.lane-path .path-stack');

  const PAD = 12;   // 块间与首尾的最小相等间距（px），按上下界计
  const halfOf = (rid) => {
    let max = 0;
    canvas.querySelectorAll(`.attr-node[data-record-id="${cssAttr(rid)}"]`).forEach(n => {
      const h = n.getBoundingClientRect().height;
      if (h > max) max = h;
    });
    return max / 2;
  };

  /* 高度取 max(min(数据记录), min(路径), min(空间))：
     - min(空间)    = 左栏空间行总高
     - min(路径)    = path-stack 内容自然高（路径节点仅由 path-stack 撑开）
     - min(数据记录) = 各记录以最小间距紧密排布所需高度（半高+半高+间距 累加）
     三者内部以相等间距均匀排布：路径用 space-evenly；记录在此带高内排布。 */
  const spaceRows = document.querySelector('#left-rows');
  const spaceH = spaceRows ? spaceRows.getBoundingClientRect().height : 0;
  const pathH = pathStack.getBoundingClientRect().height;
  const recHalves = state.records.map(r => halfOf(r.id));
  let recMinH = 0;
  if (recHalves.length) {
    // 各记录以最小间距 PAD 紧排所需高度下限 = Σ单条高度 + (N-1) 个块间最小间距 PAD
    //                                   = Σ(2*half) + (N-1)*PAD  （仅保证能兜住，不强制均匀分布）
    recMinH = recHalves.reduce((s, h) => s + 2 * h, 0) + (recHalves.length - 1) * PAD;
  }
  const bandH = Math.max(recMinH, pathH, spaceH);
  pathStack.style.height = bandH + 'px';
  pathStack.style.justifyContent = 'space-evenly';

  /* 记录节点是绝对定位，其偏移父级是 .attr-stack（位于 lane-head 之下）；
     路径节点在 .path-stack（同处 lane-head 之下），二者顶部对齐。
     故所有 y 均相对 path-stack 顶部计算。 */
  const stackRect = pathStack.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  const pathY = {};
  canvas.querySelectorAll('.path-node').forEach(n => {
    const r = n.getBoundingClientRect();
    pathY[n.dataset.pathId] = r.top + r.height / 2 - stackRect.top;
  });

  /* 记录节点：以“关联路径中心均值 / 按序均布”定位；仅做最小间距规避——
     相邻块按上下界（上条底↔本条顶）留 ≥PAD(12px) 间隙，不强制均匀分布。 */
  const n = recHalves.length;
  const items = state.records.map((r, i) => {
    const ys = recordPathIds(r.id).map(pid => pathY[pid]).filter(v => v != null);
    const y = ys.length
      ? ys.reduce((a, b) => a + b, 0) / ys.length
      : bandH * (i + 0.5) / Math.max(1, n);
    return { rid: r.id, y, half: halfOf(r.id) };
  });
  items.sort((a, b) => a.y - b.y);
  for (let iter = 0; iter < 240; iter++) {
    let moved = false;
    for (let i = 1; i < items.length; i++) {
      const need = items[i - 1].half + items[i].half + PAD;   // 上条半高 + 本条半高 + 最小间距
      const gap = items[i].y - items[i - 1].y;
      if (gap < need) {
        const shift = (need - gap) / 2;
        items[i - 1].y -= shift; items[i].y += shift;
        moved = true;
      }
    }
    if (!moved) break;
  }
  /* 防止被推到画布顶部之上而裁切：整体上移使最顶节点不越界（保持间距不变） */
  const minTop = Math.min(...items.map(it => it.y - it.half));
  if (minTop < 0) { const d = -minTop; items.forEach(it => it.y += d); }

  const setTop = (el, y) => { if (el) { el.style.top = y + 'px'; el.style.transform = 'translateY(-50%)'; } };
  for (const it of items) {
    canvas.querySelectorAll(`.attr-node[data-record-id="${cssAttr(it.rid)}"]`)
      .forEach(el => setTop(el, it.y));
  }

  /* 画布高度包住最低节点（避免被 lane 的 overflow:hidden 裁切） */
  let maxB = 0;
  canvas.querySelectorAll('.path-node, .attr-node').forEach(n => {
    const r = n.getBoundingClientRect();
    maxB = Math.max(maxB, r.bottom - canvasRect.top);
  });
  canvas.style.minHeight = (maxB + 24) + 'px';
}

/* 每条记录的整体外框：把该记录“数据别称/频率/估计大小/用途”四个单元格当成一个整体，
   在定位完成后用一个 .rec-frame 边框框住（结构列不参与）。每次 render 重绘时重建。 */
function drawRecordFrames() {
  const canvas = $('#right-canvas');
  if (!canvas) return;
  canvas.querySelectorAll('.rec-frame').forEach(e => e.remove());
  const cRect = canvas.getBoundingClientRect();
  const pad = 2;
  for (const r of state.records) {
    const cells = Array.from(canvas.querySelectorAll(`.attr-node[data-record-id="${cssAttr(r.id)}"]`))
      .filter(c => !c.closest('.lane-structure') && !c.closest('.lane-custom'));   // 仅四数据列，排除结构列与自定义属性列
    if (!cells.length) continue;
    let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
    cells.forEach(c => {
      const b = c.getBoundingClientRect();
      if (b.left < minL) minL = b.left;
      if (b.top < minT) minT = b.top;
      if (b.right > maxR) maxR = b.right;
      if (b.bottom > maxB) maxB = b.bottom;
    });
    const f = document.createElement('div');
    f.className = 'rec-frame';
    f.dataset.recordId = r.id;
    f.style.left = (minL - cRect.left - pad) + 'px';
    f.style.top = (minT - cRect.top - pad) + 'px';
    f.style.width = (maxR - minL + pad * 2) + 'px';
    f.style.height = (maxB - minT + pad * 2) + 'px';
    /* 插到车道之前（白底在底层），避免不透明背景遮住单元格内容 */
    canvas.insertBefore(f, canvas.firstChild);
  }
}

/* 属性值里可能含引号等，转义为属性选择器安全串 */
function cssAttr(s) {
  return String(s ?? '').replace(/["\\]/g, '\\$&');
}

/* 单条路径节点 */
function pathNodeHTML(pid, p) {
  const prefix = parentPrefixOf(p);
  const locked = state.locked;
  const cls = `path-node${p.app ? ' is-app' : ''}${prefix ? ' is-sub' : ''}${!p.text.endsWith('/') ? ' is-leaf' : ''}`;
  const grip = `<span class="grip grip-inline" data-reorder="path" data-path-id="${pid}" title="长按拖动以调整排序">⠿</span>`;
  /* 锁定态：叶子/文件夹均按“父前缀 + 相对名”显示（父前缀由 path-prefix 呈现，仅 hover 显示）；
     解锁态：路径输入框始终直接显示完整路径，不再拆分出 path-prefix 前缀 span。 */
  const isLeaf = !p.text.endsWith('/');
  const displayText = locked ? pathDisplayValue(p) : p.text;
  /* 按父链深度计算缩进：第 n 级子文件夹缩进 n*16px，使第三级明显大于第二级 */
  let depth = 0, _cur = p;
  while (_cur && _cur.parent) { depth++; _cur = getPath(_cur.parent); }
  const indentStyle = depth > 0 ? ` style="margin-left:${depth * 16}px;width:calc(100% - ${depth * 16}px);"` : '';
  /* 悬停 title：分行列出相连的空间名称；无关联时回退显示完整路径 */
  const linkedSpaces = state.connections.filter(c => c.pathId === pid).map(c => {
    const s = state.spaces.find(x => x.id === c.spaceId);
    return s ? s.media.name : null;
  }).filter(Boolean);
  const pathTitle = linkedSpaces.length ? linkedSpaces.join('\n') : '（未关联空间）';
  return `<div class="${cls}"${indentStyle} data-path-id="${pid}" data-data-id="${pid}" title="${esc(pathTitle)}">
    <span class="path-anchor" data-path-id="${pid}" title="拖拽到空间建立连线"></span>
    ${grip}
    ${locked && prefix ? `<span class="path-prefix">${esc(prefix)}</span>` : ''}
    <input class="inline-edit path-input" data-path='${pstr(['paths', pid, 'text'])}' value="${esc(displayText)}" />
    <span class="path-add-sib" data-action="add-record" data-path-id="${pid}" title="新增一条记录（数据别称/频率/估计大小/用途/结构），并与本路径建立关联">+</span>
  </div>`;
}

/* ---------- 结构树 ---------- */
function structHTML(pathArr, node) {
  if (!node) return '';
  const hasChildren = node.children && node.children.length;
  const collapsed = node.collapsed && hasChildren;
  let h = `<div class="struct-tree">`;
  h += `<div class="struct-node" data-path='${pstr(pathArr)}'>
    <input class="inline-edit" data-path='${pstr(pathArr.concat(['name']))}' value="${esc(node.name)}" placeholder="—" />
    ${hasChildren ? `<span class="child-count" data-action="toggle" data-path='${pstr(pathArr)}' title="点击折叠/展开下级节点（直接子级 ${node.children.length} 个）">${node.children.length}</span>` : `<span class="child-count" title="直接子级数量">0</span>`}
    <span class="node-add" data-action="add" data-path='${pstr(pathArr)}' title="添加子节点">+</span>
  </div>`;
  if (hasChildren && !collapsed) {
    h += `<div class="struct-children">`;
    node.children.forEach((c, i) => { h += structHTML(pathArr.concat(['children', i]), c); });
    h += `</div>`;
  }
  h += `</div>`;
  return h;
}

/* 结构列：只渲染“用途”根（在用途列，即 用途 attr-node）下的二级子节点。
   因此此处不再画根标签——根就是用途列里的 用途 attr-node；这里只放它的 children。
   用途右边的“+”往 r.structure.children 推子节点，子节点即渲染在本列。 */
function structColumnHTML(rid, r) {
  const collapsed = r.structure.collapsed && r.structure.children && r.structure.children.length;
  if (collapsed) return '';
  const kids = (r.structure.children || []).map((c, i) => structHTML(['records', rid, 'structure', 'children', i], c)).join('');
  return kids ? `<div class="struct-children">${kids}</div>` : '';
}

/* ---------- 对齐：左（空间）与右（数据）画布取较高者，避免两侧高度悬殊 ---------- */
function alignHeights() {
  const l = $('#left-rows');
  const r = $('#right-canvas');
  if (!l || !r) return;
  const lh = l.getBoundingClientRect().height;
  const rh = r.getBoundingClientRect().height;
  const h = Math.max(lh, rh);
  l.style.minHeight = h + 'px';
  if (rh < h) r.style.minHeight = h + 'px';
}

/* ============================================================
 * 连线绘制
 * ============================================================ */
const panel = $('#panel');
const linkLayer = $('#link-layer');
