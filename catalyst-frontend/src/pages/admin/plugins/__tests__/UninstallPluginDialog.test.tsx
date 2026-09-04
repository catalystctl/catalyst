import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UninstallPluginDialog } from '../UninstallPluginDialog';

describe('UninstallPluginDialog', () => {
  it('renders plugin identity and requires explicit confirm', () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <UninstallPluginDialog
        pluginName="demo-plugin"
        displayName="Demo Plugin"
        version="1.0.0"
        enabled
        open
        busy={false}
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
      />,
    );
    expect(screen.getByTestId('plugin-uninstall-confirm')).toBeInTheDocument();
    expect(screen.getByText(/demo-plugin/)).toBeInTheDocument();
    expect(screen.getByText(/Currently enabled/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('plugin-uninstall-confirm-button'));
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it('passes purgeData through on confirm', () => {
    const onConfirm = vi.fn();
    render(
      <UninstallPluginDialog
        pluginName="demo-plugin"
        displayName="Demo Plugin"
        open
        onConfirm={onConfirm}
        onOpenChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('plugin-uninstall-purge'));
    fireEvent.click(screen.getByTestId('plugin-uninstall-confirm-button'));
    expect(onConfirm).toHaveBeenCalledWith(true);
  });
});
