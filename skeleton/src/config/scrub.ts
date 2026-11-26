/** Replaces every secret of 6 characters or more in `text`; shorter ones would mask ordinary words. */
export function scrub(text: string, secrets: string[]): string {
  return secrets.filter((s) => s.length >= 6).reduce((t, s) => t.split(s).join('••••'), text);
}
