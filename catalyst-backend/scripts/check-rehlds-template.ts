import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const templates = await prisma.serverTemplate.findMany({
    where: { name: { contains: "ounter", mode: "insensitive" } },
    select: { id: true, name: true, allocatedMemoryMb: true, allocatedCpuCores: true, supportedPorts: true, variables: true },
  });

  for (const t of templates) {
    console.log("=== ", t.id, "|", t.name, " ===");
    console.log("memory:", t.allocatedMemoryMb, "cpu:", t.allocatedCpuCores, "disk:", t.allocatedDiskMb, "ports:", JSON.stringify(t.supportedPorts));
    for (const v of (t.variables as any[]) ?? []) {
      console.log(`  var name=${JSON.stringify(v.name)} default=${JSON.stringify(v.default)} type=${JSON.stringify(typeof v.default)} input=${v.input} required=${v.required}`);
    }
  }
  console.log("total:", templates.length);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
