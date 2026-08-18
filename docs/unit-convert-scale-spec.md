# CalcArc — Unit Conversion / Currency / Data Scale 設計書

## 1. 概要

CalcArc に、日常・技術用途で利用できる以下の計算・変換機能を追加する。

1. **Unit Convert**
   - SI単位を中心とした単位変換
   - SI外の日常的な単位もサポート
   - 原則として完全オフラインで動作

2. **Currency Convert**
   - 通貨間の換算
   - 為替レートはオンライン時に取得
   - 一度取得したレートをローカルに保存し、オフラインでも利用可能
   - レートは原則として1日1回程度更新

3. **Data Scale**
   - データ容量やデータ規模の計算
   - ベクトルデータ、LLMモデル、転送量など、技術用途のスケール計算
   - 既存の単純なデータサイズ計算から発展させる

CalcArc全体としては、

> **数値の変換と、規模感をすぐ確認するための計算ツール**

を目指す。

---

# 2. 全体構成

CalcArcの計算機能を大きく以下に分類する。

```text
CalcArc
│
├── Convert
│   ├── Length
│   ├── Area
│   ├── Volume
│   ├── Mass
│   ├── Temperature
│   ├── Speed
│   ├── Pressure
│   ├── Energy
│   ├── Power
│   ├── Time
│   ├── Data Size
│   └── Currency
│
└── Scale
    ├── Data Size
    ├── Vector / Embedding
    ├── LLM Model
    ├── Data Transfer
    └── Image / Raw Data
```

`Convert` と `Scale` は目的を明確に分ける。

### Convert

既知の値を別の単位に変換する。

例:

```text
10 mile
→
16.09344 km
```

### Scale

複数の要素から全体の規模を計算する。

例:

```text
1,000,000 vectors
×
768 dimensions
×
FP32

→ 3.072 GB
```

---

# 3. Unit Convert

## 3.1 基本コンセプト

単位変換は原則として、

```text
入力値
×
変換係数
=
変換結果
```

として扱う。

ただし温度など、単純な倍率だけでは変換できない単位については専用変換式を使用する。

計算処理はすべてクライアント側で行う。

ネットワーク接続は不要。

---

# 4. Unit Convert UI

基本UIは共通化する。

```text
┌─────────────────────────────┐
│ Length                      │
│                             │
│ 100                         │
│ [ kilometer            ▼ ] │
│                             │
│          ⇅                  │
│                             │
│ 62.1371                     │
│ [ mile                 ▼ ] │
└─────────────────────────────┘
```

入力値を変更すると即時に再計算する。

単位を変更した場合も即時に再計算する。

---

## 4.1 入力項目

### Value

数値。

サポート:

- 整数
- 小数
- 負数
- 指数表記

例:

```text
100
0.001
-40
1e9
```

---

## 4.2 Swap

上下の単位を交換する。

例:

```text
km → mile

↓ Swap

mile → km
```

入力値自体は維持する。

---

# 5. Unit Category

初期バージョンでは以下を対象とする。

## Length

```text
nm
µm
mm
cm
m
km

inch
foot
yard
mile

nautical mile
```

内部基準単位:

```text
meter
```

---

## Area

```text
mm²
cm²
m²
km²

hectare

in²
ft²
yd²
acre

坪
畳
```

内部基準:

```text
m²
```

「畳」は地域差があるため、初期バージョンでは除外してもよい。

---

## Volume

```text
mL
cL
dL
L
m³

fl oz
cup
pint
quart
gallon
```

US / Imperial gallon は明確に区別する。

例:

```text
US gallon
Imperial gallon
```

内部基準:

```text
liter
```

---

## Mass

```text
mg
g
kg
t

oz
lb
stone
```

内部基準:

```text
kg
```

---

## Temperature

```text
°C
°F
K
```

変換式を個別実装する。

例:

```text
F = C × 9 / 5 + 32
```

---

## Speed

```text
m/s
km/h
mph
knot
```

内部基準:

```text
m/s
```

---

## Pressure

```text
Pa
hPa
kPa
MPa

bar
atm
psi
Torr
mmHg
```

内部基準:

```text
Pa
```

---

## Energy

```text
J
kJ
MJ

Wh
kWh
MWh

cal
kcal
```

内部基準:

```text
joule
```

---

## Power

```text
W
kW
MW
GW

hp
```

内部基準:

```text
watt
```

---

## Time

```text
ns
µs
ms
second
minute
hour
day
week
```

内部基準:

```text
second
```

month / year は固定長ではないため、基本単位変換からは除外する。

---

# 6. Data Size Converter

データサイズではSIとIECを明確に分離する。

## SI

```text
bit
byte

kB
MB
GB
TB
PB
```

```text
1 kB = 1000 bytes
1 MB = 1000 kB
```

---

## IEC

```text
KiB
MiB
GiB
TiB
PiB
```

```text
1 KiB = 1024 bytes
1 MiB = 1024 KiB
```

---

## 表示例

```text
1 GB
=
1000 MB
=
953.674 MiB
```

CalcArcでは、

```text
GB
GiB
```

の違いを明確に扱う。

---

# 7. Currency Convert

## 7.1 基本思想

通貨変換のみ、外部データを必要とする。

ただしアプリ起動時にネットワークを必須としない。

基本方針:

```text
Cached Rate First
+
Background Update
```

とする。

---

# 8. Currency Rate Architecture

```text
             ┌─────────────┐
             │ Rate API    │
             └──────┬──────┘
                    │
                HTTPS
                    │
                    ▼
        ┌────────────────────┐
        │ Currency Provider  │
        └─────────┬──────────┘
                  │
                  ▼
        ┌────────────────────┐
        │ Local Rate Cache   │
        │ IndexedDB          │
        └─────────┬──────────┘
                  │
                  ▼
        ┌────────────────────┐
        │ Converter Engine   │
        └────────────────────┘
```

---

# 9. Currency Provider

外部APIに直接依存しない。

以下のインターフェースを設ける。

```typescript
interface CurrencyProvider {
  getLatestRates(): Promise<CurrencyRateSet>
}
```

データ構造:

```typescript
interface CurrencyRateSet {
  baseCurrency: string
  date: string
  fetchedAt: string
  rates: Record<string, number>
}
```

例:

```json
{
  "baseCurrency": "EUR",
  "date": "2026-08-14",
  "fetchedAt": "2026-08-16T05:00:00Z",
  "rates": {
    "USD": 1.16,
    "JPY": 171.2,
    "GBP": 0.86
  }
}
```

APIサービスを将来変更しても、Converter側には影響を与えない。

---

# 10. Currency Cache

為替レートはIndexedDBに保存する。

localStorageではなくIndexedDBを優先する。

保存内容:

```text
rates
base currency
rate date
fetched timestamp
provider
schema version
```

---

# 11. Currency Update Policy

基本ルール:

```text
キャッシュなし
    ↓
オンライン?
    ↓ Yes
レート取得

キャッシュあり
    ↓
24時間以内?
    ↓ Yes
キャッシュ使用

24時間以上
    ↓
オンライン?
   Yes → 更新
   No  → 古いキャッシュ使用
```

---

## 11.1 更新頻度

目安:

```text
24時間
```

ただし、

```text
rate date
```

が変化していなければ再保存の必要はない。

---

# 12. Offline Behavior

オフライン時も通貨計算を可能にする。

例:

```text
USD → JPY
```

のレートが3日前のものでも使用する。

ただし必ず、

```text
Rate date:
2026-08-14
```

と表示する。

古いレートであることを隠さない。

---

# 13. Currency UI

```text
┌────────────────────────────┐
│ Currency                   │
│                            │
│ 100                        │
│ [ USD                  ▼ ]│
│                            │
│           ⇅                │
│                            │
│ 17,120                     │
│ [ JPY                  ▼ ]│
│                            │
│ Rate: 2026-08-14           │
└────────────────────────────┘
```

オフラインの場合:

```text
Offline
Rate: 2026-08-14
```

---

# 14. Currency Precision

通貨レート計算ではJavaScript標準numberを使用可能とする。

金融取引・会計処理を目的としたツールではないため、任意精度Decimalは必須としない。

ただし表示時には適切に丸める。

例:

```text
JPY
17,123

USD
123.45

BTC
0.00123456
```

暗号資産を扱うかは別途検討する。

初期バージョンでは法定通貨のみを推奨する。

---

# 15. Data Scale

Data ScaleはCalcArcの技術者向け機能として位置付ける。

目的:

> 数字そのものではなく、そのデータがどの程度の規模になるかを素早く把握する。

---

# 16. Generic Data Size

基本式:

```text
Items
×
Elements per Item
×
Bytes per Element
=
Total Size
```

入力:

```text
Items
Elements
Data Type
```

Data Type:

```text
bit
INT8
INT16
INT32
INT64

FP16
BF16
FP32
FP64
```

---

# 17. Vector / Embedding Scale

Embedding向けプリセット。

入力:

```text
Number of vectors

Dimensions

Data type
```

例:

```text
Vectors:
1,000,000

Dimensions:
768

Data type:
FP32
```

計算:

```text
1,000,000
×
768
×
4 bytes

=
3,072,000,000 bytes
```

表示:

```text
3.072 GB
2.861 GiB
```

---

# 18. LLM Model Size

LLMの重みサイズを計算する。

入力:

```text
Parameters

Precision
```

Parameters:

```text
7B
8B
14B
32B
70B
Custom
```

ユーザーが直接、

```text
7
```

を入力し、

```text
Billion
```

を選択できる形でもよい。

---

# 19. LLM Precision

初期対応:

```text
FP32
FP16
BF16
INT8
INT4
```

基本計算:

```text
Model Size
=
Parameter Count
×
Bits per Parameter
÷
8
```

例:

```text
7B
×
4bit

=
3.5 GB
```

---

# 20. LLM Display

```text
7B parameters
INT4

Theoretical weight size

3.50 GB
3.26 GiB
```

重要:

必ず、

```text
Theoretical weight size
```

と明示する。

---

# 21. LLM Runtime Notice

結果の下に説明を表示する。

```text
Actual runtime memory will be larger.

Additional memory may be required for:

- KV cache
- temporary buffers
- runtime overhead
- quantization metadata
```

これにより、

```text
7B INT4 = 3.5GB
```

だから4GB VRAMで必ず動く、という誤解を避ける。

---

# 22. Quantization

INT4については、

```text
4 bit = 0.5 byte
```

という理論値を使用する。

GGUF等の実ファイルサイズとは一致しない場合がある。

理由:

```text
scale
zero point
metadata
alignment
```

などが追加されるため。

初期実装では実ランタイムサイズを推定しない。

---

# 23. Data Transfer Scale

ネットワーク帯域から転送データ量を計算する。

入力:

```text
Bandwidth

Duration
```

例:

```text
100 Mbps
×
3 hours
```

計算:

```text
100 Mbps
×
10800 sec

=
1,080,000 Mbit

÷ 8

=
135 GB
```

---

## 対応Bandwidth

```text
bps
kbps
Mbps
Gbps
```

Duration:

```text
second
minute
hour
day
```

---

# 24. Image / Raw Data Size

非圧縮画像データ量を計算する。

入力:

```text
Width
Height
Channels
Bits per channel
Number of images
```

例:

```text
1920
×
1080
×
3
×
8bit
```

結果:

```text
6.22 MB
5.93 MiB
```

---

# 25. 共通 Data Size Engine

内部的には各Scale Calculatorで同じData Size Engineを使用する。

```text
Vector
   │
LLM
   │
Image
   │
Transfer
   │
   ▼
┌─────────────────────┐
│ Data Size Engine    │
│                     │
│ bits / bytes        │
│ SI / IEC conversion │
└─────────────────────┘
```

これにより、

```text
GB / GiB
MB / MiB
```

の扱いを全機能で統一する。

---

# 26. Internal Unit Architecture

単位定義はUIコードに直接書かない。

例:

```typescript
interface UnitDefinition {
  id: string
  symbol: string
  name: string
  category: string
  factor?: number
}
```

例:

```typescript
{
  id: "kilometer",
  symbol: "km",
  name: "Kilometer",
  category: "length",
  factor: 1000
}
```

---

# 27. Category Definition

```typescript
interface UnitCategory {
  id: string
  name: string
  baseUnit: string
  units: UnitDefinition[]
}
```

例:

```typescript
{
  id: "length",
  name: "Length",
  baseUnit: "meter",
  units: [...]
}
```

---

# 28. Conversion Engine

基本変換:

```text
Input Unit
     ↓
Base Unit
     ↓
Output Unit
```

例:

```text
mile
↓
meter
↓
kilometer
```

この方式により、

N個の単位について

```text
N × N
```

の変換式を用意する必要がない。

---

# 29. Special Conversion

温度のように線形倍率だけでは変換できないものは、

```typescript
interface CustomUnitDefinition {
  toBase(value: number): number
  fromBase(value: number): number
}
```

として実装する。

---

# 30. Precision Policy

内部計算:

```text
JavaScript Number
```

表示時に丸める。

基本方針:

```text
有効数字 6〜10桁程度
```

ただし非常に大きい値・小さい値では指数表記を使用する。

例:

```text
1.23 × 10⁻⁹
1.23 × 10¹⁵
```

---

# 31. Input Formatting

以下の入力を許可する。

```text
1000000

1,000,000

1e6

1.5e-3
```

内部では標準数値に変換する。

---

# 32. URL State

可能であれば、計算状態をURLに保存できるようにする。

例:

```text
/calc/vector?vectors=1000000&dims=768&type=fp32
```

メリット:

- Bookmark
- Share
- Documentation
- Reproducibility

---

# 33. PWA / Offline

CalcArcはPWA利用との相性が良い。

オフライン対象:

```text
Unit Convert
Data Scale
```

完全オフライン。

Currencyのみ、

```text
Rate Update
```

にネットワークを使用する。

---

# 34. Network Policy

アプリ起動時に外部通信を必須にしない。

Currencyページを開いた時点で、

```text
cached data
```

を最初に表示する。

その後必要に応じてレート更新を行う。

これによりUIをネットワーク待ちにしない。

---

# 35. Error Handling

Currency API取得失敗時:

```text
最新レート取得失敗
```

を致命的エラーにはしない。

キャッシュが存在すれば、

```text
Using cached rate
Rate date: YYYY-MM-DD
```

として継続する。

キャッシュも存在しない場合のみ、

```text
Exchange rates are not available.
Connect to the internet to download rates.
```

を表示する。

---

# 36. Favorite / Recent

将来追加候補。

よく使う変換を保存する。

例:

```text
JPY ↔ USD
km ↔ mile
kg ↔ lb
GB ↔ GiB
```

Recent:

```text
最近使ったConverter
```

を表示する。

---

# 37. 初期リリース範囲

まずは以下までを実装する。

## Convert

```text
Length
Area
Volume
Mass
Temperature
Speed
Data Size
Currency
```

## Scale

```text
Generic Data Size
Vector / Embedding
LLM Model
Data Transfer
```

---

# 38. 第2段階

追加候補:

```text
Pressure
Energy
Power
Time
Image / Raw Data
```

---

# 39. 第3段階

必要性を見て検討する。

```text
Storage cost
Cloud transfer cost
Video bitrate
Audio bitrate
Token / context size
LLM KV Cache
GPU VRAM estimation
Training memory
```

特に、

```text
LLM KV Cache
GPU memory
```

についてはモデルアーキテクチャ依存が大きいため、初期実装には含めない。

---

# 40. CalcArcとしての位置付け

一般的なUnit Converterとの差別化は、

```text
単位変換
+
データスケール
+
コンピューター / AI向け計算
```

に置く。

つまり、

```text
Convert physical quantities.

Understand data scale.
```

という2つの用途を同じアプリで扱う。

日常用途では、

```text
mile → km
USD → JPY
lb → kg
```

技術用途では、

```text
GB → GiB

1M vectors × 768 × FP32

32B parameters × INT4

100 Mbps × 3 hours
```

を扱える。

---

# 41. 設計上の原則

CalcArcでは以下を基本原則とする。

### 1. Client-side First

計算は可能な限りブラウザ内で完結する。

### 2. Offline First

ネットワークなしでも基本機能を利用可能にする。

### 3. No Account

単位変換・Scale計算にユーザー登録を要求しない。

### 4. Transparent Calculation

計算式を可能な限り確認できるようにする。

### 5. SI / IECを正確に扱う

特にデータサイズでは、

```text
GB ≠ GiB
```

を曖昧にしない。

### 6. External Dependencyを最小化

通貨レート以外は外部APIに依存しない。

### 7. Extensible

新しいCalculatorを追加しても既存ロジックへの影響を小さくする。

---

# 42. 最終的な画面構成案

```text
CalcArc

Convert
├── Length
├── Area
├── Volume
├── Mass
├── Temperature
├── Speed
├── Pressure
├── Energy
├── Data Size
└── Currency

Scale
├── Data Size
├── Vector / Embedding
├── LLM Model
├── Data Transfer
└── Image Data
```

トップページには、

```text
Frequently Used

Data Size
Currency
Length
Vector Size
LLM Model Size
```

などをカード形式で配置することも検討する。

---

# 43. 実装優先順位

実装順序としては以下を推奨する。

```text
1. 共通Unit Engine
2. Data Size Engine
3. 基本Unit Converter
4. Vector Scale
5. LLM Model Scale
6. Currency Cache
7. Currency Provider
8. Currency UI
9. その他Scale Calculator
```

特に、

```text
Unit Engine
Data Size Engine
```

の2つを先に独立して作ることで、その後のCalculator追加を容易にする。