export function validNewPassword(value: string): boolean {
  return (
    Array.from(value).length >= 5 && /[\p{Nd}]|[^\p{L}\p{N}\s]/u.test(value)
  );
}
