import { useEffect, useState } from "react";
import { type Calc, initCalc, type Step } from "./calc";

export function App() {
  const [calc, setCalc] = useState<Calc | null>(null);
  const [step, setStep] = useState<Step | null>(null);

  useEffect(() => {
    let cancelled = false;
    initCalc().then((loaded) => {
      if (cancelled) return;
      setCalc(loaded);
      setStep(loaded.initial());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!calc || !step) {
    return <p>Loading…</p>;
  }

  return (
    <main>
      <output data-testid="display-main">{step.display.main}</output>
      <p data-testid="core-version">calcarc-core {calc.version()}</p>
    </main>
  );
}
