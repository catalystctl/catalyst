/**
 * Regression: the deploy dialog command must authenticate with the
 * Authorization header. The backend rejects `?apiKey=` (SEC-M-03), so the old
 * query-string form returned 401 JSON that got piped into bash, printing
 * "bash: line 1: {error:Invalid deployment credentials}: command not found".
 */
import { describe, it, expect } from 'vitest';
import { buildDeployCommand } from '../deploy-command';

describe('buildDeployCommand', () => {
  const deployUrl = 'https://panel.example.com/api/deploy/tok123';
  const apiKey = 'catalyst_abc123';

  it('passes the agent API key in the Authorization header', () => {
    expect(buildDeployCommand(deployUrl, apiKey)).toContain(
      "-H 'Authorization: Bearer catalyst_abc123'",
    );
  });

  it('keeps the API key out of the URL', () => {
    const command = buildDeployCommand(deployUrl, apiKey);
    expect(command).not.toContain('apiKey=');
    expect(command).toContain(`'${deployUrl}'`);
  });

  it('fails on HTTP errors instead of piping the error body into bash', () => {
    expect(buildDeployCommand(deployUrl, apiKey)).toMatch(/^curl -fsSL /);
  });

  it('still pipes the script into sudo bash', () => {
    expect(buildDeployCommand(deployUrl, apiKey)).toContain('| sudo bash -x');
  });
});
