import { describe, expect, it } from "vitest";

import { generateTotp, hashPassword, randomTotpSecret, sha256, verifyPassword, verifyTotp } from "../../src/authn/crypto";

describe("authentication crypto", () => {
  it("hashes passwords with a unique salt and verifies in constant-work code", async () => {
    const first = await hashPassword("correct horse battery staple", 1_000);
    const second = await hashPassword("correct horse battery staple", 1_000);
    expect(first).not.toBe(second);
    expect(await verifyPassword("correct horse battery staple", first)).toBe(true);
    expect(await verifyPassword("incorrect password", first)).toBe(false);
  });

  it("generates and verifies time-based one-time passwords", async () => {
    const secret = randomTotpSecret();
    const at = 1_780_000_000_000;
    const code = await generateTotp(secret, at);
    expect(code).toMatch(/^\d{6}$/);
    expect(await verifyTotp(secret, code, at)).toBe(true);
    expect(await verifyTotp(secret, "000000", at)).toBe(code === "000000");
  });

  it("creates stable token hashes", async () => {
    expect(await sha256("refresh-token")).toBe(await sha256("refresh-token"));
    expect(await sha256("refresh-token")).not.toBe(await sha256("other-token"));
  });
});
