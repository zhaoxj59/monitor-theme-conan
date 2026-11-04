/// <reference types="node" />
import assert from "node:assert/strict"

import { availabilityOf, diskForecast, type MetricRow } from "./history.ts"

const row = (ts: number, minutes: number, disk_used = 0): MetricRow => ({
  ts, cpu: 1, mem_used: 1, disk_used, net_rx: 0, net_tx: 0, minutes,
})

// Hourly buckets for ten days, every minute reported: full availability,
// and the span runs bucket to bucket rather than the requested width.
void (() => {
  const rows = Array.from({ length: 240 }, (_, i) => row(i * 3600, 60))
  const a = availabilityOf({ rows, step: 3600 })!
  assert.equal(Math.round(a.pct), 100)
  assert.ok(a.spanDays > 9.9 && a.spanDays < 10.1)
  console.log("full coverage reads as 100% over the true span")
})()

// Half the minutes missing inside the same span: availability halves,
// including the buckets that never arrived at all.
void (() => {
  const rows = Array.from({ length: 120 }, (_, i) => row(i * 7200, 60))
  const a = availabilityOf({ rows, step: 3600 })!
  assert.ok(a.pct > 49 && a.pct < 51, `expected ~50, got ${a.pct}`)
  console.log("gaps between buckets count against availability")
})()

// A disk growing a steady 10 units a day, now at 940 of 1000: six days left.
void (() => {
  const rows = Array.from({ length: 168 }, (_, i) => row(i * 3600, 60, 940 - ((167 - i) / 24) * 10))
  const f = diskForecast({ rows, step: 3600 }, 1000, 940)!
  assert.ok(Math.abs(f.days - 6) < 0.2, `expected ~6 days, got ${f.days}`)
  console.log("a steady disk slope projects its fill date")
})()

// A shrinking disk and a three-day-old node both stay silent.
void (() => {
  const rows = Array.from({ length: 168 }, (_, i) => row(i * 3600, 60, 900 - i))
  assert.equal(diskForecast({ rows, step: 3600 }, 1000, 733), null)
  const young = Array.from({ length: 48 }, (_, i) => row(i * 3600, 60, 100 + i))
  assert.equal(diskForecast({ rows: young, step: 3600 }, 1000, 147), null)
  console.log("no upward slope or too short a span yields no forecast")
})()

// A fill date past ninety days is a claim the panel will not print.
void (() => {
  const rows = Array.from({ length: 168 }, (_, i) => row(i * 3600, 60, 100 + (i / 24) * 0.1))
  assert.equal(diskForecast({ rows, step: 3600 }, 1000, 100), null)
  console.log("a fill date past ninety days stays unprinted")
})()
