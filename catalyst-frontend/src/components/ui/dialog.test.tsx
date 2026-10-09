import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogTrigger,
} from './dialog';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';

afterEach(cleanup);

const DialogWrapper = ({ children }: { children: React.ReactNode }) => (
  <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
);

describe('Dialog component', () => {
  it('opens when trigger is clicked', () => {
    render(
      <DialogWrapper>
        <Dialog>
          <DialogTrigger>Open dialog</DialogTrigger>
          <DialogContent>
            <DialogTitle>Test Dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      </DialogWrapper>
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Open dialog'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders dialog title and description', () => {
    render(
      <DialogWrapper>
        <Dialog>
          <DialogTrigger>Open</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Dialog Title</DialogTitle>
              <DialogDescription>This is a description</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </DialogWrapper>
    );

    fireEvent.click(screen.getByText('Open'));
    expect(screen.getByText('Dialog Title')).toBeInTheDocument();
    expect(screen.getByText('This is a description')).toBeInTheDocument();
  });

  it('renders dialog body content', () => {
    render(
      <DialogWrapper>
        <Dialog>
          <DialogTrigger>Open</DialogTrigger>
          <DialogContent>
            <DialogTitle>Dialog</DialogTitle>
            <DialogBody>
              <p>Body content here</p>
            </DialogBody>
          </DialogContent>
        </Dialog>
      </DialogWrapper>
    );

    fireEvent.click(screen.getByText('Open'));
    expect(screen.getByText('Body content here')).toBeInTheDocument();
  });

  it('renders dialog footer with actions', () => {
    render(
      <DialogWrapper>
        <Dialog>
          <DialogTrigger>Open</DialogTrigger>
          <DialogContent>
            <DialogTitle>Dialog</DialogTitle>
            <DialogFooter>
              <button>Cancel</button>
              <button>Confirm</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogWrapper>
    );

    fireEvent.click(screen.getByText('Open'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Cancel')).toBeInTheDocument();
    expect(within(dialog).getByText('Confirm')).toBeInTheDocument();
  });

  it('shows close button by default', () => {
    render(
      <DialogWrapper>
        <Dialog>
          <DialogTrigger>Open</DialogTrigger>
          <DialogContent>
            <DialogTitle>Dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      </DialogWrapper>
    );

    fireEvent.click(screen.getByText('Open'));
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });

  it('hides close button when showClose is false', () => {
    render(
      <DialogWrapper>
        <Dialog>
          <DialogTrigger>Open</DialogTrigger>
          <DialogContent showClose={false}>
            <DialogTitle>Dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      </DialogWrapper>
    );

    fireEvent.click(screen.getByText('Open'));
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
  });

  it('applies size variants correctly', () => {
    const { rerender } = render(
      <DialogWrapper>
        <Dialog open>
          <DialogContent size="sm">
            <DialogTitle>Small Dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      </DialogWrapper>
    );

    expect(screen.getByRole('dialog')).toHaveClass('sm:max-w-sm');

    rerender(
      <DialogWrapper>
        <Dialog open>
          <DialogContent size="lg">
            <DialogTitle>Large Dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      </DialogWrapper>
    );

    expect(screen.getByRole('dialog')).toHaveClass('sm:max-w-xl');

    rerender(
      <DialogWrapper>
        <Dialog open>
          <DialogContent size="full">
            <DialogTitle>Full Dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      </DialogWrapper>
    );

    expect(screen.getByRole('dialog')).toHaveClass('sm:h-[min(90dvh,56rem)]');
  });

  it('supports controlled open state', () => {
    const { rerender } = render(
      <DialogWrapper>
        <Dialog open={false}>
          <DialogContent>
            <DialogTitle>Controlled Dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      </DialogWrapper>
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(
      <DialogWrapper>
        <Dialog open={true}>
          <DialogContent>
            <DialogTitle>Controlled Dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      </DialogWrapper>
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('calls onOpenChange when dialog state changes', () => {
    const handleOpenChange = vi.fn();
    render(
      <DialogWrapper>
        <Dialog onOpenChange={handleOpenChange}>
          <DialogTrigger>Open</DialogTrigger>
          <DialogContent>
            <DialogTitle>Dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      </DialogWrapper>
    );

    fireEvent.click(screen.getByText('Open'));
    expect(handleOpenChange).toHaveBeenCalledWith(true);
  });

  it('renders overlay with correct styling', () => {
    render(
      <DialogWrapper>
        <Dialog>
          <DialogTrigger>Open</DialogTrigger>
          <DialogContent>
            <DialogTitle>Dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      </DialogWrapper>
    );

    fireEvent.click(screen.getByText('Open'));
    const overlay = document.querySelector('[class*="fixed"][class*="inset-0"][class*="z-50"]');
    expect(overlay).toBeInTheDocument();
  });

  it('ignores deprecated icon props in DialogHeader', () => {
    render(
      <DialogWrapper>
        <Dialog>
          <DialogTrigger>Open</DialogTrigger>
          <DialogContent>
            <DialogHeader icon={<div>Icon</div>} iconClassName="icon-class">
              <DialogTitle>Dialog with deprecated props</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </DialogWrapper>
    );

    fireEvent.click(screen.getByText('Open'));
    expect(screen.queryByText('Icon')).not.toBeInTheDocument();
  });
});
