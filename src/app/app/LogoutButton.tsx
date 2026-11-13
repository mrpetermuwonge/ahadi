'use client';
import { useT } from '@/components/I18n';
import { apiSend } from '@/components/client-utils';

export function LogoutButton() {
  const { t } = useT();
  return (
    <button
      className="btn-ghost min-h-[40px] px-3 text-sm"
      onClick={async () => {
        await apiSend('/api/auth/logout', {});
        window.location.href = '/';
      }}
    >
      {t('a.logout')}
    </button>
  );
}
