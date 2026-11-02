import { describe, expect, it } from "vitest";
import { validNewPassword } from "./password-policy";
describe("Password requirements", () => {
  it.each(["abcd1", "abcd!", "12345", "äöüß1", "a".repeat(300) + "1"])(
    "accepts %s",
    (value) => expect(validNewPassword(value)).toBe(true),
  );
  it.each(["abcde", "abc1", "abcd ", "     "])("rejects %s", (value) =>
    expect(validNewPassword(value)).toBe(false),
  );
});
