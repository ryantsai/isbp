import { LoaderCircle } from 'lucide-react';
import { cn } from '../lib/utils';

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <LoaderCircle
      role="status"
      aria-label={label ?? 'Loading'}
      className={cn('size-4 animate-spin motion-reduce:animate-[spin_2s_linear_infinite]', className)}
    />
  );
}
