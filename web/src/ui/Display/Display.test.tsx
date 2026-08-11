import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DisplayState } from "../../calc";
import { Display } from "./Display";

function state(overrides: Partial<DisplayState> = {}): DisplayState {
  return {
    main: "0",
    angle: "Deg",
    form: "Rect",
    pendingOp: null,
    pendingDepth: 0,
    error: null,
    ...overrides,
  };
}

describe("Display", () => {
  it("shows the main value", () => {
    render(<Display display={state({ main: "5 ∠ 53.13010235" })} />);
    expect(screen.getByTestId("display-main")).toHaveTextContent(
      "5 ∠ 53.13010235",
    );
  });

  it("announces changes to a screen reader", () => {
    // 結果は視覚以外でも伝わる必要がある(base-spec §43)。
    render(<Display display={state()} />);
    expect(screen.getByTestId("display-main")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("shows the angle mode", () => {
    render(<Display display={state({ angle: "Deg" })} />);
    expect(screen.getByTestId("display-angle")).toHaveTextContent("DEG");
    render(<Display display={state({ angle: "Rad" })} />);
    expect(screen.getAllByTestId("display-angle")[1]).toHaveTextContent("RAD");
  });

  it("marks the polar display form", () => {
    render(<Display display={state({ form: "Polar" })} />);
    expect(screen.getByTestId("display-form")).toHaveTextContent("∠");
  });

  it("leaves the form indicator empty in rectangular form", () => {
    render(<Display display={state({ form: "Rect" })} />);
    expect(screen.getByTestId("display-form")).toBeEmptyDOMElement();
  });

  it("shows the pending operator and parenthesis depth", () => {
    render(<Display display={state({ pendingOp: "Mul", pendingDepth: 2 })} />);
    expect(screen.getByTestId("display-pending")).toHaveTextContent("((");
    expect(screen.getByTestId("display-pending")).toHaveTextContent("×");
  });

  it("marks an error state", () => {
    render(
      <Display
        display={state({ main: "Math ERROR", error: "DivisionByZero" })}
      />,
    );
    const main = screen.getByTestId("display-main");
    expect(main).toHaveTextContent("Math ERROR");
    expect(main).toHaveAttribute("data-error", "DivisionByZero");
  });

  it("has no error attribute when there is no error", () => {
    render(<Display display={state()} />);
    expect(screen.getByTestId("display-main")).not.toHaveAttribute(
      "data-error",
    );
  });
});
