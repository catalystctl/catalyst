import { Toaster } from 'sonner';
import { useUIStore } from '../../stores/uiStore';

export function ToastProvider() {
  const theme = useUIStore((s) => s.theme);
  return (
    <Toaster
      position="top-right"
      expand
      richColors
      closeButton
      duration={4000}
      theme={theme}
    />
  );
}
