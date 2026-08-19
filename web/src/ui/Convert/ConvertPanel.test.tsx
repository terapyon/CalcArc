import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConvertPanel } from "./ConvertPanel";

describe("ConvertPanel", () => {
  it("names itself as not ready yet", () => {
    render(<ConvertPanel />);
    expect(
      screen.getByRole("region", { name: "単位変換（準備中）" }),
    ).toBeInTheDocument();
  });

  it("says what will live here", () => {
    // **押して何も起きない面を作らない**(設計書 §5)。押せば画面が変わり、
    // その画面が何が来るかを言う。
    render(<ConvertPanel />);
    expect(screen.getByText("単位変換は準備中です。")).toBeInTheDocument();
    expect(
      screen.getByText("長さ・重さ・温度・通貨などの変換をここに置きます。"),
    ).toBeInTheDocument();
  });
});
