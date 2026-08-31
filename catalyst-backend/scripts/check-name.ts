import { serverCreateSchema } from "../src/lib/validation.js";

const mk = (name: string) => ({
  name,
  templateId: "x",
  nodeId: "x",
  locationId: "x",
  allocatedMemoryMb: 1024,
  allocatedCpuCores: 1,
  allocatedDiskMb: 10240,
  primaryPort: 25565,
  networkMode: "host",
  environment: {},
});

const cases = [
  "Counter Strike 1.6 - ReHLDS",
  "CS 1.6 (main) & backup v2",
  "Player's server",
  "my\u0000server",
  "bad\nname",
  "ok name-2_v1.5",
];

for (const c of cases) {
  const r = serverCreateSchema.safeParse(mk(c));
  console.log(JSON.stringify(c), "->", r.success ? "PASS" : "REJECT: " + r.error.issues[0].message);
}
