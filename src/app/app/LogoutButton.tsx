'use client';
import { useT } from '@/components/I18n';
import { apiSend, clearDeviceData } from '@/components/client-utils';

export function LogoutButton() {
  const { t } = useT();
  return (
    <button
      className="btn-ghost min-h-[40px] px-3 text-sm whitespace-nowrap"
      onClick={async () => {
        await apiSend('/api/auth/logout', {});
        await clearDeviceData(); // shared phones: nothing private stays on the device
        window.location.href = '/';
      }}
    >
      {t('a.logout')}
    </button>
  );
}
