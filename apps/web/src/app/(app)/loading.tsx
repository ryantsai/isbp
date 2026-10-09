import { PageSkeleton } from '@isbp/ui/skeleton';

/** Shown at once when a page is still being rendered on the server (the top bar shows progress too). */
export default function Loading() {
  return <PageSkeleton />;
}
