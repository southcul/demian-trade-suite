---
name: demian-trade-suite
slug: demian-trade-suite
displayName: 外贸单证与装柜工作台
version: 1.0.5
summary: 外贸单证（PI/CI/PL/合同/报关）与集装箱装柜计算一体工作台，含 JSON→PDF 出单流水线。
license: MIT
category: business-ops
homepage: https://github.com/southcul/demian-trade-suite
tags: [外贸, 单证, 形式发票, PI, 装箱单, 装柜, 集装箱, incoterms]
description: 外贸单证与装柜计算技能。用于制作形式发票（PI）、商业发票（CI）、装箱单（PL）、销售合同（SC）、报价单、出口报关单与代理报关委托书，以及集装箱/厢式货车装柜计算、CBM/毛净重核算、装柜方案 PDF。触发词：外贸单证、形式发票、PI、Proforma Invoice、商业发票、装箱单、Packing List、销售合同、报关单、报关委托书、装柜计算、货柜怎么装、集装箱装柜、CBM、体积重、20GP、40HQ、Incoterms、FOB、CIF、HS Code。
---

# 外贸单证与装柜工作台

一套离线单文件工作台 + 一套给 Agent 用的 JSON→PDF 流水线。三条主线：

1. **装柜计算**：按箱规排布、算 CBM/毛净重/装载率/重心/底层压强，出装柜方案 PDF。
2. **外贸单证**：PI、CI、PL、SC、报价单、报关单、报关委托书，A4 实时预览与打印。
3. **形式发票**：PI 是单证模块的一等单据，含银行信息、定金/尾款拆分、金额大写。

所有页面离线可用，不依赖 CDN。

## 环境与文件

技能目录：本文件所在目录（下称 `SKILL_DIR`）。

| 文件 | 用途 |
|---|---|
| `assets/workbench.html` | 单文件工作台（装柜计算 + 外贸单证），双击即用 |
| `assets/demo-shipment.json` | 完整示例订单，改它最快 |
| `scripts/render_docs.py` | `shipment.json` → PI/CI/PL… PDF（无第三方依赖，调本机 Chrome） |
| `scripts/render_loading.py` | `shipment.json` → 装柜方案 PDF |
| `references/shipment-schema.md` | JSON 全字段说明 |
| `references/documents.md` | 7 种单据的用途、必填项、退单雷区 |
| `references/incoterms-2020.md` | 11 个术语的费用/风险划分，与工具取费逻辑对齐 |
| `references/loading.md` | 柜型参数、排布算法、结果解读、调参 |
| `references/pricing.md` | 含税采购价、退税、费用分摊、利润率、报价取整 |

运行脚本需要 Python 3.8+；Chrome/Edge 自动探测（也可 `--chrome` 指定）。DSH 桌面端可直接用捆绑运行时：

```powershell
# DSH 桌面端：$py = "C:\Users\Lenovo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
$py = "python"
& $py scripts\render_docs.py assets\demo-shipment.json --out outputs --types PI
& $py scripts\render_docs.py assets\demo-shipment.json --out outputs --batch
& $py scripts\render_docs.py order.json --validate-only
```

## 给 Agent 的工作流

### A. 出一份 PI / 一套单证

1. **收集事实**：卖方抬头/地址/税号/银行（名称、账号、SWIFT、地址、中间行）、买方抬头/地址/联系人、贸易术语与地点、起运港/目的港、付款条款、货物品名/HS/数量/单价/箱规/毛净重、唛头、托盘/柜型。单证页顶部「卖方信息」卡可一次填好并点「保存卖方信息」，之后新建订单自动带出。
2. **不编造**：HS Code、银行账号、公司抬头、许可证号必须来自用户或用户文件。缺失就明确标 `TODO` 并问，不要用示例值冒充。
3. 写 `order.json`（照抄 `assets/demo-shipment.json` 的结构），跑：

```powershell
& $py scripts\render_docs.py order.json --out outputs --types PI
```

4. 看脚本输出的合计（件数/箱数/CBM/毛净重）和 warning；有 `[error]` 按提示补数据，不要绕过。
5. 交付 `<stem>_PROFORMA.pdf` 与 `<stem>.draft.json`（后者可直接导入工作台继续改）。需要整套就 `--batch`，默认 PI + CI + PL；`--types PI CI PL SC` 可自选。

### B. 算装柜 / 出装柜方案

1. 同一份 `order.json`（箱规字段必须有 `ctn_l/ctn_w/ctn_h` 与 `pcs_per_ctn`）。
2. 跑：

```powershell
& $py scripts\render_loading.py order.json --container 40HQ --out outputs
```

3. 读脚本打印的装载结果：已装/总箱数、CBM、装载率、重量饱和度、预计柜数。装不下会在 PDF 里标出未装数量。
4. 需要交互调方向、间隙、托盘、堆码层数时，打开 `assets/workbench.html` 的「装柜计算」页。点「载入示例」或「开始计算」会自动播放逐层装柜动画，可暂停 / 继续 / 重播。

### C. 装柜结果 → 装箱单

在工作台里点「生成单据 →」：把当前货物按箱规写成 SKU 行（件数 = 箱数 × 每箱数量），自动切到「装箱单」并打开 A4 预览。价格列留空是故意的——装箱单不含价格；补采购价后再切 PI/CI。

反向「从单证取货」：把单证里已有 SKU 的箱规反算成装柜货物。

## 数据口径（最容易错的地方）

| 字段 | 口径 | 示例 |
|---|---|---|
| `items[].qty` | **件数 PCS**，不是箱数 | 3000 |
| `pcs_per_ctn` | 每箱件数 | 20 |
| `gross_weight` / `net_weight` | **单件**毛重/净重 kg | 0.75 / 0.70 |
| `ctn_l/w/h` | **外箱**尺寸 cm | 46 / 32 / 28 |
| `unit_price_cny` | **含税采购价** CNY/件，不是卖价 | 150 |
| `exchange_rate` | CNY per 1 外币 | 7.2 |

- 箱数 = `ceil(qty / pcs_per_ctn)`；体积 = 箱规体积 × 箱数。
- 工作台按「含税采购价 → 退税额 → 费用分摊 → 目标利润率」反推外销单价；不是把采购价直接当卖价。详见 `references/pricing.md`。
- 净重不得大于毛重；装箱单必须有 `pcs_per_ctn`，否则算不出箱数。
- 贸易术语的指定地点：CIF/CFR/CPT/CIP/DAP/DPU/DDP 写**目的港**，FOB/FCA/FAS/EXW 写**起运地**（工具已按此渲染）。

## 单据与必填项

| 单据 | 何时用 | 关键必填 |
|---|---|---|
| Quotation 报价单 | 询盘报价 | 价格、有效期；不含银行信息 |
| **PI 形式发票** | 客户付款/开证依据 | 银行账号、SWIFT、付款条款、有效期、金额大写 |
| CI 商业发票 | 清关、收汇 | 发票号、HS、数量、单价、总额、金额大写 |
| PL 装箱单 | 仓库/货代/目的港核货 | 箱号区间、每箱数量、毛净重、外箱尺寸、唛头 |
| SC 销售合同 | 成交与法律效力 | 双方主体、条款、仲裁、双签 |
| 报关单 | 中国出口申报核对 | 境内收发货人、监管方式/代码、运输方式、包装种类 |
| 报关委托书+协议 | 委托报关行 | 被委托方、委托方式、事项、有效期、收费 |

单据语言可选英/西/法/俄/阿/葡/德/日，默认英文；界面中文/英文。中国报关资料固定中文。

## 校验红线

出单前逐项过：

- [ ] 净重 ≤ 毛重（物理不可能反了，清关必被质疑）
- [ ] 有价格的单据总额 > 0
- [ ] 装箱单每种货都有 `pcs_per_ctn`
- [ ] 合同有买方地址；PI/CI 有银行账号与 SWIFT
- [ ] 目的港、唛头已填（唛头留空会印 N/M，工厂可能按无唛生产）
- [ ] HS 至少 6 位，中国出口申报通常 10 位
- [ ] A4 不溢出：超长时工具自动允许分页，不裁正文
- [ ] 金额大小写一致；币种与符号一致（JPY 无小数）

## 交付约定

- 文件放用户同目录或 `outputs/`，命名 `<订单号或客户>_<单据>.pdf`。
- 同时保留 `.draft.json`，方便用户在 UI 里继续改。
- 交付时用一句话说明：单据类型、总金额、件数/箱数/CBM、以及仍待确认的字段。

## 工作台源码（不随包发布）

SkillHub 只放行 `SKILL.md`、`scripts/`、`references/`、`assets/`；构建源码放在包外的 `outputs/demian-trade-suite-build/`。改完 `parts/*` 后设置 `SKILL_DIR` 指向本技能目录，再跑 `build/build.py` 重新生成 `assets/workbench.html`。

## 常见问题

- **Chrome 找不到**：`--chrome "C:\Program Files\Google\Chrome\Application\chrome.exe"`（macOS：`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`）。
- **PDF 空白**：脚本会检查文件大小并报错；多为虚拟时间不足，重跑或加大 `--virtual-time-budget`（脚本内已设 15s）。
- **装柜装不下**：先看是「超重」还是「空间不足」。超重减数量/换高载重柜；空间不足查摆放方向、间隙、托盘、每箱数量。
- **改工作台**：构建源码在包外 `outputs/demian-trade-suite-build/`。改 `build/parts/*` 后，设置 `$env:SKILL_DIR` 指向本技能目录，再跑 `python build/build.py` 生成 `assets/workbench.html`；不要直接改生成物。
