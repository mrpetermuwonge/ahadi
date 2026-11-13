import { requireUser } from '@/lib/web';
import { EVENT_TYPES } from '@/lib/eventTypes';
import { Wizard } from './Wizard';

export const metadata = { title: 'New event' };

export default async function NewEventPage() {
  await requireUser('/app/new');
  const templates = Object.values(EVENT_TYPES).map((x) => ({ type: x.type, fields: x.fields, urgentAllowed: x.urgentAllowed, requiresVerification: x.requiresVerification }));
  return <Wizard templates={templates} />;
}
