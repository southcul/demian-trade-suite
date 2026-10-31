# shipment.json 字段说明

`scripts/render_docs.py` 和 `scripts/render_loading.py` 共用这一份订单 JSON。原则：**一个文件描述一票货**，单据和装柜都从它派生。

## 顶层

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `doc_type` | string | 是 | 单张单据时的类型，如 `PROFORMA INVOICE` |
| `doc_types` | array | 否 | `--batch` 时渲染的整套单据及顺序 |
| `date` | `YYYY-MM-DD` | 是 | 单据日期；也是编号里的日期段 |
| `ref_no` | string | 否 | 手填单号；留空按 `PI-YYYYMMDD-01` 自动生成。无头渲染每次都是全新浏览器环境，流水号会重置，正式单据请手填 |
| `validity_days` | number | 否 | 报价/PI 有效期天数，默认 15 |
| `currency` | string | 是 | `USD/EUR/GBP/JPY/CAD/AUD/AED` |
| `exchange_rate` | number | 是 | 1 外币 = ? CNY |
| `term` | string | 是 | Incoterms 2020，如 `FOB/CIF/DDP` |

## seller / buyer

```json
"seller": {
  "name": "SHENZHEN SAMPLE TECHNOLOGY CO., LTD.",
  "address": "Room 1201, ... Shenzhen, China | sales@example.com",
  "tax_no": "91440300XXXXXXXXXX",
  "bank": {
    "name": "Bank of China, Shenzhen Nanshan Branch",
    "account": "7643 2100 8899 0012",
    "swift": "BKCHCNBJ45A",
    "address": "No. 88 Keyuan Road, Shenzhen, China",
    "intermediary": "CITIBANK N.A., NEW YORK / SWIFT: CITIUS33"
  }
},
"buyer": {
  "company": "HAMBURG HOME IMPORTS GMBH",
  "address": "Grosse Elbstrasse 145, 22767 Hamburg, Germany",
  "attn": "Purchasing Department",
  "consignee": "同买方时留空",
  "notify": "留空则打印 SAME AS CONSIGNEE"
}
```

- `seller.address` 会原样印在抬头下，可把电话/邮箱用 `|` 接在后面。
- 银行信息只对 PI / CI / SC 生效；报价单和装箱单不显示。
- 中间行（intermediary）用于美元大额汇款，没有就留空。

## trade

| 字段 | 说明 |
|---|---|
| `pol` / `pod` | 起运港 / 目的港，英文，如 `Shenzhen, China` |
| `dest_country` | 目的国，如 `Germany` |
| `origin` | 原产国，默认 `China` |
| `payment` | 付款条款原文，如 `30% T/T deposit, balance against copy of B/L` |
| `lead_time` | 交货期原文 |
| `vessel` / `bl_no` | 船名航次 / 提单号，出运后补 |
| `shipment_date` | 装运期原文，可写 `Within 30 days after deposit` |
| `contract_no` | 合同号；CI/PL 会打印 `Against SC No.` |
| `sign_place` | 签约地点 |
| `partial` | `allowed` / `not_allowed` |
| `arbitration` | 仲裁条款，合同用 |
| `marks` | 唛头，多行用 `\n`；留空打印 N/M |
| `pallet_info` | 托盘/柜型，如 `1 × 40'HQ / 400 CTNS / 30.20 CBM` |

## items[]

| 字段 | 单位 | 说明 |
|---|---|---|
| `name` | – | 品名，英文优先；中文会原样打印 |
| `hs_code` | – | 中国出口 10 位；至少 6 位 |
| `unit` | – | `PCS/SET/CTN`，默认 PCS |
| `qty` | 件 | **总件数**，不是箱数 |
| `unit_price_cny` | CNY/件 | **含税采购价**，不是卖价 |
| `pcs_per_ctn` | 件/箱 | 装箱单必需 |
| `gross_weight` | kg/件 | 单件毛重 |
| `net_weight` | kg/件 | 单件净重，必须 ≤ 毛重 |
| `ctn_l/w/h` | cm | 外箱长宽高 |

箱数、CBM、总毛净重都由这五个字段推出：

```
箱数 = ceil(qty / pcs_per_ctn)
CBM  = ctn_l × ctn_w × ctn_h / 1,000,000 × 箱数
总毛重 = gross_weight × qty
```

## costs

| 字段 | 默认 | 说明 |
|---|---|---|
| `vat_rate` | 13 | 增值税率 % |
| `refund_rate` | 13 | 出口退税率 % |
| `margin_rate` | 20 | 目标销售利润率 % |
| `bank_fee` | 0 | 银行/杂费，CNY，整单 |
| `domestic_fee` | 0 | 报关/拖车等国内段，CNY |
| `domestic_alloc` | `qty` | `qty/vol/weight` 分摊基准 |
| `freight_mode` | `sea_fcl` | `sea_lcl/sea_fcl/air` |
| `intl_freight` | 0 | 国际运费，CNY |
| `insurance` | 0 | 保险费，CNY |
| `air_dim_factor` | 167 | 空运 1 CBM = ? kg |
| `discount` | 0 | 整单折扣 % |
| `price_precision` | 0.05 | 报价向上取整精度 |

## options

| 字段 | 默认 | 说明 |
|---|---|---|
| `doc_lang` | `en` | 单据语言：en/es/fr/ru/ar/pt/de/ja |
| `theme` | `classic` | classic/graphite/emerald/burgundy/navy/amber/teal/violet/mono |
| `bilingual` | false | 中英双语并排 |

## fields（逃生口）

任何工作台原始字段都可覆盖：

```json
"fields": {
  "cnConsignorName": "深圳市XX科技有限公司",
  "cnConsignorCode": "91440300MA5XXXXX1K",
  "cdSupervisionCode": "0110",
  "cdCustomsPort": "深圳海关"
}
```

报关单/委托书字段见 `documents.md`，字段名与工作台 `FIELD_SCHEMA` 一致。

## 最小可用示例

```json
{
  "doc_type": "PROFORMA INVOICE",
  "date": "2026-10-31",
  "currency": "USD",
  "exchange_rate": 7.2,
  "term": "FOB",
  "seller": {"name": "ABC CO., LTD.", "address": "Shenzhen, China", "bank": {"name": "Bank of China", "account": "12345678", "swift": "BKCHCNBJ"}},
  "buyer": {"company": "XYZ LLC", "address": "Dubai, UAE", "attn": "Purchase"},
  "trade": {"pol": "Shenzhen, China", "pod": "Jebel Ali, UAE", "payment": "30% T/T deposit, balance before shipment", "origin": "China"},
  "items": [{"name": "LED Panel Light", "hs_code": "9405409000", "qty": 1000, "unit_price_cny": 45, "pcs_per_ctn": 10, "gross_weight": 1.2, "net_weight": 1.0, "ctn_l": 50, "ctn_w": 40, "ctn_h": 30}]
}
```

完整版见 `assets/demo-shipment.json`。
