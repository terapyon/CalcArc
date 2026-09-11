# CalcArc Quick Guide

The latest PDF (with screenshots) is on the GitHub Releases page: https://github.com/terapyon/CalcArc/releases

## Glossary

The screen is in Japanese. This guide writes each key or button name exactly
as it appears on the screen, in lenticular brackets like 【AC】, so you can find
it. The table gives the meaning of the Japanese names used in this guide.

| On-screen name | Meaning |
|---|---|
| 【値】 | value |
| 【変換元】 | convert from |
| 【変換先】 | convert to |
| 【借入額】 | loan amount |
| 【返済月額】 | monthly repayment |
| 【借入可能額】 | borrowable amount |
| 【返済期間】 | repayment term |
| 【複利残高】 | compound balance |
| 【必要積立額】 | required contribution |
| 【必要年数】 | periods needed |
| 【万】 | × 10,000 |
| 【億】 | × 100,000,000 |
| 【年】 | years |
| 【すべて消す】 | delete all |
| 【今後の計算を記録する】 | record future calculations |

## 1. What CalcArc is

CalcArc is a set of calculation tools that run in the browser: a scientific
calculator, unit conversion, data-size estimates, and loan and compound-interest
calculations.

- Open it at https://calc.terapyon.net/
- No installation is needed. It works in the browser
- Add it to your home screen to open it like an app
- Once it has been opened, it is built to keep working without a network
  (fetching exchange rates is the one thing that needs a network). Working without a
  network has been checked only in Chrome-type browsers, not yet in Safari on iPhone
- The layout is checked on screens from 360px wide in Chrome on Android and similar browsers,
  and from 375px wide in Safari on iPhone. Narrower screens (such as 320px) still show the app,
  but nothing checks that the layout holds there

## 2. The four tabs

There are four tabs at the top of the screen. Press one to switch screens.

| Tab | What it does |
|---|---|
| 【Scientific】 | Scientific calculator |
| 【Convert】 | Unit conversion (length, mass, temperature, area, volume, speed, data size, currency) |
| 【Scale】 | Data-size, LLM memory, and data-transfer estimates |
| 【Finance】 | Loan and compound-interest calculations |

In 【Convert】 and 【Scale】, choose the kind of calculation in the field just
below the tabs (for example, 【為替 Currency】).

Each screen has its own URL, so you can bookmark the screens you use often.

![Screen: Scientific (just opened)](shot:tab-scientific)

![Screen: Convert (length, converting 10 km)](shot:tab-convert)

![Screen: Scale (data size, 1,000,000 items of 768 dimensions)](shot:tab-scale)

![Screen: Finance (monthly repayment for 30,000,000 yen at 1.5% a year over 35 years)](shot:tab-finance)

## 3. Basic use

### Scientific

It works like an ordinary calculator.

1. Press digits and 【+】 【−】 【×】 【÷】
2. Press 【=】 to calculate
3. If you mistype, 【DEL】 deletes one character and 【AC】 clears everything

- Multiplication and division come before addition and subtraction
  (【2】 【+】 【3】 【×】 【4】 【=】 gives 14)
- Functions such as 【sin】 and 【√】 apply at once to the number on the display
  (with the angle unit at "DEG", 【3】 【0】 【sin】 gives 0.5)
- When there is no answer, the display shows "Math ERROR". Then only 【AC】 works

### Convert, Scale, and Finance

On these three tabs, choose an item first, then enter its number.

1. Choose the item to enter with the keys above the digits (for example,
   【借入額】 (loan amount) on Finance)
2. Type the number
3. As soon as the items it needs are filled, the answer appears

- 【DEL】 deletes one character of the item you have chosen
- 【AC】 resets only the item you have chosen. The other items stay
- Items you have filled in stay on the display, in small type above the answer
- On Convert and Finance you can type an expression into an item. 【=】 turns the
  expression into its value
- Keys that cannot be pressed right now look disabled. Some become available when
  you change the item or the kind of calculation; others are not used on that screen

## 4. What each tab does

### Scientific — scientific calculator

Besides arithmetic and parentheses, it has 【sin】 【cos】 【tan】, 【ln】 【log】,
【√】 【x²】 【xʸ】 【1/x】 【eˣ】. Press 【Shift】 to switch some keys to their
second function (【asin】 【acos】 【atan】 【n!】 【nPr】 【nCr】 and others).

It also has complex numbers (【j】), switching to polar form (【▸∠】),
base-60 (【°′″】), engineering notation (【ENG】), and switching the angle unit
(【DRG】).

Calculations that give an answer with 【=】 are kept in the history. Open it
with 【Shift】 then 【hist】.

### Convert — unit conversion

Type a number into 【値】 (value), and choose units with 【変換元】 (convert from)
and 【変換先】 (convert to). 【⇅】 swaps the two. There are eight categories:
length, mass, temperature, area, volume, speed, data size, and currency.

Currency is converted with rates fetched from the internet.

### Scale — data-size estimates

- 【データ量 Data Scale】: from count × dimensions × data type, the memory needed,
  in decimal (KB, MB, GB, …) and binary (KiB, MiB, GiB, …) units
- 【LLM のメモリ LLM Memory】: from the parameter count, number of layers and so on,
  the memory for an LLM's weights and KV cache
- 【データ転送 Data Transfer】: from bandwidth and time, the amount of data that
  can be transferred

### Finance — financial calculations

Choose what to find on the upper row, and the items to enter on the lower row.

- Loans (equal principal and interest): 【返済月額】 (monthly repayment),
  【借入可能額】 (borrowable amount), 【返済期間】 (repayment term)
- Compound interest: 【複利残高】 (compound balance), 【必要積立額】 (required
  contribution), 【必要年数】 (periods needed)

Amounts can be typed with 【万】 (× 10,000) and 【億】 (× 100,000,000)
(for example, 【3】 【0】 【0】 【0】 【万】 is 30,000,000). A loan term can be typed
in years with 【年】 (years): 【3】 【5】 【年】 is 420 months.

The answers are approximations produced by a fixed method. Matching the exact
figures of any lender is not a goal.

## 5. What is saved

CalcArc saves the following in the browser on this device. Nothing is sent out.

- **Settings**: the angle unit and display form of Scientific, the data type and
  main unit system of the data-size screen, the kind of calculation, method, and
  tax on Finance, and whether to record history
- **History**: calculations that gave an answer with 【=】 on Scientific
  (up to 50, newest first)
- **Exchange rates**: the last rate table that was fetched

Half-typed expressions and the numbers you have entered into items are not saved.

**Saved settings and history may be lost when the version changes.** Keeping them
is not promised.

You can delete history on the screen opened with 【Shift】 then 【hist】: one entry
with the 【×】 beside it, or all of them with 【すべて消す】 (delete all).
Unchecking 【今後の計算を記録する】 (record future calculations) stops recording
from then on (what is already recorded stays). 【AC】 does not delete history.

## 6. No warranty, and nothing is sent to a server

> **Results come with no warranty. Do not rely on them for decisions that matter.**
>
> This tool is provided under the Apache License 2.0 and, as that license states,
> without warranties or conditions of any kind, either express or implied.

The bottom of the screen also shows 「計算結果は無保証です。」 ("Results come with
no warranty."). The Finance screen always shows a note on how it calculates.

> Calculations complete entirely on-device; nothing is sent to a server.

## 7. Finding the version and what changed

The bottom of the screen shows "CalcArc" and the version number. Pressing it opens
CalcArc's page on GitHub. The version of this PDF is in its file name.

- What changed: https://github.com/terapyon/CalcArc/blob/main/CHANGELOG.md
- The record of each release, and the PDFs of this guide: https://github.com/terapyon/CalcArc/releases
- Questions, requests, and bugs: https://github.com/terapyon/CalcArc/issues
  (Japanese or English is fine. For a bug, it helps to list the keys you pressed, in order)
