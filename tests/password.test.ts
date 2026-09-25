import { describe, expect, it } from "vitest";
import { passwordProblem } from "@/lib/password";

describe("passwordProblem", () => {
  const email = "jahshuab@gmail.com";
  it("accepts a long, varied password", () => {
    expect(passwordProblem("purple-808-drums-soul", "purple-808-drums-soul", email)).toBeNull();
  });
  it("rejects short, mismatched, repetitive or email-based passwords", () => {
    expect(passwordProblem("short", "short", email)).toBe("too_short");
    expect(passwordProblem("x".repeat(129), "x".repeat(129), email)).toBe("too_long");
    expect(passwordProblem("purple-808-drums", "purple-808-drum", email)).toBe("mismatch");
    expect(passwordProblem("Jahshuab-2026!!", "Jahshuab-2026!!", email)).toBe("is_email");
    expect(passwordProblem("121212121212", "121212121212", email)).toBe("too_simple");
  });
});
