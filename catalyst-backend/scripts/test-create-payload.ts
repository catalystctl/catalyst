import { z } from "zod";
import { serverCreateSchema } from "../src/lib/validation.js";

// 模拟 CreateServerModal 针对 ReHLDS 模板生成的 payload
const templateVariables = [
  { name: "VERSION", default: "latest" },
  { name: "INSTALL_MODULES", default: "rehlds,reunion,amxmodx,metamod-r,reapi,ReGameDLL_CS" },
  { name: "HOSTNAME", default: "Counter-Strike 1.6 Server" },
  { name: "SRCDS_MAP", default: "de_dust2" },
  { name: "AUTO_UPDATE", default: "0" },
  { name: "SRCDS_APPID", default: "90" },
  { name: "HLDS_GAME", default: "cstrike" },
  { name: "SRCDS_BETAID", default: "steam_legacy" },
  { name: "VAC_PORT", default: "26900" },
  { name: "VALIDATE", default: "0" },
  { name: "SERVER_PORT", default: "25565" },
];

const environment = Object.fromEntries(
  Object.entries(
    Object.fromEntries(templateVariables.map((v) => [v.name, v.default])),
  ).filter(([, v]) => v !== ""),
);

const payload = {
  name: "Counter Strike 1.6 - ReHLDS",
  description: undefined,
  templateId: "cmp1a9qfk002cfspda3zm2h2r",
  nodeId: "test-node",
  locationId: "test-loc",
  allocatedMemoryMb: 1024,
  allocatedCpuCores: 2,
  allocatedDiskMb: 20480,
  allocatedSwapMb: undefined,
  backupAllocationMb: undefined,
  databaseAllocation: undefined,
  primaryPort: 25565,
  portBindings: undefined,
  networkMode: "host",
  environment,
};

console.log("payload =", JSON.stringify(payload, null, 2));
const r = serverCreateSchema.safeParse(payload);
console.log("success:", r.success);
if (!r.success) {
  console.log("issues:", JSON.stringify(r.error.issues, null, 2));
}
console.log("zod version:", z?.z ? "v3-style" : "check package");
