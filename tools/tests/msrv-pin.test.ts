import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **`ci.yml` の `Rust MSRV` は、`Cargo.toml` の `rust-version` と同じ版で回す。**
 *
 * **宣言だけでは何も守らない。** `rust-version = "1.87"` のあいだに let チェーン
 * (1.88 から)が 4 か所入り、`cargo +1.87.0 check` は `E0658` で落ちるのに、
 * 手元も CI も stable で回していたので誰も気づかなかった(台帳
 * `docs/superpowers/sdd/2026-10-06-rust-review-backlog.md` §1)。
 *
 * 見るのは 3 か所: 宣言、ジョブの `toolchain:`、`cargo +<版>` の各行。
 * **`+<版>` も見るのは、`rust-toolchain.toml` の `channel = "stable"` が rustup の
 * 既定より優先されるから**——`toolchain:` だけを上げて `+` を据え置くと、古い版で
 * 回って緑になる。
 */
const ROOT = join(import.meta.dirname, "..", "..");

const declared = (() => {
  const m = /^rust-version = "(\d+\.\d+)"$/m.exec(
    readFileSync(join(ROOT, "Cargo.toml"), "utf8"),
  );
  return m?.[1];
})();

/** `ci.yml` の `msrv:` ジョブの行(次のジョブの鍵の手前まで)。**註の行は読まない。** */
const msrvLines = (() => {
  const lines = readFileSync(
    join(ROOT, ".github", "workflows", "ci.yml"),
    "utf8",
  ).split("\n");
  const start = lines.indexOf("  msrv:");
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}\S/.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).filter(
    (line) => !/^\s*#/.test(line),
  );
})();

const toolchains = msrvLines.flatMap((line) => {
  const m = /^\s*toolchain:\s*(\S+)\s*$/.exec(line);
  return m?.[1] === undefined ? [] : [m[1]];
});

const plusVersions = msrvLines.flatMap((line) =>
  /^\s*-?\s*run:/.test(line)
    ? [...line.matchAll(/cargo \+(\S+)/g)].map((m) => m[1])
    : [],
);

describe("MSRV の固定", () => {
  it("Cargo.toml が rust-version を 2 つの数で宣言している", () => {
    expect(declared).toBeDefined();
  });

  it("ci.yml に msrv のジョブが在り、toolchain を 1 つだけ書いている", () => {
    expect(toolchains).toHaveLength(1);
  });

  it("toolchain は宣言の版に .0 を付けた綴りである", () => {
    expect(toolchains).toEqual([`${declared}.0`]);
  });

  it("cargo の行はどれも +<版> で同じ版を指す（0 件で緑にならない）", () => {
    const runs = msrvLines.filter((line) => /^\s*-?\s*run:/.test(line));
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(plusVersions).toHaveLength(runs.length);
    expect(plusVersions.filter((v) => v !== `${declared}.0`)).toEqual([]);
  });
});
