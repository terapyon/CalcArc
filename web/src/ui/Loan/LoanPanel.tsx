import { useEffect, useState } from "react";
import { initLoan, type LoanCalc, type LoanMode } from "../../loan";
import styles from "./LoanPanel.module.css";

// u64 の 10 進最大 20 桁。これを超える入力はコアが Overflow / SyntaxError と
// して教えるので、ここでは切り詰めるだけでよい(DataScalePanel と同じ流儀)。
const MAX_DIGITS = 20;

const MODE_LABELS: { id: LoanMode; label: string }[] = [
  { id: "payment", label: "月々の返済額" },
  { id: "principal", label: "借入可能額" },
  { id: "term", label: "返済期間" },
];

/** 表示のための桁区切り。円は number に収まらないので文字列のまま加工する。 */
function grouped(amount: string): string {
  return amount.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

interface Line {
  label: string;
  value: string;
}

export function LoanPanel() {
  const [calc, setCalc] = useState<LoanCalc | null>(null);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<LoanMode>("payment");
  const [principal, setPrincipal] = useState("");
  const [rate, setRate] = useState("");
  const [months, setMonths] = useState("");
  const [payment, setPayment] = useState("");
  const [residual, setResidual] = useState("");
  const [bonusPrincipal, setBonusPrincipal] = useState("");
  const [bonusPayment, setBonusPayment] = useState("");

  useEffect(() => {
    let cancelled = false;
    initLoan().then(
      (loaded) => {
        if (!cancelled) setCalc(loaded);
      },
      () => {
        // WASM が読めなければ何も計算できない。読み込み中のまま固まらせず、
        // 起きたことを伝える(DataScalePanel と同じ流儀)。
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <p role="alert" data-testid="loan-load-error">
        計算エンジンを読み込めませんでした。ページを再読み込みしてください。
      </p>
    );
  }

  // 欄の可否はモードが決める。求める値の欄は入力できない(それが答だから)。
  // 残価は月額モードのみ、ボーナスは期間モードで無効(設計書 §3/§4)。
  // 値は保持する —— モードを行き来しても入力が消えない。
  const principalEnabled = mode !== "principal";
  const paymentEnabled = mode !== "payment";
  const monthsEnabled = mode !== "term";
  const bonusEnabled = mode !== "term";
  // 残価とボーナスは併用しない。コアに「残価つきボーナス併用」のモデルが
  // 無い(設計書 §3 は残価を正算のみ、§4 はボーナスを 2 列独立と決めており、
  // 両者を重ねた式は決めていない)。どちらか一方が埋まっている間、他方を
  // 無効にして、決めていない計算を UI から要求できないようにする。
  const bonusValue = mode === "principal" ? bonusPayment : bonusPrincipal;
  const residualEnabled = mode === "payment" && bonusValue === "";
  const bonusUsable = bonusEnabled && !(mode === "payment" && residual !== "");

  const monthsNumber = /^\d+$/.test(months) ? Number(months) : 0;
  const ready =
    calc !== null &&
    rate !== "" &&
    (principalEnabled ? principal !== "" : true) &&
    (paymentEnabled ? payment !== "" : true) &&
    (monthsEnabled ? months !== "" : true);

  // 結果は保持しない。空欄は SyntaxError ではなく中立なので、必要な欄が
  // 埋まっているときだけ計算する(DataScalePanel と同じ理由: state に持つと
  // 入力とずれた古い結果を見せうる二重管理になる)。
  let error: string | null = null;
  let lines: Line[] = [];
  if (ready && calc) {
    if (mode === "payment") {
      if (bonusUsable && bonusPrincipal !== "") {
        const r = calc.bonusForward(
          principal,
          bonusPrincipal,
          rate,
          monthsNumber,
        );
        error = r.error;
        if (!r.error && r.monthlyPayment && r.bonusPayment) {
          lines = [
            { label: "月々の返済額", value: `${grouped(r.monthlyPayment)} 円` },
            {
              label: "ボーナス回の返済額",
              value: `${grouped(r.bonusPayment)} 円`,
            },
            ...totals(r.totalPayment, r.totalInterest),
          ];
        }
      } else {
        const r = calc.forward(
          principal,
          rate,
          monthsNumber,
          residualEnabled && residual !== "" ? residual : "0",
        );
        error = r.error;
        if (!r.error && r.monthlyPayment) {
          lines = [
            { label: "月々の返済額", value: `${grouped(r.monthlyPayment)} 円` },
            ...(residualEnabled && residual !== "" && r.finalPayment
              ? [
                  {
                    label: "最終回(残価)",
                    value: `${grouped(r.finalPayment)} 円`,
                  },
                ]
              : []),
            ...totals(r.totalPayment, r.totalInterest),
          ];
        }
      }
    } else if (mode === "principal") {
      if (bonusUsable && bonusPayment !== "") {
        const r = calc.bonusPrincipal(
          payment,
          bonusPayment,
          rate,
          monthsNumber,
        );
        error = r.error;
        if (!r.error && r.totalPrincipal && r.monthlyPrincipal) {
          lines = [
            { label: "借入可能額", value: `${grouped(r.totalPrincipal)} 円` },
            {
              label: "うち月払い分",
              value: `${grouped(r.monthlyPrincipal)} 円`,
            },
            ...(r.bonusPrincipal
              ? [
                  {
                    label: "うちボーナス分",
                    value: `${grouped(r.bonusPrincipal)} 円`,
                  },
                ]
              : []),
            ...totals(r.totalPayment, r.totalInterest),
          ];
        }
      } else {
        const r = calc.principal(payment, rate, monthsNumber);
        error = r.error;
        if (!r.error && r.principal) {
          lines = [
            { label: "借入可能額", value: `${grouped(r.principal)} 円` },
            ...totals(r.totalPayment, r.totalInterest),
          ];
        }
      }
    } else {
      const r = calc.term(principal, rate, payment);
      error = r.error;
      if (!r.error && r.months !== null) {
        lines = [
          { label: "返済回数", value: `${r.months} か月` },
          ...totals(r.totalPayment, r.totalInterest),
        ];
      }
    }
  }

  return (
    <section className={styles.panel} aria-label="ローン計算">
      <div className={styles.field}>
        <label htmlFor="loan-mode">何を求めるか</label>
        <select
          id="loan-mode"
          value={mode}
          onChange={(event) => setMode(event.target.value as LoanMode)}
        >
          {MODE_LABELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <Field
        id="loan-principal"
        label="借入額"
        value={principal}
        onChange={setPrincipal}
        enabled={principalEnabled}
      />
      <Field
        id="loan-rate"
        label="年利(%)"
        value={rate}
        onChange={setRate}
        enabled
        inputMode="decimal"
      />
      <Field
        id="loan-months"
        label="返済回数(月)"
        value={months}
        onChange={setMonths}
        enabled={monthsEnabled}
      />
      <Field
        id="loan-payment"
        label="月々の返済額"
        value={payment}
        onChange={setPayment}
        enabled={paymentEnabled}
      />
      <Field
        id="loan-residual"
        label="残価"
        value={residual}
        onChange={setResidual}
        enabled={residualEnabled}
      />
      <Field
        id="loan-bonus"
        label={
          mode === "principal" ? "ボーナス回の返済額" : "ボーナス返済分(元本)"
        }
        value={bonusValue}
        onChange={mode === "principal" ? setBonusPayment : setBonusPrincipal}
        enabled={bonusUsable}
      />

      {/* <output> の暗黙ロールは status なので role 属性は付けない
          (biome/a11y/noRedundantRoles)。 */}
      <output className={styles.result}>
        {error ? (
          <p data-error={error}>Math ERROR</p>
        ) : (
          lines.map((line) => (
            <p key={line.label}>
              <span className={styles.resultLabel}>{line.label}</span>
              {line.value}
            </p>
          ))
        )}
      </output>

      {/* 免責は常設(設計書 §0)。エラーではないので alert にしない。 */}
      <p className={styles.disclaimer}>
        実際の返済額は金融機関の計算方法により異なります。
      </p>
    </section>
  );
}

function totals(
  totalPayment: string | null,
  totalInterest: string | null,
): Line[] {
  const out: Line[] = [];
  if (totalPayment)
    out.push({ label: "総支払額", value: `${grouped(totalPayment)} 円` });
  if (totalInterest)
    out.push({ label: "総利息", value: `${grouped(totalInterest)} 円` });
  return out;
}

function Field({
  id,
  label,
  value,
  onChange,
  enabled,
  inputMode = "numeric",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  enabled: boolean;
  inputMode?: "numeric" | "decimal";
}) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        inputMode={inputMode}
        autoComplete="off"
        maxLength={MAX_DIGITS}
        value={value}
        disabled={!enabled}
        aria-disabled={!enabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
