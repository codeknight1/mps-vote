/**
 * Apply the Kaduna Battle Round: create Team A-E, move each poet to the team
 * they actually battled for (per the judges' scoresheet), and flag every
 * second-place poet into the Danger Zone.
 *
 * Dry run by default; pass --live to write.
 */
import { readFileSync } from "node:fs"
import mongoose from "mongoose"
for (const l of readFileSync(new URL("../.env.import", import.meta.url), "utf8").split("\n")) {
  const m = l.match(/^([A-Z_][A-Z0-9_]*)="?([^"]*)"?$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
const LIVE = process.argv.includes("--live")
const REGION = "kaduna"
const COACHES = {
  "Team A": "Hassana Shehu Magaji", "Team B": "Muhammad Isa Gaude",
  "Team C": "Dr. Abubakar Muhammad Nguru", "Team D": "Harajnah Umar Ragada",
  "Team E": "Khadijatu Rufai",
}
const COLORS = { "Team A":"#E11D48","Team B":"#2563EB","Team C":"#16A34A","Team D":"#D97706","Team E":"#7C3AED" }
// Stolen: lost for one team, then won for another. Belongs to the team that took them.
const STOLEN = { "zainabumar": "Team E" }

const clean = s => (s||"").toLowerCase().replace(/[^a-z ]/g," ").replace(/\s+/g," ").trim()
const toks = s => new Set(clean(s).split(" ").filter(Boolean))
const jac = (a,b)=>{const A=toks(a),B=toks(b);if(!A.size||!B.size)return 0;let i=0;for(const x of A)if(B.has(x))i++;return i/(A.size+B.size-i)}
const bg = s=>{const t=clean(s).replace(/ /g,"");const o=new Set();for(let i=0;i<t.length-1;i++)o.add(t.slice(i,i+2));return o}
const dice=(a,b)=>{const A=bg(a),B=bg(b);if(!A.size||!B.size)return 0;let i=0;for(const x of A)if(B.has(x))i++;return 2*i/(A.size+B.size)}
const sim=(a,b)=>Math.max(jac(a,b),dice(a,b))

const battles = JSON.parse(readFileSync(new URL("./.b.json", import.meta.url), "utf8"))
await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB || "mps" })
const db = mongoose.connection.db
const teamsCol = db.collection("teams")
let teams = await teamsCol.find({ region: REGION }).toArray()

const pool = []
for (const t of teams) for (const p of (t.participants||[])) {
  const m = /\((.*)\)/.exec(p.name||"")
  pool.push({ id:p._id.toString(), doc:p, name:p.name, team:t.name, teamId:t._id.toString(),
              base:(p.name||"").replace(/\(.*?\)/g,"").trim(), stage:m?m[1].trim():"" })
}
const bestMatch = q => {
  let top={s:-1,p:null}
  for (const p of pool) { const s=Math.max(sim(q,p.base), p.stage?sim(q,p.stage):0); if(s>top.s) top={s,p} }
  return top
}

// One row per poet: the team they battled for (steals override).
const assign = new Map()
for (const pair of Object.values(battles)) for (const x of pair) {
  const k = clean(x.name).replace(/ /g,"")
  const team = STOLEN[k] ?? x.team
  const prev = assign.get(k)
  assign.set(k, { name:x.name, team, second: (prev?.second||false) || x.remark==="2nd Place", stolen: !!STOLEN[k] })
}
// A stolen poet who won for their new team is NOT in danger.
for (const [k,v] of assign) if (v.stolen) v.second = false

const plan = [], skipped = []
for (const [k,v] of assign) {
  const m = bestMatch(v.name)
  // A shared surname is not a match. Align token by token: every word of the
  // shorter name must have a similar counterpart in the other, which tolerates
  // reordering ("Hussaini Inayat Maikabi" = "Inayat Maikabi Hussaini") while
  // rejecting "Fadima Abdullahi" vs "Maimuna Abdullahi", which share only a surname.
  const align = (a, b) => {
    const A=[...toks(a)], B=[...toks(b)]
    if (!A.length || !B.length) return 0
    const [short, long] = A.length <= B.length ? [A,B] : [B,A]
    let sum = 0
    for (const t of short) sum += Math.max(...long.map(u => dice(t,u)))
    return sum / short.length
  }
  const alignScore = m.p ? Math.max(align(v.name, m.p.base), m.p.stage ? align(v.name, m.p.stage) : 0) : 0
  // Second route: abbreviations and spelling variants ("Hafsat Muh'd" =
  // "Hafsat Muhammad") score low on word-alignment but high overall AND share
  // the given name. That given name is what separates them from "Fadima
  // Abdullahi" vs "Maimuna Abdullahi", who share only a surname.
  const first = x => (clean(x).split(" ")[0] || "")
  const firstSim = m.p ? Math.max(dice(first(v.name), first(m.p.base)),
                                  m.p.stage ? dice(first(v.name), first(m.p.stage)) : 0) : 0
  const variantOk = m.s >= 0.74 && firstSim >= 0.70
  if (!m.p || (alignScore < 0.75 && !variantOk)) {
    skipped.push({ ...v, why:`no confident match (best ${m.p?.name??"-"} ${Math.round((m.s||0)*100)}%, word-match ${Math.round(alignScore*100)}%, given-name ${Math.round(firstSim*100)}%)` }); continue }
  if (m.p.team === "Eliminated") { skipped.push({ ...v, why:`recorded as Eliminated in the Blind Audition (${m.p.name})` }); continue }
  plan.push({ ...v, poet:m.p, conf:Math.round(m.s*100) })
}
const byTeam = {}
for (const p of plan) (byTeam[p.team] ||= []).push(p)

console.log(`${LIVE?"APPLYING":"DRY RUN"} — Kaduna Battle Round\n`)
for (const t of Object.keys(COACHES)) {
  const list = byTeam[t]||[]
  console.log(`${t} — Coach ${COACHES[t]}: ${list.length} poets, ${list.filter(x=>x.second).length} into Danger Zone`)
}
console.log(`\ntotal to move : ${plan.length}`)
console.log(`Danger Zone   : ${plan.filter(p=>p.second).length}`)
console.log(`skipped       : ${skipped.length}`)
const risky = plan.filter(p=>p.conf<85).sort((a,b)=>a.conf-b.conf)
console.log(`\nmatches below 85% confidence (${risky.length}) — check these:`)
for (const r of risky) console.log(`   ${String(r.conf).padStart(3)}%  "${r.name}"  ->  ${r.poet.name}  [${r.poet.team}]`)
for (const s of skipped) console.log(`   ${s.team} | ${s.name} — ${s.why}`)

if (!LIVE) { console.log("\nRe-run with --live to apply."); await mongoose.disconnect(); process.exit(0) }

// 1. ensure the five teams exist
const idOf = {}
let order = 10
for (const [name, coach] of Object.entries(COACHES)) {
  let t = teams.find(x => x.name === name)
  if (!t) {
    const r = await teamsCol.insertOne({ name, color:COLORS[name], coach:{name:coach}, participants:[],
      votingOpen:false, order:order++, region:REGION, createdAt:new Date(), updatedAt:new Date() })
    idOf[name] = r.insertedId; console.log(`created ${name}`)
  } else {
    idOf[name] = t._id
    await teamsCol.updateOne({_id:t._id}, {$set:{ "coach.name":coach, color:COLORS[name], region:REGION }})
  }
}
// 2. move each poet (copy first, then pull — a crash leaves a duplicate, never a lost poet)
let moved=0
for (const p of plan) {
  const dest = idOf[p.team]
  if (String(dest) === p.poet.teamId) continue
  const doc = { ...p.poet.doc, inDanger: !!p.second,
                originTeam: p.poet.doc.originTeam || (["Contestants","Revived"].includes(p.poet.team) ? p.poet.team : "") ,
                updatedAt: new Date() }
  await teamsCol.updateOne({ _id: dest, "participants._id": { $ne: p.poet.doc._id } }, { $push: { participants: doc } })
  await teamsCol.updateOne({ _id: new mongoose.Types.ObjectId(p.poet.teamId) }, { $pull: { participants: { _id: p.poet.doc._id } } })
  moved++
}
console.log(`\nmoved ${moved} poets`)
const after = await teamsCol.find({ region: REGION }).toArray()
for (const t of after) {
  const ps = t.participants||[]
  console.log(`  ${t.name.padEnd(14)} ${String(ps.length).padStart(3)} poets  inDanger=${ps.filter(p=>p.inDanger).length}`)
}
await mongoose.disconnect()
