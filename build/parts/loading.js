/* ================= 装柜计算模块（lg 前缀，独立作用域） ================= */
(function () {
  'use strict';

  var VEHICLES = {
    container: [
      { key: '20GP', name: "20'GP", en: 'STANDARD', w: 235, h: 239, d: 589, maxWeight: 28000, vol: 33.2 },
      { key: '40GP', name: "40'GP", en: 'STANDARD', w: 235, h: 239, d: 1203, maxWeight: 26000, vol: 67.7 },
      { key: '40HQ', name: "40'HQ", en: 'HIGH CUBE', w: 235, h: 269, d: 1203, maxWeight: 26000, vol: 76.3 },
      { key: '45HQ', name: "45'HQ", en: 'HIGH CUBE', w: 235, h: 269, d: 1355, maxWeight: 25000, vol: 86.0 }
    ],
    truck: [
      { key: '4.2m', name: '4.2m', en: 'TRUCK', w: 190, h: 190, d: 420, maxWeight: 5000, vol: 15.2 },
      { key: '5.2m', name: '5.2m', en: 'TRUCK', w: 210, h: 210, d: 520, maxWeight: 8000, vol: 22.9 },
      { key: '6.8m', name: '6.8m', en: 'TRUCK', w: 230, h: 230, d: 680, maxWeight: 10000, vol: 36.0 },
      { key: '7.6m', name: '7.6m', en: 'TRUCK', w: 230, h: 230, d: 760, maxWeight: 12000, vol: 40.2 }
    ]
  };
  var COLORS = ['#1d3557', '#b08d57', '#2f5d50', '#7a2e2e', '#4a5568', '#8c6b4f', '#3d5a80', '#6b7280'];
  var PACK = { none: 0, foam: 1, epo: 3, divider: 2 };
  var PACK_LABEL = { none: '无', foam: '气泡膜', epo: '珍珠棉', divider: '隔板' };
  var COS = Math.cos(Math.PI / 9), SIN = Math.sin(Math.PI / 9);
  var LS_KEY = 'ft_loading_state';

  var state = {
    tab: 'container', model: '40HQ', items: [], nextId: 1,
    results: [], stats: null, scale: 1, ox: 0, oy: 0,
    drag: false, lx: 0, ly: 0, transparent: false
  };
  var view = { w: 0, h: 0, dpr: 1 };
  var canvas = null, ctx = null, calcTimer = null;

  function $(s) { return document.querySelector(s); }
  function $$(s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function num(v) { var n = parseFloat(v); return isFinite(n) && n > 0 ? n : 0; }
  function vehicle() {
    var list = VEHICLES[state.tab];
    for (var i = 0; i < list.length; i++) if (list[i].key === state.model) return list[i];
    return list[0];
  }
  function itemById(id) {
    for (var i = 0; i < state.items.length; i++) if (String(state.items[i].id) === String(id)) return state.items[i];
    return null;
  }
  function lgToast(msg, icon) {
    if (typeof window.showToast === 'function') { window.showToast(msg, icon || 'ok'); return; }
    console.log('[LG]', msg);
  }

  function newItem(over) {
    var base = {
      id: state.nextId++, name: '货物', l: 60, w: 40, h: 40, qty: 100,
      net: 12, tare: 1, pcsCtn: 10,
      packType: 'none', packMode: 'thick', packThick: 0, packRate: 0,
      stackLayers: 0, stackLoad: 0,
      dir: 'any', fragile: false,
      gapType: 'standard', gapL: 0, gapW: 0, gapH: 0,
      usePallet: false, palletL: 120, palletW: 100, palletWeight: 20,
      _adv: false
    };
    if (over) for (var k in over) if (Object.prototype.hasOwnProperty.call(over, k)) base[k] = over[k];
    return base;
  }

  function demoItems() {
    state.nextId = 1;
    return [
      newItem({ name: 'Smart Watch X1', l: 46, w: 32, h: 28, qty: 600, net: 14, tare: 1, pcsCtn: 20 }),
      newItem({ name: 'Bluetooth Speaker S2', l: 60, w: 40, h: 40, qty: 120, net: 22, tare: 2, pcsCtn: 10 }),
      newItem({ name: 'Accessory Kit', l: 40, w: 30, h: 20, qty: 90, net: 6, tare: 0.5, pcsCtn: 50, dir: 'up' })
    ];
  }

  /* ---------------- 包装 / 重量建模 ---------------- */
  function lgEffDims(it) {
    var l = num(it.l), w = num(it.w), h = num(it.h);
    if (it.packMode === 'rate') {
      var r = Math.min(0.9, Math.max(0, num(it.packRate) / 100));
      var s = Math.cbrt(1 / (1 - r));
      return { l: l * s, w: w * s, h: h * s };
    }
    var th = Math.max(0, num(it.packThick));
    return { l: l + 2 * th, w: w + 2 * th, h: h + 2 * th };
  }
  function lgGross(it) {
    return num(it.net) + num(it.tare) + (it.usePallet ? num(it.palletWeight) : 0);
  }
  function lgRotations(l, w, h, dir) {
    var rots = [];
    if (dir === 'fixed') rots.push({ w: l, h: h, d: w });
    else if (dir === 'up') { rots.push({ w: l, h: h, d: w }); rots.push({ w: w, h: h, d: l }); }
    else if (dir === 'side') {
      rots.push({ w: l, h: w, d: h }); rots.push({ w: h, h: w, d: l });
      rots.push({ w: w, h: l, d: h }); rots.push({ w: h, h: l, d: w });
    } else {
      rots.push({ w: l, h: h, d: w }); rots.push({ w: l, h: w, d: h });
      rots.push({ w: w, h: h, d: l }); rots.push({ w: w, h: l, d: h });
      rots.push({ w: h, h: l, d: w }); rots.push({ w: h, h: w, d: l });
    }
    var out = [], seen = {};
    for (var i = 0; i < rots.length; i++) {
      var k = rots[i].w + '-' + rots[i].h + '-' + rots[i].d;
      if (!seen[k]) { seen[k] = 1; out.push(rots[i]); }
    }
    return out;
  }

  /* ---------------- 渲染 ---------------- */
  function lgRenderVehicles() {
    var list = VEHICLES[state.tab];
    $('#lgVehicles').innerHTML = list.map(function (v) {
      return '<button class="lg-vehicle ' + (v.key === state.model ? 'is-on' : '') + '" data-veh="' + v.key + '" title="' + v.name + ' · 内尺寸 ' + (v.w / 100).toFixed(2) + '×' + (v.h / 100).toFixed(2) + '×' + (v.d / 100).toFixed(2) + ' m">' +
        '<b>' + esc(v.name) + '</b><span>' + v.en + '</span></button>';
    }).join('');
    $('#lgVsub').textContent = state.tab === 'container' ? '标准柜 · 内尺寸' : '厢式货车 · 内尺寸';
    var v = vehicle();
    $('#lgVinfo').innerHTML =
      '<div title="宽 × 高 × 长">内尺寸 m<b>' + (v.w / 100).toFixed(2) + ' × ' + (v.h / 100).toFixed(2) + ' × ' + (v.d / 100).toFixed(2) + '</b></div>' +
      '<div>容积 m³<b>' + v.vol.toFixed(1) + '</b></div>' +
      '<div>限重 t<b>' + (v.maxWeight / 1000).toFixed(1) + '</b></div>';
  }

  function lgField(f, label, val, unit, step) {
    return '<label class="lg-field"><span>' + label + '</span><i class="lg-iw">' +
      '<input type="number" class="lg-input" data-field="' + f + '" value="' + val + '" min="0" step="' + (step || '1') + '">' +
      '<em>' + (unit || '') + '</em></i></label>';
  }

  function lgHint(it) {
    var d = lgEffDims(it), g = lgGross(it);
    var vol = d.l * d.w * d.h / 1000000;
    var pallet = it.usePallet
      ? ' · <b>整托</b> ' + it.palletL + '×' + it.palletW + '，货高 +15cm，毛重含托盘 ' + num(it.palletWeight).toFixed(1) + 'kg'
      : '';
    return '毛重 <b>' + g.toFixed(2) + '</b> kg/箱 · 外尺寸 <b>' + d.l.toFixed(1) + '×' + d.w.toFixed(1) + '×' + d.h.toFixed(1) + '</b> cm · 单箱 <b>' + vol.toFixed(3) + '</b> m³' + pallet;
  }

  function lgCard(it, idx) {
    var d = lgEffDims(it);
    var packBlock =
      '<div class="lg-field"><span>包装填充（四周）</span><div class="lg-chips">' +
      Object.keys(PACK).map(function (k) {
        return '<button data-act="pack" data-val="' + k + '" class="' + (it.packType === k ? 'is-on' : '') + '">' + PACK_LABEL[k] + '<small>+' + PACK[k] + '</small></button>';
      }).join('') + '</div></div>' +
      '<div class="lg-grid lg-grid-2">' +
      '<label class="lg-field"><span>计费方式</span><div class="lg-seg">' +
      '<button data-act="packmode" data-val="thick" class="' + (it.packMode === 'thick' ? 'is-on' : '') + '">厚度</button>' +
      '<button data-act="packmode" data-val="rate" class="' + (it.packMode === 'rate' ? 'is-on' : '') + '">填充率</button>' +
      '</div></label>' +
      (it.packMode === 'thick'
        ? lgField('packThick', '单边厚度', it.packThick, 'cm', '0.5')
        : lgField('packRate', '填充率', it.packRate, '%', '1')) +
      '</div>';

    var stackBlock =
      '<div class="lg-grid lg-grid-2">' +
      lgField('stackLayers', '最大堆码层数', it.stackLayers, '层') +
      lgField('stackLoad', '单箱承压', it.stackLoad, 'kg') +
      '</div>';

    var dirBlock =
      '<label class="lg-field"><span>摆放方向</span><div class="lg-seg">' +
      '<button data-act="dir" data-val="any" class="' + (it.dir === 'any' ? 'is-on' : '') + '" title="六个方向都可翻转">任意</button>' +
      '<button data-act="dir" data-val="up" class="' + (it.dir === 'up' ? 'is-on' : '') + '" title="只能竖放，不可倒置">竖放</button>' +
      '<button data-act="dir" data-val="side" class="' + (it.dir === 'side' ? 'is-on' : '') + '" title="只能横放">横放</button>' +
      '<button data-act="dir" data-val="fixed" class="' + (it.dir === 'fixed' ? 'is-on' : '') + '" title="长宽高固定，不旋转">固定</button>' +
      '</div></label>' +
      '<div class="lg-switch-row"><span>易碎品（锁定竖放）</span><button class="lg-switch ' + (it.fragile ? 'is-on' : '') + '" data-act="fragile" aria-label="易碎品"></button></div>';

    var gapBlock =
      '<div class="lg-field"><span>装载间隙（箱与箱之间）</span><div class="lg-chips">' +
      '<button data-act="gap" data-val="standard" class="' + (it.gapType === 'standard' ? 'is-on' : '') + '">标准<small>+0</small></button>' +
      '<button data-act="gap" data-val="swell" class="' + (it.gapType === 'swell' ? 'is-on' : '') + '">防涨<small>+1/+2</small></button>' +
      '<button data-act="gap" data-val="wood" class="' + (it.gapType === 'wood' ? 'is-on' : '') + '">木架<small>+3</small></button>' +
      '</div></div>' +
      '<div class="lg-grid lg-grid-3">' +
      lgField('gapL', '长向', it.gapL, 'cm', '0.5') +
      lgField('gapW', '宽向', it.gapW, 'cm', '0.5') +
      lgField('gapH', '高向', it.gapH, 'cm', '0.5') +
      '</div>';

    var palletBlock =
      '<div class="lg-switch-row"><span>按整托装载（长宽用托盘尺寸）</span><button class="lg-switch ' + (it.usePallet ? 'is-on' : '') + '" data-act="pallet" aria-label="整托"></button></div>' +
      (it.usePallet ? '<div class="lg-grid lg-grid-3">' +
        lgField('palletL', '托盘长', it.palletL, 'cm') +
        lgField('palletW', '托盘宽', it.palletW, 'cm') +
        lgField('palletWeight', '托盘重', it.palletWeight, 'kg') +
        '</div>' : '');

    return '<div class="lg-cargo" data-id="' + it.id + '">' +
      '<div class="lg-cargo-head">' +
      '<span class="lg-no">' + (idx + 1) + '</span>' +
      '<input class="lg-name" data-field="name" value="' + esc(it.name) + '" placeholder="品名 / 货物名称">' +
      (state.items.length > 1 ? '<button class="lg-del" data-act="del" title="删除这种货物">✕</button>' : '') +
      '</div>' +
      '<div class="lg-cargo-body">' +
      '<div class="lg-grid lg-grid-3">' +
      lgField('l', '长', it.l, 'cm', '0.5') +
      lgField('w', '宽', it.w, 'cm', '0.5') +
      lgField('h', '高', it.h, 'cm', '0.5') +
      '</div>' +
      '<div class="lg-grid lg-grid-3">' +
      lgField('qty', '数量', it.qty, '箱') +
      lgField('net', '净重/箱', it.net, 'kg', '0.01') +
      lgField('tare', '皮重/箱', it.tare, 'kg', '0.01') +
      '</div>' +
      '<div class="lg-grid lg-grid-2">' +
      lgField('pcsCtn', '每箱数量（单证用）', it.pcsCtn, 'pcs') +
      '<label class="lg-field"><span>毛重/箱</span><i class="lg-iw"><input value="' + lgGross(it).toFixed(2) + '" disabled style="background:#f7f6f3;color:#6b7280"><em>kg</em></i></label>' +
      '</div>' +
      '<div class="lg-hint" data-hint="' + it.id + '">' + lgHint(it) + '</div>' +
      '<details class="lg-adv" ' + (it._adv ? 'open' : '') + '><summary>包装 · 堆码 · 摆放 · 间隙 · 托盘</summary>' +
      '<div class="lg-adv-body">' + packBlock + stackBlock + dirBlock + gapBlock + palletBlock + '</div></details>' +
      '</div></div>';
  }

  function lgRenderCargo() {
    $('#lgCargoList').innerHTML = state.items.map(lgCard).join('');
    lgRenderLegend();
  }

  function lgRenderLegend() {
    var items = state.items.filter(function (it) { return num(it.qty) > 0; });
    if (!items.length) { $('#lgLegend').innerHTML = ''; return; }
    $('#lgLegend').innerHTML = items.map(function (it, i) {
      return '<span><i style="background:' + COLORS[i % COLORS.length] + '"></i>' + esc(it.name || ('货物 #' + (i + 1))) + '</span>';
    }).join('');
  }

  function lgUpdateHint(it) {
    var box = document.querySelector('.lg-hint[data-hint="' + it.id + '"]');
    if (box) box.innerHTML = lgHint(it);
  }

  function lgSync() {
    $$('#lgCargoList .lg-cargo').forEach(function (card) {
      var it = itemById(card.dataset.id);
      if (!it) return;
      $$('.lg-input', card).forEach(function (inp) {
        var f = inp.dataset.field;
        if (!f) return;
        if (f === 'name') { it.name = inp.value; return; }
        var n = parseFloat(inp.value);
        if (!isFinite(n) || n < 0) n = 0;
        if (f === 'qty' || f === 'stackLayers' || f === 'pcsCtn') n = Math.floor(n);
        it[f] = n;
      });
    });
  }

  /* ---------------- 排布引擎（整排整层堆码） ---------------- */
  function lgCalc() {
    lgSync();
    var v = vehicle();
    var containerVol = v.w * v.h * v.d;
    var placed = [];
    var packedWeight = 0, packedVolume = 0, usedVolume = 0;
    var attempted = 0, packed = 0, capped = false;
    var totalW = 0, momX = 0;
    var cursor = 0;
    var weightFull = false, spaceFull = false;

    var groups = [];
    state.items.forEach(function (it, idx) {
      var qty = Math.max(0, Math.floor(num(it.qty)));
      if (qty <= 0) return;
      var d = lgEffDims(it);
      if (!(d.l > 0 && d.w > 0 && d.h > 0)) return;
      var n = Math.min(qty, 2000);
      if (n < qty) capped = true;
      attempted += n;
      groups.push({
        item: it, qty: n, dims: d, gross: lgGross(it),
        color: COLORS[idx % COLORS.length],
        name: it.name || ('货物 #' + (idx + 1)),
        dir: it.fragile ? 'up' : it.dir,
        gapL: num(it.gapL), gapW: num(it.gapW), gapH: num(it.gapH),
        usePallet: !!it.usePallet,
        palletL: num(it.palletL), palletW: num(it.palletW),
        maxLayers: Math.floor(num(it.stackLayers)),
        maxLoad: num(it.stackLoad),
        vol: d.l * d.w * d.h
      });
    });
    // 体积大的先占位：先立大块，再用小块补末端
    groups.sort(function (a, b) { return b.vol - a.vol; });

    groups.forEach(function (g) {
      if (weightFull || spaceFull) return;
      var rotations = g.usePallet
        ? [{ w: g.palletL, h: g.dims.h + 15, d: g.palletW }]
        : lgRotations(g.dims.l, g.dims.w, g.dims.h, g.dir);

      var bestO = null;
      rotations.forEach(function (rot) {
        var bw = rot.w + (g.usePallet ? 0 : g.gapL);
        var bh = rot.h + (g.usePallet ? 0 : g.gapH);
        var bd = rot.d + (g.usePallet ? 0 : g.gapW);
        var nx = Math.floor((v.w + 1e-6) / bw);
        var ny = Math.floor((v.h + 1e-6) / bh);
        if (g.maxLayers > 0 && ny > g.maxLayers) ny = g.maxLayers;
        // 单箱承压：按整列均压保守估算可堆层数
        if (g.maxLoad > 0 && g.gross > 0) {
          var nyLoad = Math.floor(g.maxLoad / g.gross) + 1;
          if (ny > nyLoad) ny = nyLoad;
        }
        if (nx < 1 || ny < 1) return;
        var per = nx * ny;
        var rows = Math.ceil(g.qty / per);
        var need = rows * bd;
        var o = { rot: rot, bw: bw, bh: bh, bd: bd, nx: nx, ny: ny, per: per, rows: rows, need: need };
        if (!bestO || o.need < bestO.need - 1e-6 ||
            (Math.abs(o.need - bestO.need) < 1e-6 && (o.per > bestO.per || (o.per === bestO.per && o.bh > bestO.bh)))) {
          bestO = o;
        }
      });

      if (!bestO) {
        spaceFull = true;
        return;
      }

      var xBase = Math.max(0, (v.w - bestO.nx * bestO.bw) / 2);
      var remain = g.qty;
      var row = 0;
      var groupStart = cursor;

      while (remain > 0 && !weightFull && !spaceFull) {
        var z0 = groupStart + row * bestO.bd;
        if (z0 + bestO.bd > v.d + 1e-6) { spaceFull = true; break; }

        for (var l = 0; l < bestO.ny && remain > 0 && !weightFull; l++) {
          for (var c = 0; c < bestO.nx && remain > 0; c++) {
            if (packedWeight + g.gross > v.maxWeight + 1e-6) { weightFull = true; break; }
            var x = xBase + c * bestO.bw;
            var y = l * bestO.bh;
            placed.push({
              x: x, y: y, z: z0,
              w: bestO.rot.w, h: bestO.rot.h, d: bestO.rot.d,
              bw: bestO.bw, bh: bestO.bh, bd: bestO.bd,
              color: g.color, name: g.name, usePallet: g.usePallet,
              gross: g.gross, layers: l + 1, load: 0,
              itemId: g.item.id, row: row, col: c
            });
            packedWeight += g.gross;
            packedVolume += g.vol;
            usedVolume += bestO.bw * bestO.bh * bestO.bd;
            totalW += g.gross;
            momX += g.gross * (x + bestO.bw / 2);
            packed++;
            remain--;
          }
        }
        row++;
        if (weightFull) break;
      }

      if (!weightFull && !spaceFull) {
        cursor = groupStart + row * bestO.bd;
      } else if (!weightFull) {
        cursor = groupStart + row * bestO.bd;
      }
      if (cursor > v.d) cursor = v.d;
    });

    if (weightFull) {
      cursor = v.d;
    }

    // 标记每列最上层：只有暴露在外的顶面才绘制，避免等轴测下的内层接缝
    var colTop = {};
    placed.forEach(function (p) {
      var k = Math.round(p.x * 10) + ',' + Math.round(p.z * 10);
      colTop[k] = Math.max(colTop[k] || 0, p.layers);
    });
    placed.forEach(function (p) {
      var k = Math.round(p.x * 10) + ',' + Math.round(p.z * 10);
      p.topVisible = p.layers === colTop[k];
    });

    // 压力：同一列（x,z）上所有箱体重量压在底层
    var columns = {};
    placed.forEach(function (p) {
      var k = Math.round(p.x * 10) + ',' + Math.round(p.z * 10);
      if (!columns[k]) columns[k] = { area: p.bw * p.bd, weight: 0 };
      columns[k].weight += p.gross;
    });
    var maxPressure = 0;
    Object.keys(columns).forEach(function (k) {
      var col = columns[k];
      var pr = col.weight * 9.80665 / (col.area / 10000) / 1000;
      if (pr > maxPressure) maxPressure = pr;
    });

    var blocked = attempted - packed;
    var weightBlocked = weightFull ? blocked : 0;
    var spaceBlocked = weightFull ? 0 : blocked;

    var usage = containerVol > 0 ? usedVolume / containerVol * 100 : 0;
    var sat = v.maxWeight > 0 ? packedWeight / v.maxWeight * 100 : 0;
    var cg = totalW > 0 ? ((momX / totalW) - v.w / 2) / v.w * 100 : 0;
    var totalCbm = 0, totalGw = 0;
    state.items.forEach(function (it) {
      var d = lgEffDims(it);
      totalCbm += d.l * d.w * d.h * num(it.qty) / 1000000;
      totalGw += lgGross(it) * num(it.qty);
    });
    var nEst = Math.max(1,
      Math.ceil(totalCbm / (v.vol * 0.85) - 1e-9),
      Math.ceil(totalGw / (v.maxWeight * 0.9) - 1e-9));

    state.results = placed;
    state.stats = {
      usage: usage, sat: sat, remain: Math.max(0, v.maxWeight - packedWeight),
      cg: cg, pressure: maxPressure, packed: packed, attempted: attempted,
      weightBlocked: weightBlocked, spaceBlocked: spaceBlocked, capped: capped,
      cbm: packedVolume / 1000000, gw: packedWeight, totalCbm: totalCbm, totalGw: totalGw,
      nEst: nEst, depthUse: cursor / v.d * 100
    };

    lgPaintStats();
    lgRenderSteps();
    lgDraw();
    lgSave();
  }

  function lgSetStat(id, val, digits) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function lgPaintStats() {
    var s = state.stats;
    if (!s) return;
    lgSetStat('lgStatVol', s.cbm.toFixed(2));
    lgSetStat('lgStatGw', s.gw.toFixed(2));
    lgSetStat('lgStatUse', s.usage.toFixed(2));
    lgSetStat('lgStatQty', s.packed + ' / ' + s.attempted);
    lgSetStat('lgStatSat', s.sat.toFixed(2));
    lgSetStat('lgStatRemain', s.remain.toFixed(2));
    lgSetStat('lgStatCg', (s.cg >= 0 ? '+' : '') + s.cg.toFixed(2));
    lgSetStat('lgStatPress', s.pressure.toFixed(2));

    $('#lgCardSat').className = 'lg-stat' + (s.sat >= 90 ? ' is-danger' : s.sat >= 70 ? ' is-warn' : '');
    $('#lgCardRemain').className = 'lg-stat' + (s.sat >= 90 ? ' is-danger' : '');
    $('#lgCardCg').className = 'lg-stat' + (Math.abs(s.cg) > 20 ? ' is-danger' : Math.abs(s.cg) > 10 ? ' is-warn' : '');
    $('#lgCardUse').className = 'lg-stat' + (s.usage >= 90 ? ' is-warn' : '');
    $('#lgCardQty').className = 'lg-stat' + (s.packed < s.attempted ? ' is-danger' : '');

    var v = vehicle();
    $('#lgEst').innerHTML = '粗算整柜：<b>' + s.nEst + '</b> × ' + esc(v.name) +
      '（体积按 ' + (v.vol * 0.85).toFixed(1) + ' m³ 可用、载重按 90%）' +
      ' · 本柜占长 ' + s.depthUse.toFixed(0) + '%' +
      (s.capped ? ' · 单次模拟每种最多 2000 箱' : '');

    var tip = $('#lgTip'), msg = '', cls = 'lg-tip';
    if (s.attempted === 0) msg = '填好尺寸、数量后自动计算';
    else if (s.weightBlocked > 0) { msg = '超重：' + s.weightBlocked + ' 箱未装（' + s.sat.toFixed(1) + '%）'; cls += ' is-danger'; }
    else if (s.spaceBlocked > 0) { msg = '空间不足：' + s.spaceBlocked + ' 箱未装'; cls += ' is-warn'; }
    else msg = '全部 ' + s.packed + ' 箱已装入';
    if (s.capped) msg += ' · 已截断模拟';
    tip.className = cls;
    tip.textContent = msg;
    $('#lgEmpty').style.display = s.packed > 0 ? 'none' : 'flex';
    $('#lgBtnToDocs').disabled = s.packed === 0;
  }

  function lgRenderSteps() {
    var s = state.stats;
    var list = state.results.slice(0, 80);
    $('#lgStepCount').textContent = s ? (s.packed + ' 箱' + (s.packed > 80 ? ' · 显示前 80' : '')) : '—';
    if (!list.length) {
      $('#lgSteps').innerHTML = '<div class="lg-steps-empty">计算后显示逐箱坐标与层数</div>';
      return;
    }
    $('#lgSteps').innerHTML = list.map(function (p, i) {
      return '<div class="lg-step"><b>' + (i + 1) + '</b><span><strong>' + esc(p.name) + '</strong> · 坐标 (' +
        p.x.toFixed(0) + ', ' + p.y.toFixed(0) + ', ' + p.z.toFixed(0) + ') · ' +
        p.w.toFixed(0) + '×' + p.h.toFixed(0) + '×' + p.d.toFixed(0) + ' cm · ' +
        p.gross.toFixed(2) + ' kg · 第 ' + p.layers + ' 层' + (p.usePallet ? ' · 整托' : '') + '</span></div>';
    }).join('');
  }

  /* ---------------- 等轴测画布 ---------------- */
  function lgResize() {
    var stage = $('#lgStage');
    if (!stage) return;
    var r = stage.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    view = { w: r.width, h: r.height, dpr: dpr };
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    canvas.style.width = r.width + 'px';
    canvas.style.height = r.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lgFit();
    lgDraw();
  }

  function lgFit() {
    var v = vehicle();
    var bboxW = (v.w + v.d) * COS;
    var bboxH = (v.w + v.d) * SIN + v.h;
    var s = Math.min((view.w - 40) / bboxW, (view.h - 36) / bboxH);
    state.scale = s > 0 ? s : 1;
    state.ox = -((v.w - v.d) * COS / 2) * state.scale;
    state.oy = -(((v.w + v.d) * SIN - v.h) / 2) * state.scale;
  }

  function lgProject(x, y, z) {
    return {
      x: (x - z) * COS * state.scale + view.w / 2 + state.ox,
      y: ((x + z) * SIN - y) * state.scale + view.h / 2 + state.oy
    };
  }

  function lgLine(x1, y1, z1, x2, y2, z2, color, dash) {
    var a = lgProject(x1, y1, z1), b = lgProject(x2, y2, z2);
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    if (dash) ctx.setLineDash([4, 4]);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    if (dash) ctx.setLineDash([]);
  }

  function lgShade(hex, pct) {
    var n = parseInt(hex.replace('#', ''), 16);
    var amt = Math.round(2.55 * pct);
    var R = Math.min(255, (n >> 16) + amt), G = Math.min(255, ((n >> 8) & 255) + amt), B = Math.min(255, (n & 255) + amt);
    return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
  }
  function lgDark(hex, pct) {
    var n = parseInt(hex.replace('#', ''), 16);
    var amt = Math.round(2.55 * pct);
    var R = Math.max(0, (n >> 16) - amt), G = Math.max(0, ((n >> 8) & 255) - amt), B = Math.max(0, (n & 255) - amt);
    return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
  }

  function lgBox(x, y, z, w, h, d, color, isCtn, stroke, alpha, edgeLeft, topVisible) {
    var p0 = lgProject(x, y, z), p1 = lgProject(x + w, y, z);
    var p2 = lgProject(x + w, y, z + d), p3 = lgProject(x, y, z + d);
    var p4 = lgProject(x, y + h, z), p5 = lgProject(x + w, y + h, z);
    var p6 = lgProject(x + w, y + h, z + d), p7 = lgProject(x, y + h, z + d);

    ctx.globalAlpha = alpha;
    ctx.lineWidth = isCtn ? 1.2 : 0.7;
    ctx.strokeStyle = isCtn ? '#c9c6c0' : 'rgba(20,23,26,.13)';

    function seal(fill) {
      ctx.fillStyle = fill; ctx.fill();
      if (!isCtn) { ctx.strokeStyle = fill; ctx.lineWidth = 1; ctx.stroke(); }
      else if (stroke) { ctx.strokeStyle = '#c9c6c0'; ctx.stroke(); }
    }

    // 顶面：只画该列最上层，其他层的顶面被上层箱体覆盖
    if (topVisible || isCtn) {
      ctx.beginPath(); ctx.moveTo(p4.x, p4.y); ctx.lineTo(p5.x, p5.y); ctx.lineTo(p6.x, p6.y); ctx.lineTo(p7.x, p7.y); ctx.closePath();
      seal(isCtn ? 'rgba(255,255,255,.02)' : lgShade(color, 22));
    }

    // 左侧面：只画最左列
    if (edgeLeft || isCtn) {
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p3.x, p3.y); ctx.lineTo(p7.x, p7.y); ctx.lineTo(p4.x, p4.y); ctx.closePath();
      seal(isCtn ? 'rgba(255,255,255,.01)' : lgDark(color, 10));
    }

    // 正面
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p5.x, p5.y); ctx.lineTo(p4.x, p4.y); ctx.closePath();
    seal(isCtn ? 'rgba(255,255,255,.03)' : color);
    ctx.globalAlpha = 1;
  }

  function lgDraw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, view.w, view.h);
    if (!view.w) return;
    var v = vehicle();

    for (var x = 0; x <= v.w; x += 50) lgLine(x, 0, 0, x, 0, v.d, '#f0eeea');
    for (var z = 0; z <= v.d; z += 50) lgLine(0, 0, z, v.w, 0, z, '#f0eeea');

    lgBox(0, 0, 0, v.w, v.h, v.d, '#ffffff', true, false, 1);
    lgLine(0, 0, 0, v.w, 0, 0, '#c9c6c0');
    lgLine(v.w, 0, 0, v.w, 0, v.d, '#c9c6c0');
    lgLine(v.w, 0, v.d, 0, 0, v.d, '#c9c6c0');
    lgLine(0, 0, v.d, 0, 0, 0, '#c9c6c0');
    lgLine(0, v.h, 0, v.w, v.h, 0, '#d8d5cf', true);
    lgLine(v.w, v.h, 0, v.w, v.h, v.d, '#d8d5cf', true);
    lgLine(v.w, v.h, v.d, 0, v.h, v.d, '#d8d5cf', true);
    lgLine(0, v.h, v.d, 0, v.h, 0, '#d8d5cf', true);
    lgLine(0, 0, 0, 0, v.h, 0, '#c9c6c0');
    lgLine(v.w, 0, 0, v.w, v.h, 0, '#c9c6c0');
    lgLine(v.w, 0, v.d, v.w, v.h, v.d, '#c9c6c0');
    lgLine(0, 0, v.d, 0, v.h, v.d, '#c9c6c0');

    // 等轴测画家算法：按「到相机距离」由远及近绘制（x/y/z 同时增大即靠近观察者）
    // 同一列（同一 SKU、同一排、同一列位）的箱体合并成一个竖块，
    // 只画外露的顶面/正面/最左侧面，避免等轴测下逐箱绘制产生的接缝与透叠。
    var rowMax = {};
    state.results.forEach(function (p) {
      var rk = p.itemId + '|' + p.row;
      rowMax[rk] = Math.max(rowMax[rk] || 0, p.col);
    });
    var stacks = {};
    state.results.forEach(function (p) {
      var k = p.itemId + '|' + p.row + '|' + p.col;
      var st = stacks[k];
      if (!st) {
        st = stacks[k] = {
          x: p.x, z: p.z, w: p.bw, d: p.bd, h: p.y + p.h,
          color: p.color, edgeRight: p.col === rowMax[p.itemId + '|' + p.row]
        };
      } else {
        st.h = Math.max(st.h, p.y + p.h);
      }
    });
    var list = Object.keys(stacks).map(function (k) { return stacks[k]; });
    list.sort(function (a, b) { return (a.x + a.z + a.d / 2) - (b.x + b.z + b.d / 2); });

    var stroke = list.length <= 400;
    var total = list.length;
    for (var i = 0; i < total; i++) {
      var b = list[i];
      var alpha = 1;
      if (state.transparent && i > total * 0.25) alpha = 0.22;
      if (b.usePallet) { /* pallet base drawn separately if needed */ }
      lgBlock(b.x, 0, b.z, b.w, b.h, b.d, b.color, stroke, alpha, b.edgeRight);
    }
  }

  function lgBlock(x, y, z, w, h, d, color, stroke, alpha, edgeRight) {
    // 相机在 +X / +Z 方向：可见的是 max-Z（正面）与 max-X（右侧）两个侧面
    var p1 = lgProject(x + w, y, z);
    var p2 = lgProject(x + w, y, z + d);
    var p3 = lgProject(x, y, z + d);
    var p4 = lgProject(x, y + h, z);
    var p5 = lgProject(x + w, y + h, z);
    var p6 = lgProject(x + w, y + h, z + d);
    var p7 = lgProject(x, y + h, z + d);

    ctx.globalAlpha = alpha;
    ctx.lineWidth = 0.8;

    function seal(fill) {
      ctx.fillStyle = fill; ctx.fill();
      // 2px 同色描边盖住相邻多边形的抗锯齿缝
      ctx.strokeStyle = fill; ctx.lineWidth = 2; ctx.lineJoin = 'miter'; ctx.stroke();
    }

    // 顶面
    ctx.beginPath(); ctx.moveTo(p4.x, p4.y); ctx.lineTo(p5.x, p5.y); ctx.lineTo(p6.x, p6.y); ctx.lineTo(p7.x, p7.y); ctx.closePath();
    seal(lgShade(color, 22));

    // 右侧面（仅每排最右列）
    if (edgeRight) {
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p6.x, p6.y); ctx.lineTo(p5.x, p5.y); ctx.closePath();
      seal(lgDark(color, 12));
    }

    // 正面（max-Z）
    ctx.beginPath(); ctx.moveTo(p3.x, p3.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p6.x, p6.y); ctx.lineTo(p7.x, p7.y); ctx.closePath();
    seal(color);
    ctx.globalAlpha = 1;
  }

  /* ---------------- 保存 / 恢复 ---------------- */
  function lgSave() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        tab: state.tab, model: state.model,
        items: state.items.map(function (it) {
          var o = {};
          Object.keys(it).forEach(function (k) { if (k !== '_adv') o[k] = it[k]; });
          return o;
        })
      }));
    } catch (e) {}
  }
  function lgRestore() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return false;
      var data = JSON.parse(raw);
      if (!data || !data.items || !data.items.length) return false;
      state.tab = data.tab === 'truck' ? 'truck' : 'container';
      var list = VEHICLES[state.tab];
      state.model = list.some(function (v) { return v.key === data.model; }) ? data.model : list[0].key;
      state.items = data.items.map(function (it) {
        var base = newItem();
        for (var k in it) if (Object.prototype.hasOwnProperty.call(it, k)) base[k] = it[k];
        base.id = ++state.nextId;
        return base;
      });
      return true;
    } catch (e) { return false; }
  }

  /* ---------------- 交互 ---------------- */
  function lgAddItem() {
    lgSync();
    state.items.push(newItem({ name: '货物 ' + (state.items.length + 1) }));
    lgRenderCargo();
    var sc = $('#lgScroll');
    if (sc) sc.scrollTop = sc.scrollHeight;
    lgCalc();
  }

  function lgLoadDemo() {
    state.items = demoItems();
    lgRenderCargo();
    lgCalc();
  }

  function lgClear() {
    state.items = [newItem({ name: '货物 1' })];
    lgRenderCargo();
    lgCalc();
  }

  function lgBind() {
    document.querySelectorAll('.ws-tab').forEach(function (b) {
      b.addEventListener('click', function () { lgSwitchWs(b.dataset.ws); });
    });

    $('#lgTabs').addEventListener('click', function (e) {
      var b = e.target.closest('.lg-tab'); if (!b) return;
      $$('#lgTabs .lg-tab').forEach(function (x) { x.classList.toggle('is-on', x === b); });
      state.tab = b.dataset.tab;
      state.model = VEHICLES[state.tab][0].key;
      lgRenderVehicles(); lgCalc();
    });

    $('#lgVehicles').addEventListener('click', function (e) {
      var b = e.target.closest('.lg-vehicle'); if (!b) return;
      state.model = b.dataset.veh;
      lgRenderVehicles(); lgFit(); lgCalc();
    });

    $('#lgCargoList').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var card = btn.closest('.lg-cargo');
      var it = card ? itemById(card.dataset.id) : null;
      if (!it) return;
      var act = btn.dataset.act, val = btn.dataset.val;
      if (act === 'del') {
        state.items = state.items.filter(function (x) { return x.id !== it.id; });
        if (!state.items.length) state.items = [newItem()];
        lgRenderCargo(); lgCalc(); return;
      }
      if (act === 'pack') { it.packType = val; it.packMode = 'thick'; it.packThick = PACK[val] || 0; }
      else if (act === 'packmode') { it.packMode = val; }
      else if (act === 'dir') { it.dir = val; }
      else if (act === 'fragile') { it.fragile = !it.fragile; if (it.fragile) it.dir = 'up'; }
      else if (act === 'gap') {
        it.gapType = val;
        if (val === 'standard') { it.gapL = 0; it.gapW = 0; it.gapH = 0; }
        else if (val === 'swell') { it.gapL = 1; it.gapW = 1; it.gapH = 2; }
        else if (val === 'wood') { it.gapL = 3; it.gapW = 3; it.gapH = 3; }
      }
      else if (act === 'pallet') { it.usePallet = !it.usePallet; }
      lgRenderCargo(); lgCalc();
    });

    $('#lgCargoList').addEventListener('toggle', function (e) {
      var det = e.target;
      if (!det || det.tagName !== 'DETAILS') return;
      var card = det.closest('.lg-cargo');
      var it = card ? itemById(card.dataset.id) : null;
      if (it) it._adv = det.open;
    }, true);

    $('#lgCargoList').addEventListener('input', function (e) {
      var inp = e.target;
      if (!inp.classList.contains('lg-input')) return;
      var card = inp.closest('.lg-cargo');
      var it = card ? itemById(card.dataset.id) : null;
      if (!it) return;
      var f = inp.dataset.field;
      if (f === 'name') { it.name = inp.value; lgRenderLegend(); return; }
      var n = parseFloat(inp.value);
      if (!isFinite(n) || n < 0) n = 0;
      if (f === 'qty' || f === 'stackLayers' || f === 'pcsCtn') n = Math.floor(n);
      it[f] = n;
      lgUpdateHint(it);
      clearTimeout(calcTimer);
      calcTimer = setTimeout(lgCalc, 550);
    });

    $('#lgCargoList').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.classList.contains('lg-input')) {
        e.preventDefault(); clearTimeout(calcTimer); lgCalc();
      }
    });
    $('#lgCargoList').addEventListener('focusin', function (e) {
      if (e.target.classList.contains('lg-input') && e.target.type === 'number') e.target.select();
    });

    $('#lgAddCargo').addEventListener('click', lgAddItem);
    $('#lgCalc').addEventListener('click', function () { clearTimeout(calcTimer); lgCalc(); });
    $('#lgBtnDemo').addEventListener('click', lgLoadDemo);
    $('#lgBtnToDocs').addEventListener('click', lgToDocs);
    $('#lgBtnPickDocs').addEventListener('click', lgFromDocs);

    document.querySelector('.lg-tools').addEventListener('click', function (e) {
      var b = e.target.closest('[data-tool]'); if (!b) return;
      var t = b.dataset.tool;
      if (t === 'print') { lgPrintPlan(); return; }
      if (t === 'transparent') { state.transparent = !state.transparent; b.classList.toggle('is-on', state.transparent); lgDraw(); return; }
      if (t === 'in') { state.scale *= 1.15; lgDraw(); return; }
      if (t === 'out') { state.scale /= 1.15; lgDraw(); return; }
      if (t === 'fit') { lgFit(); lgDraw(); return; }
    });

    canvas.addEventListener('mousedown', function (e) {
      state.drag = true; state.lx = e.clientX; state.ly = e.clientY; canvas.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', function (e) {
      if (!state.drag) return;
      state.ox += e.clientX - state.lx;
      state.oy += e.clientY - state.ly;
      state.lx = e.clientX; state.ly = e.clientY;
      lgDraw();
    });
    window.addEventListener('mouseup', function () { state.drag = false; canvas.style.cursor = 'grab'; });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      state.scale *= e.deltaY < 0 ? 1.1 : 1 / 1.1;
      lgDraw();
    }, { passive: false });

    var rt = null;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { if (!$('#lgWorkspace').classList.contains('ws-hidden')) lgResize(); }, 120);
    });
  }

  /* ---------------- 工作区切换 ---------------- */
  function lgSwitchWs(ws) {
    var loading = ws !== 'docs';
    $$('.ws-tab').forEach(function (b) {
      var on = b.dataset.ws === (loading ? 'loading' : 'docs');
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('#docTopBar').classList.toggle('ws-hidden', loading);
    $('#docWorkspace').classList.toggle('ws-hidden', loading);
    $('#lgWorkspace').classList.toggle('ws-hidden', !loading);
    if (loading) {
      var drawer = $('#previewDrawer');
      if (drawer && drawer.classList.contains('open') && typeof window.togglePreview === 'function') window.togglePreview();
      $('#wsMetaText').textContent = '单柜装载模拟 · 一键生成箱单';
      requestAnimationFrame(function () { lgResize(); });
    } else {
      $('#wsMetaText').textContent = 'PI / CI / PL / 合同 / 报关 · 实时 A4';
    }
    try { localStorage.setItem('ft_ws', loading ? 'loading' : 'docs'); } catch (e) {}
  }

  /* ---------------- 装柜 → 单证 ---------------- */
  function lgToDocs() {
    lgCalc();
    var items = state.items.filter(function (it) { return num(it.qty) > 0 && num(it.l) > 0; });
    if (!items.length) { lgToast('先填写货物再生成单据', 'warn'); return; }
    if (typeof window.addProductRow !== 'function') { lgToast('单证模块未就绪', 'warn'); return; }

    var list = document.getElementById('productTable');
    if (!list) return;
    list.innerHTML = '';

    items.forEach(function (it, idx) {
      var d = lgEffDims(it);
      var pcs = Math.max(1, Math.floor(num(it.pcsCtn) || 1));
      var ctns = Math.max(0, Math.floor(num(it.qty)));
      var qty = ctns * pcs;
      var grossCtn = lgGross(it);
      var netCtn = num(it.net);   // 装箱单净重取内容物重量，不含纸箱皮重
      window.addProductRow();
      var cards = list.querySelectorAll('.sku-card');
      var card = cards[cards.length - 1];
      if (!card) return;

      function put(sel, val) { var el = card.querySelector(sel); if (el) el.value = val; }
      put('.p-name', it.name || ('货物 ' + (idx + 1)));
      put('.p-unit', 'PCS');
      put('.p-qty', qty);
      put('.p-pcsctn', pcs);
      put('.p-weight', +(grossCtn / pcs).toFixed(4));
      put('.p-nw', +(netCtn / pcs).toFixed(4));
      put('.p-ctnlen', +d.l.toFixed(2));
      put('.p-ctnwid', +d.w.toFixed(2));
      put('.p-ctnhei', +d.h.toFixed(2));
      put('.p-len', +d.l.toFixed(2));
      put('.p-wid', +d.w.toFixed(2));
      put('.p-hei', +d.h.toFixed(2));
      put('.p-vol', Math.max(0, Math.round(d.l * d.w * d.h / pcs)));
      put('.p-price', 0);
    });

    var dt = document.getElementById('docType');
    if (dt) { dt.value = 'PACKING LIST'; dt.dispatchEvent(new Event('change')); }

    var s = state.stats, v = vehicle();
    var pallet = document.getElementById('palletInfo');
    if (pallet) pallet.value = s.nEst + ' × ' + v.name + ' / ' + s.cbm.toFixed(2) + ' CBM / GW ' + s.gw.toFixed(1) + ' KGS';

    if (typeof window.calculate === 'function') window.calculate();
    lgSwitchWs('docs');
    var drawer = document.getElementById('previewDrawer');
    if (drawer && !drawer.classList.contains('open') && typeof window.togglePreview === 'function') window.togglePreview();
    lgToast('已按箱规生成装箱单；补采购价与银行信息即可出 PI / CI', 'ok');
  }

  /* ---------------- 单证 → 装柜 ---------------- */
  function lgFromDocs() {
    if (typeof window.getValInput !== 'function') { lgToast('单证模块未就绪', 'warn'); return; }
    var rows = document.querySelectorAll('#productTable .sku-card');
    if (!rows.length) { lgToast('单证里还没有货物', 'warn'); return; }
    var items = [], id = 1;
    rows.forEach(function (row, i) {
      var qty = window.getValInput(row, '.p-qty');
      if (qty <= 0) return;
      var pcs = Math.max(1, Math.round(window.getValInput(row, '.p-pcsctn') || 1));
      var ctns = Math.max(1, Math.ceil(qty / pcs));
      var l = window.getValInput(row, '.p-ctnlen'), w = window.getValInput(row, '.p-ctnwid'), h = window.getValInput(row, '.p-ctnhei');
      if (!(l > 0 && w > 0 && h > 0)) {
        l = window.getValInput(row, '.p-len'); w = window.getValInput(row, '.p-wid'); h = window.getValInput(row, '.p-hei');
      }
      if (!(l > 0 && w > 0 && h > 0)) return;
      var gw = window.getValInput(row, '.p-weight');   // 单件毛重
      var nw = window.getValInput(row, '.p-nw');
      var name = window.getValInput(row, '.p-name', 'text') || ('货物 ' + (i + 1));
      items.push(newItem({
        id: id++, name: name, l: +l.toFixed(2), w: +w.toFixed(2), h: +h.toFixed(2),
        qty: ctns, pcsCtn: pcs,
        net: +(nw * pcs).toFixed(3),
        tare: Math.max(0, +((gw - nw) * pcs).toFixed(3))
      }));
    });
    if (!items.length) { lgToast('单证货物缺少箱规尺寸', 'warn'); return; }
    state.items = items; state.nextId = id;
    lgRenderCargo(); lgCalc();
    lgToast('已取入 ' + items.length + ' 种货物，按箱规反算毛净重', 'ok');
  }

  /* ---------------- 装柜方案打印 ---------------- */
  function lgBuildPlan() {
    var s = state.stats;
    if (!s) return false;
    var v = vehicle();
    var today = new Date();
    var dateStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    var snap = '';
    try { if (canvas && canvas.width) snap = canvas.toDataURL('image/png'); } catch (e) {}

    var rows = state.items.filter(function (it) { return num(it.qty) > 0; }).map(function (it, i) {
      var d = lgEffDims(it);
      var cbm = d.l * d.w * d.h * num(it.qty) / 1000000;
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(it.name || ('货物 ' + (i + 1))) + '</td>' +
        '<td class="r">' + Math.floor(num(it.qty)) + '</td>' +
        '<td>' + d.l.toFixed(1) + ' × ' + d.w.toFixed(1) + ' × ' + d.h.toFixed(1) + '</td>' +
        '<td class="r">' + lgGross(it).toFixed(2) + '</td>' +
        '<td class="r">' + (lgGross(it) * num(it.qty)).toFixed(2) + '</td>' +
        '<td class="r">' + (num(it.net) * num(it.qty)).toFixed(2) + '</td>' +
        '<td class="r">' + cbm.toFixed(3) + '</td></tr>';
    }).join('');

    var stepRows = state.results.slice(0, 60).map(function (p, i) {
      return '<tr><td class="r">' + (i + 1) + '</td><td>' + esc(p.name) + '</td>' +
        '<td class="r">' + p.x.toFixed(0) + ', ' + p.y.toFixed(0) + ', ' + p.z.toFixed(0) + '</td>' +
        '<td>' + p.w.toFixed(0) + '×' + p.h.toFixed(0) + '×' + p.d.toFixed(0) + '</td>' +
        '<td class="r">' + p.layers + '</td><td class="r">' + p.gross.toFixed(2) + '</td></tr>';
    }).join('');

    var html = '<div class="lgp-page">' +
      '<div class="lgp-top"><h1>装柜方案<small>CONTAINER LOADING PLAN</small></h1>' +
      '<div class="lgp-meta"><div><b>日期 Date</b>' + dateStr + '</div>' +
      '<div><b>柜型 Container</b>' + esc(v.name) + '</div>' +
      '<div><b>预计柜数 Est.</b>' + s.nEst + ' × ' + esc(v.name) + '</div></div></div>' +
      '<div class="lgp-kpis">' +
      '<div class="lgp-kpi"><span>货物体积 Volume</span><b>' + s.cbm.toFixed(2) + '</b><i>CBM</i></div>' +
      '<div class="lgp-kpi"><span>总毛重 Gross Weight</span><b>' + s.gw.toFixed(2) + '</b><i>KG</i></div>' +
      '<div class="lgp-kpi"><span>空间利用率 Space Use</span><b>' + s.usage.toFixed(1) + '</b><i>%</i></div>' +
      '<div class="lgp-kpi"><span>重量饱和度 Weight Use</span><b>' + s.sat.toFixed(1) + '</b><i>%</i></div>' +
      '</div>' +
      '<div class="lgp-h">货物明细 CARGO LIST</div>' +
      '<table class="lgp-table"><thead><tr><th>#</th><th>品名 Description</th><th class="r">箱数 CTNS</th><th>外箱尺寸 L×W×H (cm)</th><th class="r">单箱毛重</th><th class="r">总毛重</th><th class="r">总净重</th><th class="r">体积 CBM</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '<tfoot><tr><td colspan="2">合计 TOTAL</td><td class="r">' + s.attempted + '</td><td></td><td></td><td class="r">' + s.gw.toFixed(2) + '</td><td class="r">' + state.items.reduce(function (a, it) { return a + num(it.net) * num(it.qty); }, 0).toFixed(2) + '</td><td class="r">' + s.cbm.toFixed(3) + '</td></tr></tfoot></table>' +
      (snap ? '<div class="lgp-snap"><img src="' + snap + '" alt="loading plan"></div>' : '') +
      '<div class="lgp-note">装载校验：重心横向偏移 ' + (s.cg >= 0 ? '+' : '') + s.cg.toFixed(2) + '%，底层最大压强 ' + s.pressure.toFixed(2) + ' kPa，剩余载重 ' + s.remain.toFixed(1) + ' kg。' +
      '本方案按 ' + esc(v.name) + ' 内尺寸 ' + (v.w / 100).toFixed(2) + '×' + (v.h / 100).toFixed(2) + '×' + (v.d / 100).toFixed(2) + ' m 计算，实际装柜以船公司柜况与现场理货为准。' + (s.packed < s.attempted ? ' <strong>本柜尚差 ' + (s.attempted - s.packed) + ' 箱未装，需另柜或调整箱规。</strong>' : '') + '</div>' +
      '</div>';

    if (state.results.length) {
      html += '<div class="lgp-page"><div class="lgp-top"><h1>装载步骤<small>LOADING SEQUENCE</small></h1>' +
        '<div class="lgp-meta"><div><b>柜型</b>' + esc(v.name) + '</div><div><b>已装</b>' + s.packed + ' 箱</div></div></div>' +
        '<div class="lgp-h">逐箱坐标（X 横向 / Y 高度 / Z 纵深，单位 cm）</div>' +
        '<table class="lgp-table"><thead><tr><th class="r">#</th><th>品名</th><th class="r">坐标 X, Y, Z</th><th>尺寸 (cm)</th><th class="r">层</th><th class="r">毛重 kg</th></tr></thead><tbody>' + stepRows + '</tbody></table>' +
        (state.results.length > 60 ? '<div class="lgp-note">仅列前 60 箱，其余 ' + (state.results.length - 60) + ' 箱见软件内「装载步骤」列表。</div>' : '') +
        '</div>';
    }

    $('#lgPrintArea').innerHTML = html;
    return true;
  }

  function lgPrintPlan() {
    if (!lgBuildPlan()) return;
    document.body.classList.add('lg-printing');
    try { window.print(); } catch (e) {}
    setTimeout(function () { document.body.classList.remove('lg-printing'); }, 800);
  }

  /* ---------------- 初始化 ---------------- */
  function lgInit() {
    canvas = document.getElementById('lgCanvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    if (!lgRestore()) state.items = demoItems();
    if (!state.items.length) state.items = demoItems();

    lgRenderVehicles();
    lgRenderCargo();
    lgBind();
    lgCalc();
    lgResize();

    var saved = 'loading';
    try { saved = localStorage.getItem('ft_ws') === 'docs' ? 'docs' : 'loading'; } catch (e) {}
    lgSwitchWs(saved);

    window.addEventListener('afterprint', function () {
      document.body.classList.remove('lg-printing');
    });
  }

  window.LG = {
    state: state,
    calc: lgCalc,
    loadDemo: lgLoadDemo,
    clear: lgClear,
    toDocs: lgToDocs,
    fromDocs: lgFromDocs,
    buildPlan: lgBuildPlan,
    render: lgRenderCargo,
    printPlan: lgPrintPlan,
    switchWs: lgSwitchWs,
    resize: lgResize,
    vehicles: VEHICLES
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', lgInit);
  else lgInit();
})();


