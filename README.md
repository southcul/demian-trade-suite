# 外贸单证与装柜工作台

一套离线外贸工作台：**形式发票 PI、商业发票、装箱单、销售合同、报关资料**，加上**集装箱 / 厢式货车装柜计算**与装柜方案 PDF。单文件 HTML，双击即用；另附一套 `shipment.json → PDF` 的 Agent 出单流水线。

![装柜计算](docs/workbench-loading.png)

## 功能

| 模块 | 能力 |
|---|---|
| 装柜计算 | 20GP / 40GP / 40HQ / 45HQ、4.2–7.6 米货车；多货物、包装填充、堆码/承压、摆放方向、间隙、整托；CBM、毛净重、装载率、重量饱和度、重心偏移、底层压强；逐箱坐标与装柜方案 PDF |
| 卖方信息 | 公司抬头、地址、税号、银行、Logo、公章、签名集中在一张卡；保存到本地，新建订单自动带出，所有单据共用 |
| 外贸单证 | 报价单、PI、CI、销售合同、装箱单、出口报关单、代理报关委托书；A4 实时预览、整套单据打印、金额大写、定金/尾款拆分、9 套配色、8 种单据语言 |
| 形式发票 | 银行信息、SWIFT、中间行、付款条款、有效期、金额大写、定金/尾款金额自动拆分 |
| Agent 流水线 | 一份 `shipment.json` → 单张或整套 PDF；装柜方案 PDF；字段校验与错误拦截 |

### 单证界面

![单证](docs/workbench-docs.png)

## 快速开始

### 1. 直接打开工作台

双击 `assets/workbench.html`，或拖进浏览器。无需服务器、无需联网、无 CDN 依赖。

单证页顶部有「卖方信息」卡：填一次、点「保存卖方信息」，之后新建订单/清空草稿都会自动带出。

顶部两个工作区：

- **装柜计算**：填箱规与数量 → 开始计算 → 看装载图/指标 → 打印装柜方案。
- **外贸单证**：选单据类型 → 填买卖双方/条款/货物 → 预览并打印 A4。

装柜页的「生成单据 →」会按箱规把货物写成 SKU 行并切到装箱单；单证页的「从单证取货」可反向导入。

### 2. 从 JSON 出 PDF

需要 Python 3.8+ 与本机 Chrome/Edge：

```bash
python scripts/render_docs.py assets/demo-shipment.json --out outputs --types PI
python scripts/render_docs.py assets/demo-shipment.json --out outputs --batch
python scripts/render_loading.py assets/demo-shipment.json --container 40HQ --out outputs
```

输出：

- `<订单>_PI.pdf` / `<订单>_docs.pdf`（PI + CI + PL）
- `<订单>_loading_40HQ.pdf`（装柜方案 + 逐箱坐标）
- `<订单>.draft.json`（可导入工作台继续改）

`assets/demo-shipment.json` 是完整示例，改它最快。字段口径见 [`references/shipment-schema.md`](references/shipment-schema.md)。

## 目录

```text
SKILL.md                  技能清单（SkillHub / Agent 入口）
assets/
  workbench.html          单文件工作台（装柜 + 单证）
  demo-shipment.json      示例订单
references/               字段、单据、Incoterms、装柜、报价
scripts/
  render_docs.py          shipment.json → 单证 PDF
  render_loading.py       shipment.json → 装柜方案 PDF
build/                    工作台源码（base.html + parts + 构建/打包脚本）
docs/                     README 截图
```

## 作为技能安装

### DSH / 本地 Agent

把仓库放到技能目录：

```bash
git clone https://github.com/southcul/demian-trade-suite.git ~/.dsh/skills/demian-trade-suite
```

技能入口是根目录的 `SKILL.md`。

### SkillHub

仓库根目录不是发布包（含 `build/`、`README`、`docs/`）。先生成符合 SkillHub 白名单的 zip：

```bash
python build/package.py
```

产物：`dist/demian-trade-suite.zip`，只含 `SKILL.md`、`assets/`、`references/`、`scripts/`，并通过单文件 ≤1MB、整包 ≤10MB、≤100 文件、扩展名/前缀白名单检查。

然后按 [SkillHub 发布教程](https://skillhub.cn/tutorials#publish-via-cli) 上传，或：

```bash
skillhub publish dist/demian-trade-suite.zip --changelog "首次发布"
```

## 数据口径（最容易错的地方）

| 字段 | 口径 |
|---|---|
| `qty` | 件数 PCS，不是箱数 |
| `pcs_per_ctn` | 每箱件数；装箱单必需 |
| `gross_weight` / `net_weight` | **单件**毛重 / 净重 kg |
| `ctn_l/w/h` | **外箱**尺寸 cm |
| `unit_price_cny` | **含税采购价** CNY/件，不是卖价 |

工作台按「含税采购价 → 退税额 → 费用分摊 → 目标利润率」反推外销单价；客户已给目标卖价时按 [`references/pricing.md`](references/pricing.md) 反推利润率。

## 已知边界

- 装柜一次只模拟**一个柜**；多柜数量按体积/重量粗算，需货代复核。
- 不处理轴荷、道路限重、绑扎加固、危化品、冷藏柜/开顶柜/框架柜。
- 报价是成本加成模型，没有手工锁定卖价。
- HS Code、银行账号、公司抬头必须由使用者提供，示例数据仅用于演示。

## 开发

```bash
python build/build.py      # 重新生成 assets/workbench.html
python build/package.py    # 生成 SkillHub 发布 zip
```

`build/` 里是工作台的源码（`base.html` + `parts/`）；不要直接改 `assets/workbench.html`。

## English

An offline, single-file workbench for foreign-trade documents (PI, CI, packing list, sales contract, Chinese customs forms) and container loading. It also ships a `shipment.json → PDF` pipeline for agents. Open `assets/workbench.html`; the scripts need Python 3.8+ and Chrome/Edge.

## License

MIT。见 [LICENSE](LICENSE)。
