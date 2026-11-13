'use client';
import { Confetti } from '@/components/Ui';

export function ShareConfetti({ fire }: { fire: boolean }) {
  return <Confetti fire={fire} />;
}
