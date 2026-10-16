import { describe, expect, it } from "vitest";
import { generateSecret, totpAt, verifyTotp } from "../modules/auth/otp.service.js";

describe("TOTP", () => {
  it("matches the RFC 6238 SHA-1 test vector (secret '12345678901234567890', t=59 -> 94287082, last 6 = 287082)", () => {
    const b32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(totpAt(b32, 59000)).toBe("287082");
  });
  it("accepts the current code, rejects a wrong one", () => {
    const s = generateSecret();
    expect(verifyTotp(totpAt(s), s)).toBe(true);
    expect(verifyTotp("000000" === totpAt(s) ? "111111" : "000000", s)).toBe(false);
  });
});
