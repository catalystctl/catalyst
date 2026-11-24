import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../alert-dialog';

describe('AlertDialogBody', () => {
  afterEach(cleanup);

  it('gives long content its own scroll region between header and footer', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Long content</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody data-testid="body">
            {Array.from({ length: 60 }, (_, i) => (
              <p key={i}>line {i}</p>
            ))}
          </AlertDialogBody>
          <AlertDialogFooter>
            <span>footer</span>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );

    const body = screen.getByTestId('body');
    // The content frame is max-h-[92dvh] overflow-hidden; only the body scrolls.
    expect(body.className).toContain('overflow-y-auto');
    expect(body.className).toContain('min-h-0');
    expect(body).toHaveTextContent('line 59');
  });
});