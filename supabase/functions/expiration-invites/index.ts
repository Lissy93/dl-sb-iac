import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('DB_URL')!,
  Deno.env.get('DB_KEY')!
);

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const RESEND_SENDER = Deno.env.get('RESEND_SENDER') || 'reminders@domain-locker.com';

const APP_BASE_URL = Deno.env.get('DL_BASE_URL') || 'https://domain-locker.com';

serve(async () => {
  console.log('🔁 Checking for expiring domains');

  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + 90);
  const dateStr = targetDate.toISOString().split('T')[0];

  const { data: expiring, error } = await supabase
    .from('domains')
    .select(`
      id,
      domain_name,
      expiry_date,
      user_id,
      registrars(name, url)
    `)
    .eq('expiry_date', dateStr);

  if (error) {
    console.error('❌ Error querying domains:', error);
    return new Response('Query error', { status: 500 });
  }

  if (!expiring || expiring.length === 0) {
    console.log('✅ No domains expiring in 90 days');
    return new Response('No upcoming expirations', { status: 200 });
  }

  for (const domain of expiring) {
    try {
      const { user_id, domain_name, expiry_date, registrars } = domain;

      const { data: userData } = await supabase.auth.admin.getUserById(user_id);
      const email = userData?.user?.email;

      if (!email) {
        console.warn(`⚠️ No email for user ${user_id}`);
        continue;
      }

      const registrar = registrars?.name || 'your registrar';
      const registrarUrl = registrars?.url || APP_BASE_URL;

      const title = `🌐 ${domain_name} expiration`;
      const desc = `Heads up! Your domain ${domain_name} is set to expire on ${formatDate(expiry_date)}.
We recommend logging into your registrar (${registrar}) to confirm that auto-renew is enabled or manually renew the domain to avoid any service disruptions.

This reminder was added via Domain Locker.
Manage all your domains here: ${APP_BASE_URL}`;

      const icsContent = buildICS({
        title,
        description: desc,
        date: expiry_date,
        domain: domain_name,
        url: registrarUrl,
        userName: userData.user?.user_metadata?.full_name || 'Domain Owner',
        userEmail: email,
      });

      console.log(`📅 Sending reminder for ${domain_name} to ${email}`);

      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: RESEND_SENDER,
          to: email,
          subject: `Domain Expiration: ${domain_name}`,
          html: `<p>${desc.replace(/\n/g, '<br>')}</p>`,
          attachments: [
            {
              filename: `${domain_name}-expiration.ics`,
              content: icsContent,
              content_type: 'text/calendar',
              disposition: 'attachment',
            }
          ],
        }),
      });

      if (!emailRes.ok) {
        const err = await emailRes.json();
        console.error(`❌ Failed to send invite to ${email}:`, err);
        continue;
      }
      
      await supabase.from('notifications').insert({
        user_id,
        domain_id: domain.id,
        change_type: 'reminder',
        message: `Domain ${domain_name} expiring in 90 days.`  +  (registrar ? `Renew it on ${registrar}.` : ''),
        sent: true,
        read: false
      });
    } catch (err) {
      console.error('❌ Failed processing domain:', err);
    }
  }

  return new Response('Done', { status: 200 });
});

function formatDate(date: string): string {
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return date;
    const day = d.getDate();
    const ord = ['th','st','nd','rd'][(day%10>3||~~((day%100)/10)==1)?0:day%10];
    return `${day}${ord} ${d.toLocaleString('en-US', { month: 'long' })} ${d.getFullYear()}`;
  } catch { return date; }
}

function buildICS({
  title,
  description,
  date,
  domain,
  url,
  userName,
  userEmail
}: {
  title: string;
  description: string;
  date: string;
  domain: string;
  url: string;
  userName: string;
  userEmail: string;
}): string {
  const start = date.replace(/-/g, '');
  const uid = `${domain}@domain-locker.com`;

  const end = new Date(date);
  end.setDate(end.getDate() + 1);
  const endStr = end.toISOString().split('T')[0].replace(/-/g, '');
  const now = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';

  const escapedDescription = description
  .replace(/\\/g, '\\\\')
  .replace(/\n/g, '\\n')
  .replace(/,/g, '\\,')
  .replace(/;/g, '\\;');

  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Domain Locker//EN
CALSCALE:GREGORIAN
METHOD:REQUEST
BEGIN:VEVENT
UID:${uid}
DTSTAMP:${now}
DTSTART;VALUE=DATE:${start}
DTEND;VALUE=DATE:${endStr}
SUMMARY:${title}
DESCRIPTION:${escapedDescription}
ATTENDEE;CN=${userName};RSVP=FALSE:mailto:${userEmail}
PRIORITY:5
URL:${url}
STATUS:CONFIRMED
SEQUENCE:0
TRANSP:OPAQUE
CLASS:PUBLIC
CREATED:${now}
LAST-MODIFIED:${now}
ORGANIZER;CN=Domain Locker:mailto:events@domain-locker.com
BEGIN:VALARM
TRIGGER:-P90D
DESCRIPTION:90-day reminder
ACTION:DISPLAY
END:VALARM
BEGIN:VALARM
TRIGGER:-P30D
DESCRIPTION:30-day reminder
ACTION:DISPLAY
END:VALARM
BEGIN:VALARM
TRIGGER:-P7D
DESCRIPTION:7-day reminder
ACTION:DISPLAY
END:VALARM
BEGIN:VALARM
TRIGGER:-P2D
DESCRIPTION:2-day reminder
ACTION:DISPLAY
END:VALARM
END:VEVENT
END:VCALENDAR`;
}
