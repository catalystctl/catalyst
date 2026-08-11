import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { v4 as uuidv4 } from 'uuid';

// Prisma v7: Use adapter for PostgreSQL
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const BULK_PREFIX = 'BULK_TEST_';
const BULK_COUNT = 100;

async function createBulkServers() {
  try {
    console.log(`🚀 Creating ${BULK_COUNT} test servers...`);

    // Get or create template
    let template = await prisma.serverTemplate.findUnique({
      where: { name: 'nodejs-generic' },
    });

    if (!template) {
      console.log('⚠️  No template found. Creating default template...');
      template = await prisma.serverTemplate.create({
        data: {
          name: 'nodejs-generic',
          description: 'Generic Node.js template for testing',
          author: 'system',
          version: '1.0.0',
          image: 'node:18',
          startup: 'npm start',
          stopCommand: 'stop',
          sendSignalTo: 'SIGTERM',
          variables: [],
          supportedPorts: [3000, 3001, 3002],
          allocatedMemoryMb: 512,
          allocatedCpuCores: 1,
        },
      });
    }

    // Get or create location
    let location = await prisma.location.findUnique({
      where: { name: 'default' },
    });

    if (!location) {
      console.log('⚠️  No location found. Creating default location...');
      location = await prisma.location.create({
        data: {
          name: 'default',
          description: 'Default location for testing',
        },
      });
    }

    // Get or create node
    let node = await prisma.node.findUnique({
      where: { name: 'test-node' },
    });

    if (!node) {
      console.log('⚠️  No node found. Creating default node...');
      node = await prisma.node.create({
        data: {
          name: 'test-node',
          hostname: 'localhost',
          publicAddress: '127.0.0.1',
          secret: `secret-${uuidv4()}`,
          locationId: location.id,
          maxMemoryMb: 32000,
          maxCpuCores: 16,
        },
      });
    }

    // Get or create owner user
    let owner = await prisma.user.findUnique({
      where: { email: 'admin@example.com' },
    });

    if (!owner) {
      console.log('⚠️  No admin user found. Creating default admin...');
      owner = await prisma.user.create({
        data: {
          email: 'admin@example.com',
          username: 'admin',
          password: 'hashed_password_placeholder',
        },
      });
    }

    // Create servers in batches
    const batchSize = 10;
    let created = 0;

    for (let i = 0; i < BULK_COUNT; i += batchSize) {
      const batch = [];
      for (let j = 0; j < batchSize && i + j < BULK_COUNT; j++) {
        const idx = i + j + 1;
        batch.push({
          uuid: `${BULK_PREFIX}${idx}`,
          name: `${BULK_PREFIX}Server-${idx}`,
          templateId: template.id,
          nodeId: node.id,
          locationId: location.id,
          ownerId: owner.id,
          allocatedMemoryMb: 512,
          allocatedCpuCores: 1,
          primaryPort: 3000 + (idx % 100),
          description: `Test server #${idx} (cleanup with: npm run bulk-servers -- clean)`,
        });
      }

      const results = await prisma.server.createMany({
        data: batch,
        skipDuplicates: true,
      });

      created += results.count;
      console.log(
        `✅ Created batch: ${created}/${BULK_COUNT} servers`,
      );
    }

    console.log(
      `\n✨ Successfully created ${created} test servers with prefix "${BULK_PREFIX}"`,
    );
    console.log(`\n📋 To view them: npm run db:studio`);
    console.log(`🗑️  To clean up: npm run bulk-servers -- clean\n`);
  } catch (error) {
    console.error('❌ Error creating servers:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

async function cleanupBulkServers() {
  try {
    console.log(`🧹 Cleaning up test servers with prefix "${BULK_PREFIX}"...`);

    const result = await prisma.server.deleteMany({
      where: {
        name: {
          startsWith: BULK_PREFIX,
        },
      },
    });

    console.log(
      `\n✅ Successfully deleted ${result.count} test servers\n`,
    );
  } catch (error) {
    console.error('❌ Error deleting servers:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

async function listBulkServers() {
  try {
    const servers = await prisma.server.findMany({
      where: {
        name: {
          startsWith: BULK_PREFIX,
        },
      },
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
      },
    });

    if (servers.length === 0) {
      console.log(`\n📭 No test servers found with prefix "${BULK_PREFIX}"\n`);
      return;
    }

    console.log(
      `\n📊 Found ${servers.length} test server(s):\n`,
    );
    console.table(servers);
  } catch (error) {
    console.error('❌ Error listing servers:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const command = process.argv[2];

  switch (command) {
    case 'clean':
      await cleanupBulkServers();
      break;
    case 'list':
      await listBulkServers();
      break;
    case 'create':
    default:
      await createBulkServers();
      break;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
