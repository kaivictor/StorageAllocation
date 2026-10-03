function initEvents() {
  /* 输入框 / 下拉：change 即写回 state 并重绘（commitChange 已提升为全局函数，供 openDropdown 等复用） */
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.cap) {
      const wrap = t.closest('.conn-editor') || t.closest('.conn');
      const cid = wrap && wrap.dataset.connId;
      const c = cid && state.connections.find(cc => cc.id === cid);
      if (c) {
        c[t.dataset.cap] = t.value;
        if (t.dataset.cap === 'status') {
          const g2 = linkLayer.querySelector(`.conn[data-conn-id="${cid}"]`);
          const lp = g2 && g2.querySelector('.link');
          if (lp) lp.setAttribute('class', 'link ' + statusClass(c.status));
        }
      }
      return;
    }
    if (t.dataset && t.dataset.path) {
      commitChange(parr(t.dataset.path), t.type === 'checkbox' ? t.checked : t.value);
    }
  });
  /* 输入框回车即失焦提交 */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input.inline-edit')) e.target.blur();
  });

  /* 路径节点 / 记录 / 空间 hover：强调关联对象 */
  document.addEventListener('mouseover', (e) => {
    if (reorder || drag) return;
    const pn = e.target.closest('.path-node');
    if (pn) {
      const pid = pn.dataset.pathId;
      const conns = state.connections.filter(c => c.pathId === pid);
      const sids = new Set(conns.map(c => c.spaceId));
      const directPaths = new Set([pid]);
      emphasize(sids, directPaths);
      return;
    }
    const an = e.target.closest('.attr-node');
    if (an && an.dataset.recordId) {
      const rid = an.dataset.recordId;
      const directPaths = new Set(recordPathIds(rid));
      const sids = new Set();
      for (const c of state.connections) if (directPaths.has(c.pathId)) sids.add(c.spaceId);
      emphasize(sids, directPaths, new Set([rid]));   // 被 hover 的记录本身始终可见（即使无关联路径）
      return;
    }
    const row = e.target.closest('.row[data-space-row]');
    if (row) { emphasizeSpace(row.dataset.spaceRow); return; }
  });
  document.addEventListener('mouseout', (e) => {
    if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.conn-editor')) return;
    if (activeConnId) return;
    const sel = '.conn, .path-node, .attr-node, .row[data-space-row]';
    const from = e.target.closest(sel);
    const to = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest(sel);
    if (from && from !== to) clearEmph();
  });

  /* 结构：展开/收起、增删 */
  document.addEventListener('click', (e) => {
    const act = e.target.dataset && e.target.dataset.action;
    if (!act || !e.target.dataset.path) return;
    const arr = parr(e.target.dataset.path);
    const node = getByPath(arr);
    if (!node) return;
    if (act === 'add') (node.children = node.children || []).push({ name: '新节点', children: [] });
    else if (act === 'del') delNode(arr);
    else if (act === 'toggle') node.collapsed = !node.collapsed;
    render();
  });

  /* 删除辅助函数：空间 / 路径 / 记录 / 连线 */
  document.addEventListener('click', (e) => {
    const act = e.target.dataset && e.target.dataset.action;
    if (act !== 'del-space' && act !== 'del-path' && act !== 'del-record') return;
    if (act === 'del-space') deleteSpace(e.target.dataset.spaceId);
    else if (act === 'del-path') deletePath(e.target.dataset.pathId);
    else if (act === 'del-record') deleteRecord(e.target.dataset.recordId);
  });

  let clickSuppress = false, lpTimer = null, lpDrag = null;
  let copyTimer = null;   // 单击复制：延迟以区分双击（双击不复制，避免改动粘贴板）
  /* 路径节点右侧“+”：新增一条记录（5 字段行）并与当前路径建立关联（不新增路径节点） */
  document.addEventListener('click', (e) => {
    if (clickSuppress) { clickSuppress = false; return; }
    const act = e.target.dataset && e.target.dataset.action;
    if (act === 'add-record') addRecordForPath(e.target.dataset.pathId);
  });
  /* 泳道间“+”：点击加号按钮，在对应位置新增一个用户自定义属性（所有记录获取空白值），并聚焦属性名输入框 */
  let lastAdd = 0;
  document.addEventListener('click', (e) => {
    const addBtn = e.target.closest('.inserter-add');
    if (!addBtn) return;
    const now = Date.now();
    if (now - lastAdd < 400) return;          // 防快速双击连加两条
    lastAdd = now;
    addCustomAttr(addBtn.closest('.lane-inserter').dataset.after);
  });

  /* 列宽拖拽：控件位于“+ 号”下方，按住左右拖动调整其左侧列宽 */
  document.addEventListener('mousedown', (e) => {
    const handle = e.target.closest('.inserter-resize');
    if (!handle) return;
    e.preventDefault();
    const ins = handle.closest('.lane-inserter');
    const lane = ins && ins.previousElementSibling;   // 左侧列（基础列或自定义属性列）
    if (!lane || !lane.classList.contains('lane')) return;
    const customId = lane.dataset.customId || null;
    const resizeKey = lane.dataset.resize || null;
    state.laneWidths = state.laneWidths || {};
    const startX = e.clientX;
    const startW = lane.getBoundingClientRect().width;
    const auto = laneTargetWidth(lane);   // 该列“设计/自适应”宽度，作为吸附目标
    const headEl = lane.querySelector('.lane-head');
    const headSaved = headEl ? headEl.style.whiteSpace : '';
    if (headEl) headEl.style.whiteSpace = 'nowrap';   // 测“表头刚好不换行”的宽度
    const headW = headEl ? headEl.getBoundingClientRect().width : 50;
    if (headEl) headEl.style.whiteSpace = headSaved;
    const cs = getComputedStyle(lane);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const borderX = parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
    const SNAP = 20;
    /* 最小列宽：用途列 140px；其余列 = 表头文字宽 + 列左右 padding + 列左右 border（margin 为列间间距，不计入） */
    const MIN_W = lane.classList.contains('lane-purpose') ? 140 : Math.ceil(headW + padX + borderX);
    let curW = startW;
    handle.classList.add('dragging');
    const onMove = (ev) => {
      let w = startW + (ev.clientX - startX);
      if (Math.abs(w - auto) <= SNAP) w = auto;          // 靠近“设计宽度”时吸附过去
      w = Math.max(MIN_W, w);
      curW = w;
      lane.style.width = curW + 'px';
      /* 列宽实时变化时，同步重绘每记录背景外框与“用途→结构”连线，使其跟随列宽 */
      if (typeof drawRecordFrames === 'function') drawRecordFrames();
      if (typeof drawStructLinks === 'function') drawStructLinks();
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      handle.classList.remove('dragging');
      /* 调整后的宽度 ≠ 自适应宽度 → 固定宽度；否则恢复自适应 */
      const auto = laneTargetWidth(lane);
      const fixed = Math.abs(curW - auto) > 0.5 ? Math.round(curW) : null;
      if (customId) {
        const a = state.customAttrs.find(x => x.id === customId);
        if (a) { if (fixed != null) a.width = fixed; else delete a.width; }
      } else if (resizeKey) {
        if (fixed != null) state.laneWidths[resizeKey] = fixed; else delete state.laneWidths[resizeKey];
      }
      render();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  /* 右击上下文菜单：空间 / 连线 / 路径 / 记录 / 结构 */
  document.addEventListener('contextmenu', (e) => {
    const spaceNode = e.target.closest('.space-node');
    const conn = e.target.closest('.conn');
    const fanGroup = e.target.closest('.fan-group');
    const pathNode = e.target.closest('.path-node');
    const recNode = e.target.closest('.lane-alias .attr-node, .lane-freq .attr-node, .lane-size .attr-node, .lane-purpose .attr-node, .lane-custom .attr-node');
    const structNode = e.target.closest('.struct-node');
    const customLane = e.target.closest('.lane-custom .lane-head');   /* 对齐菜单仅限自定义列表头；属性值走上面 recNode 弹“删除记录” */
    if (spaceNode) {
      e.preventDefault();
      openCtxMenu(e.clientX, e.clientY, [
        { label: '删除空间', danger: true, confirm: true, onClick: () => deleteSpace(spaceNode.dataset.spaceId) }
      ]);
    } else if (conn) {
      e.preventDefault();
      openCtxMenu(e.clientX, e.clientY, [
        { label: '删除连线', danger: true, confirm: true, onClick: () => deleteConnById(conn.dataset.connId) }
      ]);
    } else if (fanGroup) {
      e.preventDefault();
      openCtxMenu(e.clientX, e.clientY, [
        { label: '删除关联', danger: true, confirm: true, onClick: () => deletePathRecord(fanGroup.dataset.prId) }
      ]);
    } else if (pathNode) {
      e.preventDefault();
      openCtxMenu(e.clientX, e.clientY, [
        { label: '删除路径', danger: true, confirm: true, onClick: () => deletePath(pathNode.dataset.pathId) }
      ]);
    } else if (recNode) {
      e.preventDefault();
      openCtxMenu(e.clientX, e.clientY, [
        { label: '删除记录', danger: true, confirm: true, onClick: () => deleteRecord(recNode.dataset.recordId) }
      ]);
    } else if (structNode) {
      e.preventDefault();
      const arr = parr(structNode.dataset.path);
      const node = getByPath(arr);
      const hasKids = node && node.children && node.children.length;
      const items = [
        { label: '添加子节点', onClick: () => {
            const n = getByPath(arr);
            (n.children = n.children || []).push({ name: '新节点', children: [] });
            render();
          } }
      ];
      if (hasKids) {
        items.push({
          label: node.collapsed ? '展开下级节点' : '折叠下级节点',
          onClick: () => { const n = getByPath(arr); n.collapsed = !n.collapsed; render(); }
        });
      }
      items.push({ label: '删除节点', danger: true, confirm: true, onClick: () => { delNode(arr); render(); } });
      openCtxMenu(e.clientX, e.clientY, items);
    } else if (customLane) {   /* 仅命中自定义列表头（见上方选择器限定） */
      e.preventDefault();
      const cid = customLane.dataset.customId;
      const a = state.customAttrs.find(x => x.id === cid);
      const cur = (a && a.align) || 'center';
      openCtxMenu(e.clientX, e.clientY, [
        { label: '左对齐', active: cur === 'left', onClick: () => setCustomAttrAlign(cid, 'left') },
        { label: '居中对齐', active: cur === 'center', onClick: () => setCustomAttrAlign(cid, 'center') },
        { label: '右对齐', active: cur === 'right', onClick: () => setCustomAttrAlign(cid, 'right') },
        { label: '删除属性', danger: true, confirm: true, onClick: () => deleteCustomAttr(cid) }
      ]);
    }
  });

  /* 删除辅助函数 */
  function deleteSpace(id) {
    state.spaces = state.spaces.filter(s => s.id !== id);
    state.connections = state.connections.filter(c => c.spaceId !== id);
    render();
  }
  function deletePath(pid) {
    const p = getPath(pid);
    if (!p) return;
    const parent = p.parent;
    state.paths = state.paths.filter(x => x.id !== pid);
    for (const q of state.paths) if (q.parent === pid) q.parent = parent;  // 子路径上提
    state.connections = state.connections.filter(c => c.pathId !== pid);
    state.pathRecords = state.pathRecords.filter(pr => pr.pathId !== pid);
    render();
  }
  function deleteRecord(rid) {
    state.records = state.records.filter(r => r.id !== rid);
    state.pathRecords = state.pathRecords.filter(pr => pr.recordId !== rid);
    render();
  }
  /* 删除单条 路径↔记录 关联（不删除路径或记录本身） */
  function deletePathRecord(id) {
    state.pathRecords = state.pathRecords.filter(pr => pr.id !== id);
    render();
  }
  function deleteConnById(cid) {
    state.connections = state.connections.filter(c => c.id !== cid);
    render();
  }

  /* 拖拽建立连线（空间锚点 ↔ 路径锚点） */
  document.addEventListener('mousedown', (e) => {
    const a = e.target.closest('.space-anchor, .path-anchor');
    if (!a) return;
    e.preventDefault();
    startDrag(a);
  });

  /* 长按路径“+”：拖出连线到“记录(数据别称)”以建立 路径↔记录 关联（可右击删除记录解除） */
  document.addEventListener('mousedown', (e) => {
    const plus = e.target.closest('.path-add-sib');
    if (!plus) return;
    clickSuppress = false;
    e.preventDefault();
    const pathId = plus.dataset.pathId;
    lpTimer = setTimeout(() => {
      lpTimer = null;
      const node = plus.closest('.path-node');
      const start = rightOf(node);
      const temp = document.createElementNS(SVGNS, 'path');
      temp.setAttribute('class', 'link link-temp');
      temp.style.pointerEvents = 'none';
      linkLayer.appendChild(temp);
      lpDrag = { pathId, start, temp };
      hidePathTip(); hideConnEditor();
      const move = (ev) => {
        const lr = layerRect();
        const cur = { x: ev.clientX - lr.left, y: ev.clientY - lr.top };
        temp.setAttribute('d', curve(start, cur));
      };
      const up = (ev) => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        temp.remove();
        const target = document.elementFromPoint(ev.clientX, ev.clientY);
        const an = target && target.closest('.alias-node');
        if (an && an.dataset.recordId) addPathRecord(pathId, an.dataset.recordId);
        lpDrag = null;
        clickSuppress = true;
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    }, 350);
  });
  document.addEventListener('mouseup', () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } });

  /* 双击编辑：按字段解锁（只解锁被双击的那个元素，不影响同节点其它字段） */
  function unlockField(el) {
    if (el.tagName === 'SELECT') { el.disabled = false; el.focus(); }
    else { el.readOnly = false; el.focus(); if (el.select) el.select(); enterPathEdit(el); }
  }

  /* 单击复制：取字段的“整体语义值”（如 大小=数值+单位 → “512G”） */
  function fieldCopyText(el) {
    if (el.classList.contains('dd')) {
      const v = el.querySelector('.dd-val');
      return (v ? v.textContent : el.textContent).trim();
    }
    const pathAttr = el.dataset.path;
    if (pathAttr) {
      const arr = parr(pathAttr);
      const last = arr[arr.length - 1];
      if (arr[0] === 'paths' && last === 'text') return getPath(arr[1]).text || '';  // 路径：复制完整路径（含父级），而非 obsidian 显示的 /basename
      if (last === 'size' || last === 'unit') {     // 合并 数值 + 单位
        const obj = getByPath(arr.slice(0, -1));
        if (obj && typeof obj === 'object') {
          const v = obj.value != null ? obj.value : (obj.size != null ? obj.size : '');
          const u = obj.unit != null ? obj.unit : '';
          const combined = ('' + v + u).trim();
          if (combined) return combined;
        }
      }
    }
    if (el.tagName === 'SELECT') return (el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : el.value || '').trim();
    return (el.value != null ? el.value : el.textContent || '').trim();
  }
  function copyText(str) {
    if (!str) return;
    const toast = () => showToast('已复制 ' + midEllipsis(str, 20));
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(str).then(toast).catch(() => { fallbackCopy(str); toast(); });
    else { fallbackCopy(str); toast(); }
  }
  function fallbackCopy(str) {
    const ta = document.createElement('textarea');
    ta.value = str; ta.style.position = 'fixed'; ta.style.top = '-9999px'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
  }
  /* 超出 max 则以中间省略号代替（保留前后各约一半） */
  function midEllipsis(str, max) {
    if (str.length <= max) return str;
    const keep = max - 1, head = Math.ceil(keep / 2), tail = Math.floor(keep / 2);
    return str.slice(0, head) + '…' + str.slice(str.length - tail);
  }
  function showToast(msg) {
    let t = document.getElementById('app-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'app-toast'; t.className = 'app-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    if (t._timer) clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 1300);
  }
  /* 字段交互（区分锁定 / 解锁两态）：
     - 锁定态：只读字段单击复制（延迟 250ms 避让双击；正在编辑的字段不复制），双击才编辑；
     - 解锁态：单击即编辑——.inline-edit 已可直接编辑；.dd 单击直接弹下拉；空间图标单击直接弹图标菜单；无任何复制行为。 */
  document.addEventListener('click', (e) => {
    /* 锁定态：单击 path-prefix（父前缀 span）也复制完整路径（前缀本身无 data-path，需从 .path-node 取 id） */
    const prefixEl = e.target.closest('.path-prefix');
    if (prefixEl && state.locked) {
      const pn = prefixEl.closest('.path-node');
      const pid = pn && pn.dataset.pathId;
      if (pid) {
        if (copyTimer) clearTimeout(copyTimer);
        copyTimer = setTimeout(() => { copyTimer = null; copyText(getPath(pid).text || ''); }, 250);
      }
      return;
    }
    const el = e.target.closest('.inline-edit, .dd, .space-icon');
    if (!el) return;
    if (state.locked) {
      if (el.classList.contains('space-icon')) return;   // 锁定态：图标单击不复制，需双击才换图标
      if (!el.classList.contains('dd') && (el.tagName === 'SELECT' ? !el.disabled : !el.readOnly)) return;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => { copyTimer = null; copyText(fieldCopyText(el)); }, 250);
    } else {
      if (el.classList.contains('dd')) openDropdown(el);   // 解锁态：单击下拉即编辑，不复制
      else if (el.classList.contains('space-icon')) {      // 解锁态：单击空间图标即换图标，不复制
        const sn = el.closest('.space-node');
        if (sn && sn.dataset.spaceId) openIconMenu(sn.dataset.spaceId, e.clientX, e.clientY);
      }
    }
  });

  /* 右栏按 X 坐标命中具体泳道后的新增路由：路径列→新增路径；数据别称/频率/估计大小/用途/
     自定义属性列及任意两列间隙→新增记录（关联最近路径）；结构列不新增。
     供“列内空白双击”与“面板空白区双击”复用，保证列内与列间隙行为一致 */
  function addRightAt(x, y) {
    const rc2 = $('#right-canvas');
    const lane = rc2 && Array.from(rc2.querySelectorAll(':scope > .lane')).find(l => {
      const r = l.getBoundingClientRect();
      return x >= r.left && x <= r.right;
    });
    if (lane && lane.classList.contains('lane-path')) { addPathAt(y); return; }
    if (lane && lane.classList.contains('lane-structure')) return;   // 结构列不新增
    addRecordAt(y, nearestPathId(y));   // 记录列 / 自定义属性列 / 列间隙：新增记录
  }
  document.addEventListener('dblclick', (e) => {
    if (e.target.closest('.inserter-add')) return;   // 插入符加号仅响应单击新增，忽略双击（避免误触发空白新增）
    if (copyTimer) { clearTimeout(copyTimer); copyTimer = null; }   // 双击编辑时不复制，保粘贴板不变
    const dd = e.target.closest('.dd');
    if (dd) { openDropdown(dd); return; }
    const spaceIcon = e.target.closest('.space-icon');
    if (spaceIcon) {
      const sn = spaceIcon.closest('.space-node');
      if (sn && sn.dataset.spaceId) openIconMenu(sn.dataset.spaceId, e.clientX, e.clientY);
      return;
    }
    const el = e.target.closest('.inline-edit');
    if (el) { unlockField(el); return; }
    const node = e.target.closest('.attr-node, .space-node, .path-node, .struct-node');
    if (node) {
      const sel = node.querySelector('select.inline-edit');
      if (sel) { unlockField(sel); return; }
      const first = node.querySelector('.inline-edit');
      if (first) unlockField(first);
      return;
    }
    /* 右栏空白双击：按所在泳道列新增。
       关键：5 列的 .attr-node 是绝对定位，.attr-stack 高度坍缩为 0，泳道盒子高度仅等于表头，
       单击中部空白处并不落在 .lane 盒子里（closest('.lane') 为 null）。故改用 X 坐标判定命中哪条泳道。 */
    const rc = $('#right-canvas');
    if (rc && rc.contains(e.target)) {
      if (e.target.closest('.lane-head')) return;   // 禁止在列头双击触发新增
      addRightAt(e.clientX, e.clientY);
      return;
    }
    const leftBody = e.target.closest('#left-body');
    if (leftBody && !e.target.closest('.row') && !e.target.closest('.col-head-row')) {
      addSpaceAt(e.clientY);
      return;
    }
    /* 面板空白区（内容下方 / 滚动区）：两组高度随内容而定，其下方空白属于 .panel/.panel-scroll，
       不在 #left-body 或 #right-canvas 内，故上面两个分支都命中不到。此处按 X 坐标判定命中
       左/右分组，分别新增空间 / 记录（关联最近路径），与既有“列内空白双击新增”行为一致。 */
    const panel = $('#panel');
    const tgt = e.target;
    const inEmpty = tgt === panel || tgt === (panel && panel.parentElement)
      || (tgt.classList && (tgt.classList.contains('panel-scroll') || tgt.classList.contains('group')))
      || tgt.tagName === 'BODY' || tgt.tagName === 'MAIN';
    if (inEmpty) {
      const grpLeft = $('.group-left'), grpRight = $('.group-right');
      if (!grpLeft || !grpRight) return;
      const lr = grpLeft.getBoundingClientRect();
      const rr = grpRight.getBoundingClientRect();
      if (e.clientX >= lr.left && e.clientX <= lr.right) {
        addSpaceAt(e.clientY);
      } else if (e.clientX >= rr.left && e.clientX <= rr.right) {
        /* 右栏空白区：复用 addRightAt（与“列内空白双击”完全一致——
           路径列→新增路径，记录列/自定义属性列/列间隙→新增记录，结构列不新增） */
        addRightAt(e.clientX, e.clientY);
      }
      return;
    }
  });
  /* 失焦后按字段还原 */
  document.addEventListener('focusout', (e) => {
    const el = e.target.closest && e.target.closest('.inline-edit');
    if (!el) return;
    const to = e.relatedTarget;
    if (to && to.closest && to.closest('.inline-edit') === el) return;
    if (el.tagName === 'SELECT') el.disabled = true; else el.readOnly = true;
    if (el.classList.contains('path-input')) {
      /* 离开编辑态：锁定态复位为“相对显示值”（避免保留 enterPathEdit 写入的完整路径造成重复）；
         解锁态始终显示完整路径，不做相对化复位 */
      const arr = el.dataset.path ? parr(el.dataset.path) : null;
      const p = arr && arr[0] === 'paths' ? getPath(arr[1]) : null;
      if (p) el.value = state.locked ? pathDisplayValue(p) : p.text;
      const n = el.closest('.path-node'); if (n) n.classList.remove('editing');
    }
  });
  /* 记录最近编辑的路径/记录，供结构“+”定位目标 */
  document.addEventListener('focusin', (e) => {
    const pe = e.target.closest && e.target.closest('[data-path]');
    if (pe) {
      const arr = parr(pe.dataset.path);
      if (arr[0] === 'paths') {
        lastPathId = arr[1];
        /* 进入编辑态（已解锁可写）时，把输入框内容切换为“完整路径”，便于直接编辑全路径；
           涵盖子文件夹与带父级的叶子：静态显示（只读态）仍保持“父前缀 + 相对名”，外观不变 */
        const p = getPath(arr[1]);
        if (p && pe.tagName === 'INPUT' && pe.readOnly === false) {
          if (pe.value !== p.text) { pe.value = p.text; if (pe.select) pe.select(); }
          /* 解锁态编辑路径：与锁定态双击编辑一致，加 .editing 隐藏父级前缀，避免与完整路径重复显示 */
          const n = pe.closest('.path-node'); if (n) n.classList.add('editing');
        }
      }
      else if (arr[0] === 'records') lastRecordId = arr[1];
    }
  });

  /* 长按拖动排序（路径 / 空间）；手柄为 [data-reorder] */
  document.addEventListener('mousedown', (e) => {
    const grip = e.target.closest('[data-reorder]');
    if (!grip) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    let started = false;
    const timer = setTimeout(() => { if (!started) { beginReorder(grip); started = true; } }, 300);
    const move = (ev) => {
      if (started) return;
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 4) {
        clearTimeout(timer); beginReorder(grip); started = true;
      }
    };
    const up = () => { clearTimeout(timer); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  /* 锁定开关：切换后持久化并重新渲染以应用 lockInputs（锁定=双击编辑/单击复制；解锁=单击编辑/无复制） */
  const lockChk = $('#btn-lock');
  if (lockChk) {
    lockChk.checked = !!state.locked;
    const lockLabel = $('#lock-label');
    lockChk.addEventListener('change', () => {
      state.locked = lockChk.checked;
      if (lockLabel) lockLabel.textContent = state.locked ? '锁定' : '解锁';
      saveState();
      render();   // 重新应用 lockInputs，使全部字段在 只读/可编辑 间切换
    });
  }

  /* 工具栏 */
  $('#btn-add-space').addEventListener('click', addSpace);
  $('#btn-add-data').addEventListener('click', addData);
  $('#btn-export').addEventListener('click', exportData);
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', importData);
  $('#btn-clear').addEventListener('click', () => {
    if (window.confirm('确定要清空所有数据吗？此操作不可撤销。')) {
      clearData();
      showToast('已清空所有数据');
    }
  });

  window.addEventListener('resize', () => { drawConnections(); drawStructLinks(); });
}

/* 结构删除：定位父节点的 children 数组（结构现下放到每条记录） */
function delNode(pathArr) {
  if (pathArr[pathArr.length - 1] === 'structure' && pathArr[pathArr.length - 2] === 'records') {
    const recObj = getByPath(pathArr.slice(0, -1)); // records|rid
    recObj.structure = { name: '根', children: [] };
    return;
  }
  const parent = getByPath(pathArr.slice(0, -2));
  const idx = +pathArr[pathArr.length - 1];
  parent.children.splice(idx, 1);
}

/* ---------- 拖拽连线 ---------- */
let drag = null;
function startDrag(anchor) {
  const type = anchor.classList.contains('space-anchor') ? 'space' : 'path';
  const id = anchor.dataset.spaceId || anchor.dataset.pathId;
  const pathId = anchor.dataset.pathId || null;
  const start = type === 'space' ? rightOf(anchor) : leftOf(anchor);
  const temp = document.createElementNS(SVGNS, 'path');
  temp.setAttribute('class', 'link link-temp');
  temp.style.pointerEvents = 'none';
  linkLayer.appendChild(temp);
  drag = { type, id, pathId, start, temp };
  hidePathTip();
  hideConnEditor();

  const move = (ev) => {
    const lr = layerRect();
    const cur = { x: ev.clientX - lr.left, y: ev.clientY - lr.top };
    temp.setAttribute('d', type === 'space' ? curve(drag.start, cur) : curve(cur, drag.start));
  };
  const up = (ev) => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    temp.remove();
    const target = document.elementFromPoint(ev.clientX, ev.clientY);
    const sn = target && target.closest('.space-node');
    const pn = target && target.closest('.path-node');
    if (drag.type === 'space' && pn && pn.dataset.pathId) {
      addConnection(drag.id, pn.dataset.pathId);
    } else if (drag.type === 'path' && sn && sn.dataset.spaceId) {
      addConnection(sn.dataset.spaceId, drag.pathId);
    }
    drag = null;
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

function addConnection(spaceId, pathId) {
  if (state.connections.some(c => c.spaceId === spaceId && c.pathId === pathId)) return;
  state.connections.push({ id: nid('c'), spaceId, pathId, status: '正常', method: '', account: '', password: '', port: '', backup: '复制', actualPath: '' });
  render();
}

/* 路径 ↔ 记录 关联（多对多）：长按路径“+”拖到记录创建 */
function addPathRecord(pathId, recordId) {
  if (state.pathRecords.some(pr => pr.pathId === pathId && pr.recordId === recordId)) return;
  state.pathRecords.push({ id: nid('pr'), pathId, recordId });
  render();
}

/* ---------- 图标菜单 / 右击菜单 ---------- */
let ctxMenu = null;
function openCtxMenu(x, y, items) {
  closeCtxMenu();
  const m = document.createElement('div');
  m.className = 'ctx-menu';
  m.innerHTML = items.map((it, i) => `<div class="ctx-item${it.danger ? ' danger' : ''}${it.active ? ' active' : ''}" data-i="${i}">${esc(it.label)}</div>`).join('');
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  /* 偏移出光标：右击点恰在菜单左上角内时，1s 计时无意义；偏移后光标初始在菜单外，
     才需要“移入”以满足“右击后 1s 内未移入则关闭”的语义 */
  let left = Math.min(x + 10, window.innerWidth - r.width - 8);
  let top = Math.min(y + 10, window.innerHeight - r.height - 8);
  if (left < 8) left = 8;
  if (top < 8) top = 8;
  m.style.left = left + 'px';
  m.style.top = top + 'px';
  /* 自动关闭：右击后 1s 内未移入 → 关闭；移开后 0.5s 未回来 → 关闭 */
  const closeSoon = () => { if (ctxMenu === m) closeCtxMenu(); };
  m._enterTimer = setTimeout(closeSoon, 1000);
  m.addEventListener('mouseenter', () => {
    if (m._enterTimer) { clearTimeout(m._enterTimer); m._enterTimer = null; }
    if (m._leaveTimer) { clearTimeout(m._leaveTimer); m._leaveTimer = null; }
  });
  m.addEventListener('mouseleave', () => {
    m._leaveTimer = setTimeout(closeSoon, 500);
  });
  m.addEventListener('click', (e) => {
    const item = e.target.closest('.ctx-item');
    if (!item) return;
    const it = items[+item.dataset.i];
    /* 危险操作二次确认：首次点击仅把文本改为“确认删除”（armed），再次点击才执行 */
    if (it.confirm && !item.classList.contains('armed')) {
      item.textContent = it.confirmLabel || '确认删除';
      item.classList.add('armed');
      return;
    }
    closeCtxMenu();
    it.onClick();
  });
  setTimeout(() => document.addEventListener('mousedown', onDocDown), 0);
  function onDocDown(ev) { if (m !== ctxMenu) return; if (!m.contains(ev.target)) closeCtxMenu(); }
  m._cleanup = () => {
    document.removeEventListener('mousedown', onDocDown);
    if (m._enterTimer) clearTimeout(m._enterTimer);
    if (m._leaveTimer) clearTimeout(m._leaveTimer);
  };
  ctxMenu = m;
}
function closeCtxMenu() {
  if (ctxMenu) { if (ctxMenu._cleanup) ctxMenu._cleanup(); ctxMenu.remove(); ctxMenu = null; }
}

/* 空间图标选择菜单：双击空间 icon 弹出。最多展示 6 个图标 + “添加”，
   超过时滚动切换；打开后 0.5s 未悬停则关闭，离开 0.5s 后关闭；
   点“添加”导入图标期间不关闭；导入后保持菜单打开；自定义图标（data:）右击删除 */
function iconMenuHTML(spaceId) {
  const sp = state.spaces.find(s => s.id === spaceId);
  const builtin = Object.keys(DEFAULT_ICONS).map(k => ({ value: k, html: DEFAULT_ICONS[k] }));
  const custom = (state.customIcons || []).map(d => ({ value: d, html: `<img src="${d}" alt="">` }));
  const entries = custom.concat(builtin);   // 用户新增图标置于最前
  return `<div class="icon-grid">` + entries.map(en =>
    `<div class="icon-cell${sp && sp.media.icon === en.value ? ' active' : ''}" data-v="${encodeURIComponent(en.value)}" title="选择图标${en.value.startsWith('data:') ? '（右击删除）' : ''}">${en.html}</div>`
  ).join('') + `</div><div class="icon-add" title="导入图标文件">+ 添加</div>`;
}

function openIconMenu(spaceId, x, y) {
  closeCtxMenu();
  if (!state.spaces.find(s => s.id === spaceId)) return;
  const m = document.createElement('div');
  m.className = 'ctx-menu icon-menu';
  m.innerHTML = iconMenuHTML(spaceId);
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  let left = Math.min(x, window.innerWidth - r.width - 8);
  let top = Math.min(y + 8, window.innerHeight - r.height - 8);   // 略偏下，使光标初始在菜单外
  if (left < 8) left = 8;
  if (top < 8) top = 8;
  m.style.left = left + 'px';
  m.style.top = top + 'px';
  const closeSoon = () => { if (!m._keepOpen) closeCtxMenu(); };
  m._enterTimer = setTimeout(closeCtxMenu, 1000);   // 打开后 1s 内未移到菜单上 → 关闭
  m.addEventListener('mouseenter', () => {
    if (m._enterTimer) { clearTimeout(m._enterTimer); m._enterTimer = null; }
    if (m._leaveTimer) { clearTimeout(m._leaveTimer); m._leaveTimer = null; }
  });
  m.addEventListener('mouseleave', () => {
    if (m._keepOpen) return;
    m._leaveTimer = setTimeout(closeSoon, 500);    // 鼠标离开 0.5s 后关闭
  });
  m.addEventListener('click', (ev) => {
    if (ev.target.closest('.icon-add')) { openIconFilePicker(spaceId, m); return; }
    const cell = ev.target.closest('.icon-cell');
    if (!cell) return;
    const s = state.spaces.find(s => s.id === spaceId);
    if (s) { s.media.icon = decodeURIComponent(cell.dataset.v); render(); }
    closeCtxMenu();
  });
  m.addEventListener('contextmenu', (ev) => {
    ev.preventDefault(); ev.stopPropagation();    // 阻止原生菜单与全局右击处理
    const cell = ev.target.closest('.icon-cell');
    if (!cell) return;
    const val = decodeURIComponent(cell.dataset.v);
    if (!val.startsWith('data:')) return;         // 仅自定义图标可删除
    state.customIcons = (state.customIcons || []).filter(d => d !== val);
    const fallback = Object.keys(DEFAULT_ICONS)[0];
    for (const sp of state.spaces) if (sp.media.icon === val) sp.media.icon = fallback;
    render();
    m.innerHTML = iconMenuHTML(spaceId);           // 保持菜单打开并刷新
  });
  setTimeout(() => document.addEventListener('mousedown', onDocDown), 0);
  function onDocDown(ev) { if (m._keepOpen) return; if (!m.contains(ev.target)) closeCtxMenu(); }
  m._cleanup = () => document.removeEventListener('mousedown', onDocDown);
  ctxMenu = m;
}

/* 点“添加”：打开文件选择器；选择器打开期间保持菜单不关闭；取消选择时恢复常规关闭逻辑 */
function openIconFilePicker(spaceId, m) {
  m._keepOpen = true;
  if (m._enterTimer) { clearTimeout(m._enterTimer); m._enterTimer = null; }
  if (m._leaveTimer) { clearTimeout(m._leaveTimer); m._leaveTimer = null; }
  let handled = false;
  const onFocus = () => {                       // 选择框关闭（含取消）后窗口重获焦点
    window.removeEventListener('focus', onFocus);
    if (handled) return;                        // change 已处理（含选文件刷新）则跳过
    m._keepOpen = false;                        // 取消选择：解除保持，恢复 hover/leave 关闭
  };
  window.addEventListener('focus', onFocus);
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.addEventListener('change', () => {
    handled = true;
    window.removeEventListener('focus', onFocus);
    m._keepOpen = false;
    const file = input.files && input.files[0];
    if (!file) { closeCtxMenu(); return; }
    importIcon(file).then(dataUrl => {
      if (!dataUrl) { closeCtxMenu(); return; }
      state.customIcons = state.customIcons || [];
      state.customIcons.unshift(dataUrl);          // 新增图标置于最前
      const s = state.spaces.find(s => s.id === spaceId);
      if (s) s.media.icon = dataUrl;               // 默认设为当前空间图标
      render();
      m._keepOpen = false;
      m.innerHTML = iconMenuHTML(spaceId);         // 导入后保持菜单打开并刷新
    });
  });
  input.click();
}

/* 导入图标：位图中心裁切为正方形并压缩到 300KB 以内，base64 保存；SVG 原样保存 */
function importIcon(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (file.type === 'image/svg+xml') { resolve(dataUrl); return; }
      const img = new Image();
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
        let size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        // 判断是否含透明通道
        let hasAlpha = false;
        try {
          const px = ctx.getImageData(0, 0, size, size).data;
          for (let i = 3; i < px.length; i += 4) { if (px[i] < 255) { hasAlpha = true; break; } }
        } catch (e) { /* dataURL 同源不会被 taint，异常时按不透明处理 */ }
        let out;
        if (hasAlpha) {
          // 含透明：用 PNG 保留 alpha，超限则缩小画布直至 ≤300KB
          out = canvas.toDataURL('image/png');
          while (out.length > 400000 && size > 32) {
            size = Math.max(32, Math.floor(size * 0.8));
            canvas.width = size; canvas.height = size;
            ctx.clearRect(0, 0, size, size);
            ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
            out = canvas.toDataURL('image/png');
          }
        } else {
          // 不透明：JPEG 压缩到 300KB 内
          let quality = 0.92;
          out = canvas.toDataURL('image/jpeg', quality);
          while (out.length > 400000 && quality > 0.3) {   // base64 约 400000 字符 ≈ 300KB
            quality -= 0.1;
            out = canvas.toDataURL('image/jpeg', quality);
          }
          if (out.length > 400000) out = canvas.toDataURL('image/png');
        }
        resolve(out);
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/* 输入框 / 下拉：change 即写回 state 并重绘（全局函数，供 initEvents 内事件处理器与 openDropdown 复用） */
function commitChange(arr, value) {
  const key = arr[arr.length - 1];
  /* 子路径提交：
     子文件夹编辑“完整路径”（以 '/' 开头）时直接采用，由 autoParent 按前缀重新识别父级；
     仅当输入为相对片段（不以 '/' 开头，如叶子文件名）时才补回父级完整前缀 */
  if (key === 'text' && arr[0] === 'paths') {
    const p = getPath(arr[1]);
    if (p && p.parent && typeof value === 'string' && !value.startsWith('/')) {
      let pf = fullPathOf(p.parent);
      if (pf && !pf.endsWith('/')) pf += '/';
      if (!value.startsWith(pf)) value = pf + value;
    }
    /* 重命名不允许与已有路径（除自身）完全相同：完整路径唯一 */
    if (p) {
      const v = typeof value === 'string' ? value.trim() : value;
      if (state.paths.some(q => q.id !== p.id && q.text === v)) {
        showToast('路径已存在，不能重复');
        render();                 // 重建输入框为原 state 值，避免显示成重复内容
        return;                   // 不写回 state、不重排、不重算父子
      }
      value = v;
    }
  }
  if (arr[0] === 'records' && arr[2] === 'custom') { const rec = getRecord(arr[1]); if (rec) rec.custom = rec.custom || {}; }
  setByPath(arr, value);
  if (key === 'text' && arr[0] === 'paths') autoParent(arr[1]); // 路径文本变化：按前缀自动识别父子
  render();
}

/* 自绘下拉：双击 .dd 直接弹出菜单 */
function openDropdown(dd) {
  closeCtxMenu();
  const opts = dd.dataset.options.split('|');
  const cur = dd.dataset.value;
  const rect = dd.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu dd-menu';
  menu.style.minWidth = rect.width + 'px';
  menu.style.left = '-9999px';
  menu.style.top = '-9999px';
  menu.innerHTML = opts.map(o => `<div class="ctx-item${o === cur ? ' active' : ''}" data-v="${esc(o)}">${esc(o)}</div>`).join('');
  document.body.appendChild(menu);
  /* 边界处理：最后一行向下展开会超出窗口，则改为向上展开；整体不超出窗口 */
  const mr = menu.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = Math.min(rect.left, vw - mr.width - 8);
  if (left < 8) left = 8;
  let top;
  if (rect.bottom + 4 + mr.height > vh && rect.top - 4 - mr.height >= 0) top = rect.top - 4 - mr.height;
  else top = rect.bottom + 4;
  if (top < 8) top = 8;
  if (top + mr.height > vh) top = Math.max(8, vh - mr.height - 8);
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  const close = () => { menu.remove(); document.removeEventListener('mousedown', outside, true); };
  const outside = (ev) => { if (!menu.contains(ev.target)) close(); };
  document.addEventListener('mousedown', outside, true);
  menu.querySelectorAll('.ctx-item').forEach(it => it.addEventListener('mousedown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    close();
    commitChange(parr(dd.dataset.path), it.dataset.v);
  }));
}

/* ---------- 长按拖动排序（路径 / 空间） ---------- */
let reorder = null;
function allPathGrips() {
  return Array.from(document.querySelectorAll('.path-node .grip-inline'));
}
function beginReorder(grip) {
  hidePathTip();
  hideConnEditor();
  const type = grip.dataset.reorder;
  /* 路径：跨父子自由重排（整条路径列表为一条序列，可拖到任意位置） */
  if (type === 'path') {
    const pid = grip.dataset.pathId;
    const srcEl = document.querySelector(`.path-node[data-path-id="${pid}"]`);
    if (!srcEl) return;
    const rect = srcEl.getBoundingClientRect();
    const ghost = srcEl.cloneNode(true);
    ghost.classList.add('reorder-ghost');
    ghost.style.position = 'fixed'; ghost.style.margin = '0'; ghost.style.willChange = 'transform';
    ghost.style.width = rect.width + 'px'; ghost.style.height = rect.height + 'px';
    ghost.style.left = rect.left + 'px'; ghost.style.top = rect.top + 'px';
    ghost.style.pointerEvents = 'none'; ghost.style.zIndex = 300;
    document.body.appendChild(ghost);
    grip.classList.add('reordering');
    const gr = grip.getBoundingClientRect();
    const offX = gr.left - rect.left;
    const offY = gr.top - rect.top + gr.height / 2;
    reorder = { type, id: pid, pid, ghost, srcEl, lastY: rect.top + rect.height / 2, srcRect: rect };
    let raf = 0;
    const tick = () => { raf = 0; drawReorderPreview('path', pid, reorder.lastY, pid); };
    const move = (e) => {
      ghost.style.transform = `translate3d(${e.clientX - offX - rect.left}px, ${e.clientY - offY - rect.top}px, 0)`;
      reorder.lastY = e.clientY;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const up = () => {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      ghost.remove(); clearReorderPreview();
      const lastY = reorder.lastY; reorder = null;
      const targetEl = reorderTargetEl('path', pid, lastY, pid);
      if (targetEl) reorderPathFlat(pid, targetEl.dataset.pathId);
      else reorderPathFlat(pid, null);
      render();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    return;
  }
  /* 空间：整行拖动排序 */
  const id = grip.dataset.spaceId;
  const list = state.spaces;
  const index = list.findIndex(x => x.id === id);
  const srcEl = document.querySelector(`.row[data-space-row="${id}"]`);
  if (!srcEl || index < 0) return;
  const rect = srcEl.getBoundingClientRect();
  const ghost = srcEl.cloneNode(true);
  ghost.classList.add('reorder-ghost');
  ghost.style.position = 'fixed'; ghost.style.margin = '0'; ghost.style.willChange = 'transform';
  ghost.style.width = rect.width + 'px'; ghost.style.height = rect.height + 'px';
  ghost.style.left = rect.left + 'px'; ghost.style.top = rect.top + 'px';
  ghost.style.pointerEvents = 'none'; ghost.style.zIndex = 300;
  document.body.appendChild(ghost);
  grip.classList.add('reordering');
  const gr = grip.getBoundingClientRect();
  const offX = gr.left - rect.left;
  const offY = gr.top - rect.top + gr.height / 2;
  reorder = { type, id, index, ghost, srcEl, lastY: rect.top + rect.height / 2, srcRect: rect };
  let raf = 0;
  const tick = () => { raf = 0; drawReorderPreview(type, id, reorder.lastY, id); };
  const move = (e) => {
    ghost.style.transform = `translate3d(${e.clientX - offX - rect.left}px, ${e.clientY - offY - rect.top}px, 0)`;
    reorder.lastY = e.clientY;
    if (!raf) raf = requestAnimationFrame(tick);
  };
  const up = () => {
    if (raf) cancelAnimationFrame(raf);
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    ghost.remove(); clearReorderPreview();
    const targetEl = reorderTargetEl(type, id, reorder.lastY, id);
    const cur = reorder.index;
    let target;
    if (targetEl) target = list.findIndex(x => x.id === targetEl.dataset.spaceRow);
    else target = list.length;
    reorder = null;
    if (target != null && target !== cur && target !== cur + 1) {
      const [item] = list.splice(cur, 1);
      const t = target > cur ? target - 1 : target;
      list.splice(t, 0, item);
    }
    render();
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}
/* 拖拽重排落点判定：返回应插到其“之前”的元素，null 表示末尾 */
function reorderEls(type, id, excludePid) {
  const grips = type === 'path' ? allPathGrips() : Array.from(document.querySelectorAll(`[data-reorder="${type}"]`));
  const els = grips.map(g => type === 'path' ? g.closest('.path-node') : (g.closest('.row[data-space-row]') || g));
  let out = els.filter(Boolean);
  if (excludePid != null) out = out.filter(el => (el.dataset.pathId || el.dataset.spaceRow) !== excludePid);
  return out;
}
function reorderTargetEl(type, id, y, excludePid) {
  const els = reorderEls(type, id, excludePid);
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (y < r.top + r.height / 2) return el;
  }
  return null;
}
function drawReorderPreview(type, id, y, excludePid) {
  clearReorderPreview();
  if (!reorder || !reorder.srcRect) return;
  const sr = reorder.srcRect;
  const els = reorderEls(type, id, excludePid);
  if (!els.length) return;
  let idx = els.length;
  for (let i = 0; i < els.length; i++) {
    const r = els[i].getBoundingClientRect();
    if (y < r.top + r.height / 2) { idx = i; break; }
  }
  const ph = getGap();
  ph.style.height = sr.height + 'px';
  ph.textContent = '放置到此处';
  const ref = idx < els.length ? els[idx] : els[els.length - 1];
  const c = ref.parentElement;
  if (idx < els.length) c.insertBefore(ph, ref);
  else c.insertBefore(ph, ref.nextSibling);
  if (reorder.srcEl) reorder.srcEl.classList.add('dragging-ghost');
}
let _ph = null;
function getGap() {
  if (!_ph) { _ph = document.createElement('div'); _ph.className = 'reorder-gap'; }
  _ph.style.display = '';
  return _ph;
}
function clearReorderPreview() {
  if (_ph && _ph.parentElement) _ph.parentElement.removeChild(_ph);
  if (_ph) _ph.style.display = 'none';
  if (reorder && reorder.srcEl) reorder.srcEl.classList.remove('dragging-ghost');
}

/* 上传图标：居中裁 1:1，压缩到 400KB 以内，转 base64 */
function compressIcon(file, cb) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const size = Math.min(img.width, img.height);
      const sx = (img.width - size) / 2, sy = (img.height - size) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, size, size, 0, 0, 256, 256);
      let q = 0.92, url = canvas.toDataURL('image/jpeg', q);
      while (url.length > 400 * 1024 && q > 0.3) { q -= 0.05; url = canvas.toDataURL('image/jpeg', q); }
      cb(url);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

/* 路径父链浮层已移除：路径悬停改用原生 title 显示相连空间名称；保留 hidePathTip 供拖拽/重排时清理 */
let tipEl = null;
function hidePathTip() { if (tipEl) { tipEl.remove(); tipEl = null; } }
