import { countTokens, decode, encode } from "gpt-tokenizer/encoding/cl100k_base";

const plainText = { disallowedSpecial: new Set<string>() };

export function countTextTokens(text: string) {
  return text ? countTokens(text, plainText) : 0;
}

export function limitTextTokens(text: string, max: number, keepEnd = false) {
  if (!text || max <= 0) return "";
  const tokens = encode(text, plainText);
  if (tokens.length <= max) return text;
  return decode(keepEnd ? tokens.slice(-max) : tokens.slice(0, max));
}
