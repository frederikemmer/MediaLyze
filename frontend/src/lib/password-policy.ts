export function passwordRequirementStatus(value: string) {
  return {
    length: Array.from(value).length >= 5,
    character: /[\p{Nd}]|[^\p{L}\p{N}\s]/u.test(value),
  };
}

export function validNewPassword(value: string): boolean {
  const status = passwordRequirementStatus(value);
  return status.length && status.character;
}
