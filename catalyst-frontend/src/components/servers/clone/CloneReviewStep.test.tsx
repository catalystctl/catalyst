import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import CloneReviewStep from './CloneReviewStep';
import type { ClonePlan } from '../../../types/server';

function makePlan(overrides: Partial<ClonePlan> = {}): ClonePlan {
  const base: ClonePlan = {
    preflightId: 'pf-1',
    fingerprint: 'fp-1',
    mode: 'configuration',
    crossNode: false,
    source: {
      id: 'srv-1',
      uuid: 'uuid-1',
      name: 'Source',
      status: 'stopped',
      nodeId: 'node-a',
      nodeName: 'Node A',
      locationId: 'loc-a',
      locationName: 'EU West',
      templateId: 'tpl-1',
      templateName: 'Paper',
      networkMode: 'bridge',
      primaryIp: null,
      primaryPort: 25565,
      dataDir: '/srv/uuid-1',
      dataSizeBytes: null,
      installedMods: 0,
      scheduledTasks: 0,
      subUsers: 0,
      databases: 0,
    },
    target: {
      nodeId: 'node-a',
      nodeName: 'Node A',
      locationId: 'loc-a',
      locationName: 'EU West',
      isOnline: true,
      agentVersion: '1.0.0',
      serverDataDir: '/srv',
      sftpPort: 2022,
      publicAddress: '10.0.0.1',
      supportedNetworkModes: ['bridge'],
      capacity: { memoryFreeMb: 1000, cpuFreeCores: 4, diskFreeBytes: null },
    },
    resolved: {
      name: 'Source Copy',
      ownerId: 'user-1',
      nodeId: 'node-a',
      locationId: 'loc-a',
      templateId: 'tpl-1',
      networkMode: 'bridge',
      primaryIp: null,
      primaryPort: 25566,
      portBindings: { 25565: 25566 },
      allocatedMemoryMb: 1024,
      allocatedCpuCores: 1,
      allocatedDiskMb: 4096,
      backupStorageMode: 'local',
    },
    allocations: { required: false, mode: 'none', available: [], selected: null },
    includeSurfaces: {
      access: true,
      roleGrants: true,
      scheduledTasks: false,
      databases: false,
    },
    requirements: { sourceStopped: false, installWillRun: true, estimatedDurationSec: null },
    changes: [
      {
        field: 'primaryPort',
        label: 'Primary port',
        from: 25565,
        to: 25566,
        nodeSpecific: true,
      },
    ],
    blockers: [],
    warnings: [],
    ...overrides,
  };
  return base;
}

const noop = () => {};

describe('CloneReviewStep', () => {
  it('renders the node-specific change set', () => {
    render(
      <CloneReviewStep
        plan={makePlan()}
        acknowledgedWarnings={[]}
        onToggleWarning={noop}
        onBack={noop}
        onConfirm={noop}
        submitting={false}
      />,
    );

    expect(screen.getByText('Primary port')).toBeInTheDocument();
    expect(screen.getByText('25565')).toBeInTheDocument();
    expect(screen.getByText('25566')).toBeInTheDocument();
    expect(screen.getByText('node-specific')).toBeInTheDocument();
  });

  it('blocks confirmation while a blocker is present and offers to stop the source', () => {
    const onStopSource = vi.fn();
    render(
      <CloneReviewStep
        plan={makePlan({
          mode: 'full',
          blockers: [
            {
              code: 'CLONE_SOURCE_NOT_STOPPED',
              message: 'The source server must be stopped before it can be fully cloned.',
              field: 'source',
            },
          ],
        })}
        acknowledgedWarnings={[]}
        onToggleWarning={noop}
        onBack={noop}
        onConfirm={noop}
        submitting={false}
        onStopSource={onStopSource}
      />,
    );

    expect(
      screen.getByText('The source server must be stopped before it can be fully cloned.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop source and continue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clone server' })).toBeDisabled();
  });

  it('requires every warning to be acknowledged before confirming', () => {
    const onConfirm = vi.fn();
    const plan = makePlan({
      warnings: [
        { code: 'CLONE_SOURCE_ENV_STALE', message: 'Stale variables.', field: 'environment' },
        { code: 'CLONE_SOURCE_SIZE_UNKNOWN', message: 'Size unknown.', field: 'source' },
      ],
    });

    const { rerender } = render(
      <CloneReviewStep
        plan={plan}
        acknowledgedWarnings={[]}
        onToggleWarning={noop}
        onBack={noop}
        onConfirm={onConfirm}
        submitting={false}
      />,
    );

    const confirm = screen.getByRole('button', { name: 'Clone server' });
    expect(confirm).toBeDisabled();

    rerender(
      <CloneReviewStep
        plan={plan}
        acknowledgedWarnings={['CLONE_SOURCE_ENV_STALE', 'CLONE_SOURCE_SIZE_UNKNOWN']}
        onToggleWarning={noop}
        onBack={noop}
        onConfirm={onConfirm}
        submitting={false}
      />,
    );

    const enabled = screen.getByRole('button', { name: 'Clone server' });
    expect(enabled).toBeEnabled();
    fireEvent.click(enabled);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('labels the cross-node confirmation with the target node', () => {
    render(
      <CloneReviewStep
        plan={makePlan({ crossNode: true })}
        acknowledgedWarnings={[]}
        onToggleWarning={noop}
        onBack={noop}
        onConfirm={noop}
        submitting={false}
      />,
    );

    expect(screen.getByRole('button', { name: 'Create on Node A' })).toBeInTheDocument();
  });

  it('calls onBack without confirming when going back', () => {
    const onBack = vi.fn();
    const onConfirm = vi.fn();
    render(
      <CloneReviewStep
        plan={makePlan()}
        acknowledgedWarnings={[]}
        onToggleWarning={noop}
        onBack={onBack}
        onConfirm={onConfirm}
        submitting={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('reports acknowledgement changes through the toggle handler', () => {
    const onToggleWarning = vi.fn();
    render(
      <CloneReviewStep
        plan={makePlan({
          warnings: [
            { code: 'CLONE_SOURCE_ENV_STALE', message: 'Stale variables.', field: 'environment' },
          ],
        })}
        acknowledgedWarnings={[]}
        onToggleWarning={onToggleWarning}
        onBack={noop}
        onConfirm={noop}
        submitting={false}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggleWarning).toHaveBeenCalledWith('CLONE_SOURCE_ENV_STALE');
  });
});
