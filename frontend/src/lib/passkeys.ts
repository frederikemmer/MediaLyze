import { startAuthentication, startRegistration, browserSupportsWebAuthn, WebAuthnAbortService } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { accessRequest, identityGeneration } from "./access-session";

export type Passkey = { id: string; name: string; created_at: number; last_used_at: number | null; rp_id: string };
export type PasskeyList = { enabled: boolean; reason: string; items: Passkey[] };
export function supportsPasskeys() {
  return window.isSecureContext && browserSupportsWebAuthn();
}
function ensureCurrent(generation: number) {
  if (generation !== identityGeneration()) throw new DOMException("Identity changed", "AbortError");
}
export function passkeyCanceled(error: unknown) {
  return typeof error === "object" && error !== null && "name" in error &&
    ["NotAllowedError", "AbortError"].includes(String(error.name));
}
export async function registerPasskey(name: string, password: string, optionsReceived: () => void, signal?: AbortSignal) {
  const generation = identityGeneration();
  const cancel = () => WebAuthnAbortService.cancelCeremony();
  signal?.addEventListener("abort", cancel, { once: true });
  const ensureActive = () => {
    ensureCurrent(generation);
    if (signal?.aborted) throw new DOMException("Canceled", "AbortError");
  };
  try {
    ensureActive();
    const result = await accessRequest<{ challenge_id: string; options: PublicKeyCredentialCreationOptionsJSON }>("/me/passkeys/options", {
      method: "POST", body: JSON.stringify({ name, password }), signal,
    });
    optionsReceived();
    ensureActive();
    const credential = await startRegistration({ optionsJSON: result.options });
    ensureActive();
    return await accessRequest<Passkey>("/me/passkeys/verify", {
      method: "POST", body: JSON.stringify({ challenge_id: result.challenge_id, credential }), signal,
    });
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}
export async function authenticatePasskey() {
  const generation = identityGeneration();
  const result = await accessRequest<{ challenge_id: string; options: PublicKeyCredentialRequestOptionsJSON }>("/auth/passkeys/options", { method: "POST" });
  ensureCurrent(generation);
  const credential = await startAuthentication({ optionsJSON: result.options });
  ensureCurrent(generation);
  await accessRequest("/auth/passkeys/verify", {
    method: "POST", body: JSON.stringify({ challenge_id: result.challenge_id, credential }),
  });
}
