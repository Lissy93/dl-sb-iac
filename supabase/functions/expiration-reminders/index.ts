import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getSupabaseClient } from '../shared/supabaseClient.ts';

const REMINDER_DAYS = [90, 30, 7, 2];

serve(async (req) => {
  const supabase = getSupabaseClient(req);

  for (const days of REMINDER_DAYS) {
    const dateStr = getFutureDate(days);

    const { data: domains, error } = await supabase
      .from('domains')
      .select('id, domain_name, expiry_date, user_id, registrars(name)')
      .eq('expiry_date', dateStr);

    if (error) {
      console.error(`❌ Failed to query domains for ${days}d:`, error);
      continue;
    }

    for (const domain of domains ?? []) {
      const { id: domain_id, domain_name, user_id, registrars } = domain;
      const registrar = registrars?.name;

      const message = `Domain ${domain_name} expiring in ${days} days.` +
        (registrar ? ` Renew it on ${registrar}.` : '');

      await supabase.from('notifications').insert({
        user_id,
        domain_id,
        change_type: 'reminder',
        message,
        sent: false,
        read: false,
      });

      console.log(`🔔 Reminder created for ${domain_name} (${days}d)`);
    }
  }

  return new Response('Done', { status: 200 });
});

function getFutureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}
