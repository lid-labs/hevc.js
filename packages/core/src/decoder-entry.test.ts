import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Package imports reachable from a source file through its relative imports.
 * A bundler keeps every package import it reaches — mp4box declares no
 * `sideEffects`, so it stays even unused — so this is what the
 * decoder-only entry point costs an app beyond its own code.
 */
function packageImports(entry: URL): Set<string> {
  const packages = new Set<string>();
  const seen = new Set<string>();
  const visit = (file: URL) => {
    if (seen.has(file.href)) return;
    seen.add(file.href);
    const source = readFileSync(file, "utf8");
    for (const [, specifier] of source.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)) {
      if (specifier!.startsWith(".")) visit(new URL(specifier!.replace(/\.js$/, ".ts"), file));
      else packages.add(specifier!);
    }
  };
  visit(entry);
  return packages;
}

describe("@hevcjs/core/decoder", () => {
  it("reaches no package, mp4box in particular", () => {
    expect([...packageImports(new URL("./decoder-entry.ts", import.meta.url))]).toEqual([]);
  });

  it("would catch one: the main entry reaches mp4box", () => {
    expect(packageImports(new URL("./index.ts", import.meta.url))).toContain("mp4box");
  });
});
