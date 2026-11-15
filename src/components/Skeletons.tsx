/** Grey placeholder blocks shown at once while a page loads, so a tap never looks frozen on slow networks. */
export function CardSkeleton({ lines = 3, cover = false }: { lines?: number; cover?: boolean }) {
  return (
    <div className="card overflow-hidden" aria-hidden>
      {cover && <div className="skeleton w-full aspect-[16/9] rounded-none" />}
      <div className="p-5 space-y-3">
        <div className="skeleton h-6 w-2/3" />
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="skeleton h-4" style={{ width: `${90 - i * 15}%` }} />
        ))}
      </div>
    </div>
  );
}

export function PageSkeleton({ cards = 2, cover = false }: { cards?: number; cover?: boolean }) {
  return (
    <div className="space-y-4" role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: cards }, (_, i) => (
        <CardSkeleton key={i} cover={cover && i === 0} lines={i === 0 ? 3 : 2} />
      ))}
    </div>
  );
}
