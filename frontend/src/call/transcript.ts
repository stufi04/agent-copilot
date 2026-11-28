// The call transcript: alternating lines from the caller ("user") and the agent ("bot").
// Pure functions, so the merging rules are easy to test.

export interface Line {
  role: 'user' | 'bot';
  /** What's been said for certain. */
  text: string;
  /** Speech recognition's current guess at what's being said now; replaced as it improves. */
  interim?: string;
}

const join = (a: string, b: string) => (a ? `${a} ${b.trim()}` : b.trim());

/**
 * What the caller said. Interim guesses replace each other until the final text
 * arrives; consecutive final pieces join into one line until the agent speaks.
 */
export function addUserSpeech(lines: Line[], text: string, final: boolean): Line[] {
  if (!text.trim()) return lines;
  const last = lines[lines.length - 1];
  const current: Line = last?.role === 'user' ? last : { role: 'user', text: '' };
  const next: Line = final ? { role: 'user', text: join(current.text, text) } : { ...current, interim: text.trim() };
  return current === last ? [...lines.slice(0, -1), next] : [...lines, next];
}

/** What the agent said: sentences join into one line until the caller speaks. */
export function addBotSpeech(lines: Line[], text: string): Line[] {
  if (!text.trim()) return lines;
  const last = lines[lines.length - 1];
  if (last?.role === 'bot') return [...lines.slice(0, -1), { role: 'bot', text: join(last.text, text) }];
  return [...lines, { role: 'bot', text: text.trim() }];
}
