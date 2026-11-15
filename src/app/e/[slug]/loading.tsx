import { PageSkeleton } from '@/components/Skeletons';

export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl px-4 pt-16">
      <PageSkeleton cards={2} cover={true} />
    </div>
  );
}
