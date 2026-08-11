/**
 * E2E Test Helpers
 * 
 * Utilities for creating and cleaning up test users without touching the seeded admin account.
 * Uses Prisma directly since E2E tests run in the same environment as the backend.
 */

import type { Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Initialize Prisma with the same configuration as the backend
const adapter = new PrismaPg({ 
  connectionString: process.env.DATABASE_URL || 'postgresql://catalyst:catalyst@localhost:5432/catalyst'
});
const prisma = new PrismaClient({ adapter, log: [] });

export interface TestUser {
  email: string;
  password: string;
  username: string;
  name: string;
  id?: string;
}

/**
 * Create a unique test user with admin privileges.
 * Returns credentials that can be used to log in.
 * 
 * IMPORTANT: This creates a NEW admin user, NOT the seeded admin@example.com.
 */
export async function createTestUser(page: Page): Promise<TestUser> {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(7);
  
  const credentials: TestUser = {
    email: `e2e-test-${timestamp}-${randomId}@test.local`,
    password: 'TestPassword123!',
    username: `e2etest${timestamp}${randomId}`,
    name: `E2E Test User ${timestamp}`,
  };

  // Use the backend API to create the user via better-auth sign-up
  const response = await page.request.post('http://localhost:3000/api/auth/sign-up/email', {
    data: {
      email: credentials.email,
      password: credentials.password,
      username: credentials.username,
      name: credentials.name,
    },
  });

  if (!response.ok()) {
    throw new Error(`Failed to create test user: ${response.status()} ${await response.text()}`);
  }

  const responseData = await response.json();
  credentials.id = responseData.user?.id;

  // Get or create the Administrator role
  let adminRole = await prisma.role.findFirst({
    where: { name: 'Administrator' },
  });

  if (!adminRole) {
    adminRole = await prisma.role.create({
      data: {
        name: 'Administrator',
        description: 'Full system access',
        permissions: ['*'],
      },
    });
  }

  // Assign admin role to the test user and verify email
  if (credentials.id) {
    await prisma.user.update({
      where: { id: credentials.id },
      data: {
        emailVerified: true,
        roles: {
          connect: { id: adminRole.id },
        },
      },
    });
  }

  return credentials;
}

/**
 * Delete a test user from the database.
 */
export async function deleteTestUser(email: string): Promise<void> {
  try {
    // Delete associated records first (accounts, sessions, etc.)
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (user) {
      // Better-auth stores password in the account table
      await prisma.account.deleteMany({ where: { userId: user.id } });
      await prisma.session.deleteMany({ where: { userId: user.id } });
      await prisma.verification.deleteMany({ where: { identifier: email } });
      
      // Now delete the user
      await prisma.user.delete({ where: { email } });
    }
  } catch (error) {
    console.warn(`Failed to delete test user ${email}:`, error);
  }
}

/**
 * Cleanup Prisma connection when done with tests.
 */
export async function closePrisma() {
  await prisma.$disconnect();
}

/**
 * Log in a user via the UI.
 */
export async function loginUser(page: Page, credentials: { email: string; password: string }) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.locator('input[id="email"]').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('input[id="email"]').fill(credentials.email);
  await page.locator('input[id="password"]').fill(credentials.password);
  await page.locator('button:has-text("Sign in")').first().click();
  await page
    .waitForURL((url: URL) => !url.pathname.includes('/login'), { timeout: 15_000 })
    .catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
}

/**
 * Navigate and settle — returns false if navigation fails.
 */
export async function navAndWait(page: Page, path: string): Promise<boolean> {
  try {
    const resp = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    if (!resp) return false;
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(600);
    return true;
  } catch {
    return false;
  }
}
