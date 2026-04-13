import { Heart } from 'lucide-react';

export function BrandFooter() {
  return (
    <footer className="absolute bottom-4 right-4 flex items-center gap-1 text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground">
      Made with
      <Heart className="inline h-3 w-3 fill-rose-400 text-rose-400" />
      by
      <a
        href="https://github.com/catalystctl/catalyst"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-0.5 font-medium text-foreground/70 transition-colors hover:text-foreground"
      >
        Catalyst
      </a>
    </footer>
  );
}
