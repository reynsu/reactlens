// EventIngestion — the typed boundary between untyped data sources
// (stdin lines from the Playwright reporter, WS frames from the probe,
// JSONL lines from a persisted run) and the canonical RunEvent shape
// the rest of reactlens consumes.
//
// CLAUDE.md §13 forbids bypassing parseRunEvent at any untyped
// ingestion point. Before this module, that was a written rule
// duplicated across 5 call sites (each one independently did
// `parseRunEvent(JSON.parse(raw))`). This module makes the rule a
// typed Interface — adding a 6th source (CI artifact upload, future
// probe variant) calls tryIngestRunEvent, not re-derives the pattern.
//
// Single function for now: re-reading the 5 existing call sites,
// ALL are soft-semantics (skip + null on either failure). The
// originally-proposed mustIngestRunEvent was dropped per LANGUAGE.md
// "one adapter = hypothetical seam" — every site that currently parses
// a RunEvent wants tolerance to corruption, even the RunsArea metadata
// spot-checks (the runs picker must not blow up when one persisted
// run has a malformed events.jsonl). When a "must" caller appears
// (CI artifact import was the canonical example), add it then with
// real callers, not on speculation.
//
// The underlying parseRunEvent + runEventSchema stay in events.ts as
// the contract. This module is a thin wrapper that adds JSON.parse +
// error-handling semantics.
import { parseRunEvent, type RunEvent } from './events';

// Returns null on any failure (malformed JSON OR schema mismatch).
//
// Accepts both `string` (stdin lines, JSONL) and `Buffer` (WS frames)
// without forcing the caller to .toString() first.
export function tryIngestRunEvent(raw: string | Buffer): RunEvent | null {
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return parseRunEvent(parsed);
}
