import { afterEach, describe, expect, it, vi } from "vitest";
import * as browser from "@simplewebauthn/browser";
import * as access from "./access-session";
import { authenticatePasskey, registerPasskey } from "./passkeys";

vi.mock("@simplewebauthn/browser", () => ({
  startRegistration: vi.fn(), startAuthentication: vi.fn(), browserSupportsWebAuthn: vi.fn(),
  WebAuthnAbortService: { cancelCeremony: vi.fn() },
}));
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });
describe("Passkey ceremony identity boundary", () => {
  it("does not finish registration after the account session changes during the browser prompt", async () => {
    const request = vi.spyOn(access, "accessRequest").mockResolvedValue({ challenge_id: "challenge", options: {} });
    let finish!: (value: never) => void;
    vi.mocked(browser.startRegistration).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = registerPasskey("Laptop", "test-secret", vi.fn());
    await vi.waitFor(() => expect(finish).toBeDefined());
    access.clearIdentityRequests();
    finish({} as never);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("/me/passkeys/options", expect.any(Object));
  });
  it("does not sign in after the session changes during the browser prompt", async () => {
    const request = vi.spyOn(access, "accessRequest").mockResolvedValue({ challenge_id: "challenge", options: {} });
    let finish!: (value: never) => void;
    vi.mocked(browser.startAuthentication).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = authenticatePasskey();
    await vi.waitFor(() => expect(finish).toBeDefined());
    access.clearIdentityRequests();
    finish({} as never);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
