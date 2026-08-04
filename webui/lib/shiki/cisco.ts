import type { LanguageRegistration } from "shiki"
import grammar from "./cisco.tmLanguage.json"

/**
 * Shiki language for Cisco IOS / IOS-XE / IOS-XR / NX-OS config and CLI output.
 *
 * Shiki ships no Cisco grammar. `cisco.tmLanguage.json` is a TextMate port of
 * the Prism grammar from obsidian-cisco-syntax
 * (https://github.com/blakebratcher/obsidian-cisco-syntax, MIT © Blake
 * Bratcher) — its regexes and keyword lists, re-expressed as TextMate patterns.
 *
 * Two differences forced by TextMate, both deliberate:
 *
 * - Prism re-tokenizes lookbehind groups; TextMate cannot. So for the secret
 *   patterns (`password`, `snmp-server community`, pre-shared keys…) the
 *   command prefix is scoped as a keyword outright and only the value gets the
 *   secret scope. Same shape for a line-leading `no` / `default`.
 * - The keyword and protocol alternations are case-sensitive here. Oniguruma's
 *   inline `(?i)` does not survive Shiki's JS regex engine reliably, and Cisco
 *   config is written lowercase. Interface names (`GigabitEthernet0/1`) were
 *   already case-sensitive upstream and are unaffected.
 *
 * Registered in `lib/docs-render.tsx`; use it with a ```cisco fence.
 */
export const ciscoLang = grammar as unknown as LanguageRegistration
