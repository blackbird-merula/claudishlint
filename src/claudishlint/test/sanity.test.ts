import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { test } from "node:test"
import { lint } from "../index.ts"

/**
 * Sanity test on real data.
 *
 * Positive class: every PR description in the load-bearing corpus
 * (data/raw/load-bearing, cloned from github.com/louisabraham/load-bearing)
 * created 2026-04-01 or later — overwhelmingly AI-authored by then. Plus a
 * second positive class: the claudish side of data/claudish_pairs.jsonl.
 * Negative class: the English side of data/claudish_pairs.jsonl — plain
 * English that must not be flagged.
 *
 * The fixtures are derived data and gitignored. Regenerate them from the
 * repo root with:
 *     python3 scripts/make_sanity_fixtures.py
 */
const POSITIVE = new URL("./fixtures/positive.jsonl", import.meta.url)
const POSITIVE_PAIRS = new URL(
	"./fixtures/positive-pairs.jsonl",
	import.meta.url,
)
const NEGATIVE = new URL("./fixtures/negative.jsonl", import.meta.url)

// Unflagged positives (recall misses) are written here so the linter's
// blind spots can be eyeballed. Derived data, gitignored.
const MISSES = new URL("./fixtures/missed-positive.jsonl", import.meta.url)

const RECALL_MIN = 0.2 // smallest positive-class flag rate we accept
const FP_MAX = 0.15 // largest negative-class flag rate we accept
const SEPARATION_MIN = 0.05 // recall must clear the fp rate by this much

interface RuleStats {
	findings: number
	docs: number
}

interface Stats {
	docs: number
	flagged: number
	findings: number
	words: number
	byRule: Map<string, RuleStats>
}

function loadFixture(url: URL): string[] {
	const text = readFileSync(url, "utf8")
	return text
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as string)
}

function measure(docs: string[], misses?: string[]): Stats {
	const stats: Stats = {
		docs: 0,
		flagged: 0,
		findings: 0,
		words: 0,
		byRule: new Map(),
	}
	for (const doc of docs) {
		stats.docs += 1
		stats.words += doc.split(/\s+/).length
		const findings = lint(doc)
		stats.findings += findings.length
		if (findings.length > 0) {
			stats.flagged += 1
		} else if (misses) {
			misses.push(doc)
		}
		const seen = new Set<string>()
		for (const f of findings) {
			let rule = stats.byRule.get(f.ruleId)
			if (!rule) {
				rule = { findings: 0, docs: 0 }
				stats.byRule.set(f.ruleId, rule)
			}
			rule.findings += 1
			if (!seen.has(f.ruleId)) {
				seen.add(f.ruleId)
				rule.docs += 1
			}
		}
	}
	return stats
}

function pct(part: number, whole: number): string {
	return whole === 0 ? "n/a" : `${((part / whole) * 100).toFixed(1)}%`
}

function reportClass(label: string, s: Stats): void {
	console.log(`  ${label}`)
	console.log(`    docs      ${s.docs.toLocaleString("en-GB")}`)
	console.log(
		`    flagged   ${s.flagged.toLocaleString("en-GB")} (${pct(s.flagged, s.docs)})`,
	)
	console.log(
		`    findings  ${s.findings.toLocaleString("en-GB")} total  ${(s.findings / s.docs).toFixed(2)}/doc  ${((s.findings / s.words) * 1000).toFixed(2)}/1k words`,
	)
}

function topRules(s: Stats, n: number): void {
	const sorted = [...s.byRule.entries()]
		.sort((a, b) => b[1].docs - a[1].docs)
		.slice(0, n)
	for (const [id, rule] of sorted) {
		console.log(
			`    ${id.padEnd(22)} ${String(rule.docs).padStart(7)} docs (${pct(rule.docs, s.docs)})  ${String(rule.findings).padStart(6)} findings`,
		)
	}
}

test("sanity: separates real Claudish PRs from plain English", {
	timeout: 3 * 60_000,
}, () => {
	console.log("\nsanity report")

	// Selecting last 5k for speed. Also, they are chronological asc sorted,
	// so these are more likely to be slop.
	const missed: string[] = []
	const pos = measure(loadFixture(POSITIVE).slice(-5000), missed)
	const posPairs = measure(loadFixture(POSITIVE_PAIRS), missed)

	const neg = measure(loadFixture(NEGATIVE))

	reportClass(
		"positives — load-bearing PR bodies >= 2026-04-01 (Claudish)",
		pos,
	)
	reportClass("positives — claudish_pairs claudish side (Claudish)", posPairs)
	reportClass("negatives — claudish_pairs English side (plain)", neg)

	if (missed.length > 0) {
		writeFileSync(
			MISSES,
			`${missed.map((d) => JSON.stringify(d)).join("\n")}\n`,
		)
	}
	console.log(
		`\n  ${missed.length} unflagged positives (recall misses) written to ${MISSES.pathname}`,
	)

	console.log("\n  top tell rules on load-bearing positives (by docs flagged)")
	topRules(pos, 12)
	console.log(
		"\n  top tell rules on claudish-pairs positives (by docs flagged)",
	)
	topRules(posPairs, 8)
	console.log("\n  rules firing on negatives")
	topRules(neg, 8)

	const recall = (pos.flagged + posPairs.flagged) / (pos.docs + posPairs.docs)
	const fp = neg.flagged / neg.docs
	console.log(
		`\n  combined positive recall ${pct(recall, 1)}  fp ${pct(fp, 1)}  separation ${((recall - fp) * 100).toFixed(1)}pp`,
	)

	assert.ok(
		recall >= RECALL_MIN,
		`combined positive recall ${pct(recall, 1)} < ${RECALL_MIN * 100}%`,
	)
	assert.ok(
		fp <= FP_MAX,
		`negative false-positive rate ${pct(fp, 1)} > ${FP_MAX * 100}%`,
	)
	assert.ok(
		recall - fp >= SEPARATION_MIN,
		`separation ${((recall - fp) * 100).toFixed(1)}pp < ${SEPARATION_MIN * 100}pp`,
	)
})
