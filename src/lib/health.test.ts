/// <reference types="node" />
import assert from "node:assert/strict"

import type { Node } from "./api.ts"
import { healthOf } from "./health.ts"
import type { PingData } from "./ping.ts"

const metrics = {
  uptime: 100, cpu: 10, load: [0.1, 0.2, 0.3], mem_total: 1000, mem_used: 300, swap_total: 0,
  swap_used: 0, disk_total: 1000, disk_used: 400, net_rx: 1, net_tx: 1, total_rx: 1, total_tx: 1,
  month_rx: 1, month_tx: 1, tcp: 1, udp: 1, procs: 10,
}
const node = {
  id: 1, name: "n", online: true, metrics, expires_at: null,
} as unknown as Node

const cleanPing: PingData = {
  probes: [{ id: 1, name: "上海", values: Array(24).fill(40), losses: Array(24).fill(0), last: 40, loss: 0 }],
}

// A reporting node, cool resources, no expiry, a clean line: full marks.
void (() => {
  const h = healthOf(node, cleanPing, null)!
  assert.equal(h.total, 100)
  assert.equal(h.grade, "safe")
  assert.equal(h.probeInsufficient, false)
  console.log("a healthy node scores 100")
})()

// Offline: no presence points, no resource credit, the line still speaks.
void (() => {
  const h = healthOf({ ...node, online: false, metrics: null } as Node, cleanPing, null)!
  assert.equal(h.parts[0].got, 0)
  assert.equal(h.parts[1].got, 0)
  assert.equal(h.total, 45) // expiry 20 + probe 25
  assert.equal(h.grade, "danger")
  console.log("an offline node keeps only expiry and probe points")
})()

// Resource bands: CPU past 85 pays all ten, memory in the band pays five,
// disk at 85 sits in its own wider band and still pays five.
void (() => {
  const hot = { ...metrics, cpu: 90, mem_used: 800, disk_used: 850 }
  const h = healthOf({ ...node, metrics: hot } as Node, cleanPing, null)!
  assert.equal(h.parts[1].got, 0 + 5 + 5)
  console.log("resource bands deduct per resource")
})()

// Disk past 90 pays everything; expiry inside a week pays nothing.
void (() => {
  const full = { ...metrics, disk_used: 950 }
  const h = healthOf({ ...node, metrics: full } as Node, cleanPing, 5)!
  assert.equal(h.parts[1].got, 20)
  assert.equal(h.parts[2].got, 0)
  console.log("a nearly full disk and a near expiry score zero on their parts")
})()

// A probe window half lost halves the probe part.
void (() => {
  const lossy: PingData = {
    probes: [{ id: 1, name: "上海", values: Array(24).fill(null), losses: Array(24).fill(100), last: null, loss: 100 }],
  }
  const h = healthOf(node, lossy, null)!
  assert.equal(h.parts[3].got, 0)
  console.log("a fully lost probe window scores zero on the probe part")
})()

// Too few buckets: the probe part is struck and the rest scaled to 100.
void (() => {
  const thin: PingData = {
    probes: [{ id: 1, name: "上海", values: [40, 41], losses: [0, 0], last: 41, loss: 0 }],
  }
  const h = healthOf(node, thin, null)!
  assert.equal(h.probeInsufficient, true)
  assert.equal(h.total, 100) // 75 of 75 scaled up
  console.log("insufficient probe data rescales instead of guessing")
})()

// Still loading: no score at all.
assert.equal(healthOf(node, undefined, null), null)
console.log("a loading probe window scores nothing yet")
