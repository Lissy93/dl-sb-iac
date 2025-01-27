/**
 * Triggered by the trigger-updates function, with a { domain, user_id } payload.
 * For each domain, fetches the latest info from DO endpoint
 * then compares it with the current domain info in the database,
 * updating the database and triggering notifications if necessary.
 */

import { serve } from 'https://deno.land/std@0.131.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Keys
const DB_URL = Deno.env.get('DB_URL') ?? Deno.env.get('SUPABASE_URL') ?? '';
const DB_KEY = Deno.env.get('DB_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const AS93_DOMAIN_INFO_URL = Deno.env.get('AS93_DOMAIN_INFO_URL') ?? '';
const AS93_DOMAIN_INFO_KEY = Deno.env.get('AS93_DOMAIN_INFO_KEY') ?? '';

let changeCount = 0;

// Initialize Supabase client with superuser privileges
const supabase = createClient(DB_URL, DB_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

// Fetch domain data from the DigitalOcean serverless endpoint
async function fetchDomainData(domain: string) {
  try {
    const response = await fetch(AS93_DOMAIN_INFO_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${AS93_DOMAIN_INFO_KEY}`,
      },
      body: JSON.stringify({ domain }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch domain data: ${response.statusText}`);
    }

    const data = await response.json();
    return data.body.domainInfo;
  } catch (error) {
    console.error(`Error fetching domain data: ${error.message}`);
    throw error;
  }
}

// Compare dates ignoring time and timezone
function areDatesEqual(date1: string | null, date2: string | null): boolean {
  if (!date1 || !date2) return false;
  return new Date(date1).toISOString().slice(0, 10) === new Date(date2).toISOString().slice(0, 10);
}

// Mapping for changeType to notification_type
const changeTypeToNotificationType: Record<string, string> = {
  registrar: 'registrar',
  whois_organization: 'whois_',
  dns_ns: 'dns_',
  dns_txt: 'dns_',
  dns_mx: 'dns_',
  ip_ipv4: 'ip_',
  ip_ipv6: 'ip_',
  ssl_issuer: 'ssl_issuer',
  host: 'host',
  status: 'status',
};

// Mapping for field names to human-readable names
const fieldToHumanName: Record<string, string> = {
  registrar: 'Registrar',
  whois_organization: 'WHOIS Organization',
  dns_ns: 'Nameserver',
  dns_txt: 'TXT Record',
  dns_mx: 'MX Record',
  ip_ipv4: 'IPv4 Address',
  ip_ipv6: 'IPv6 Address',
  ssl_issuer: 'SSL Issuer',
  dates_expiry: 'Expiry Date',
  dates_updated: 'Last Update Date',
  status: 'Domain Status'
};

// Function to check notification preferences and insert notification if enabled
async function checkAndInsertNotification(domainId: string, userId: string, changeType: string, field: string, oldValue: any, newValue: any) {
  // Map changeType to the relevant notification type
  const notificationType = changeTypeToNotificationType[field];
  
  if (!notificationType) {
    console.warn(`No matching notification type found for changeType "${field}"`);
    return;
  }

  // Check if the notification type is enabled for this domain
  const { data: preference, error } = await supabase
    .from('notification_preferences')
    .select('is_enabled')
    .eq('domain_id', domainId)
    .eq('notification_type', notificationType)
    .single();

  if (error) {
    console.error(`Error checking notification preference for type "${notificationType}": ${error.message}`);
    return;
  }

  // If the notification is enabled, insert a new notification into the notifications table
  if (preference?.is_enabled) {
    const humanFieldName = fieldToHumanName[field] || field;
    let message;
    if (oldValue === null || oldValue === 'Unknown') {
      message = `${humanFieldName} was added "${newValue}"`;
    } else if (newValue === null || newValue === 'Unknown') {
      message = `${humanFieldName} was removed "${oldValue}"`;
    } else {
      message = `The ${humanFieldName} for your domain has changed from "${oldValue}" to "${newValue}".`;
    }

    await supabase.from('notifications').insert({
      user_id: userId,
      domain_id: domainId,
      change_type: field,
      message: message,
      sent: false,
      read: false,
    });
  }
}

// Function to record domain change and trigger notification if applicable
async function recordDomainChange(domainId: string, userId: string, changeType: string, field: string, oldValue: any, newValue: any) {
  if (newValue === 'Unknown') return;
  if ((oldValue || '').toLowerCase() === (newValue || '').toLowerCase()) return;
  try {
    console.log(`Domain "${domainId}" "${changeType}" "${field}" from "${oldValue}" to "${newValue}"`);
    changeCount++;

    // Insert domain change into domain_updates
    await supabase.from('domain_updates').insert({
      domain_id: domainId,
      user_id: userId,
      change: field,
      change_type: changeType,
      old_value: oldValue,
      new_value: newValue,
      date: new Date(),
    });

    // Call function to check notification preference and insert notification if enabled
    await checkAndInsertNotification(domainId, userId, changeType, field, oldValue, newValue);
  } catch (error) {
    console.error(`Error recording domain change: ${error.message}`);
  }
}

// Case-insensitive comparison for string values
function isDifferentCaseInsensitive(value1: string | null, value2: string | null) {
  return (value1?.toLowerCase() ?? '') !== (value2?.toLowerCase() ?? '');
}

// Update WHOIS information
async function updateWhoisInfo(domainId: string, userId: string, domainInfo: any, currentDomain: any) {
  const whoisFields = [
    { apiField: 'name', dbField: 'name' },
    { apiField: 'organization', dbField: 'organization' },
    { apiField: 'stateProvince', dbField: 'state' },
    { apiField: 'city', dbField: 'city' },
    { apiField: 'country', dbField: 'country' },
    { apiField: 'postalCode', dbField: 'postal_code' },
  ];

  for (const { apiField, dbField } of whoisFields) {
    if (isDifferentCaseInsensitive(domainInfo.whois[apiField], currentDomain.whois_info[dbField])) {
      await recordDomainChange(domainId, userId, 'updated', `whois_${apiField}`, currentDomain.whois_info[dbField], domainInfo.whois[apiField]);
      await supabase.from('whois_info').upsert({
        domain_id: domainId,
        [dbField]: domainInfo.whois[apiField],
      });
    }
  }
}

// Update Domain Data
async function updateDomainData(domainId: string, userId: string, domainInfo: any, currentDomain: any) {
  try {
    // 1. Registrar
    if (isDifferentCaseInsensitive(domainInfo.registrar.name, currentDomain.registrars.name)) {
      await recordDomainChange(domainId, userId, 'updated', 'registrar', currentDomain.registrars.name, domainInfo.registrar.name);
      const { data: existingRegistrar } = await supabase.from('registrars').select('id').ilike('name', domainInfo.registrar.name).single();

      if (existingRegistrar) {
        await supabase.from('domains').update({ registrar_id: existingRegistrar.id }).eq('id', domainId);
      } else {
        const { data: newRegistrar } = await supabase
          .from('registrars')
          .insert({ name: domainInfo.registrar.name, url: domainInfo.registrar.url })
          .select('id')
          .single();
        if (newRegistrar) {
          await supabase.from('domains').update({ registrar_id: newRegistrar.id }).eq('id', domainId);
        }
      }
    }

    // 2. WHOIS
    await updateWhoisInfo(domainId, userId, domainInfo, currentDomain);

    // 3. DNS Records (NS, TXT, MX)
    const dnsRecordTypes = ['NS', 'TXT', 'MX'];
    for (const recordType of dnsRecordTypes) {
      const key = { NS: 'nameServers', TXT: 'txtRecords', MX: 'mxRecords' }[recordType] || '';
      const newRecords = domainInfo.dns[key]?.map(r => r.toLowerCase()) || [];
      const { data: currentRecords } = await supabase.from('dns_records').select('*').eq('domain_id', domainId).eq('record_type', recordType);

      const addedRecords = newRecords.filter(r => !currentRecords.some(cr => cr.record_value.toLowerCase() === r));
      const removedRecords = currentRecords.filter(cr => !newRecords.includes(cr.record_value.toLowerCase()));

      for (const added of addedRecords) {
        await recordDomainChange(domainId, userId, 'added', `dns_${recordType.toLowerCase()}`, null, added);
        await supabase.from('dns_records').insert({ domain_id: domainId, record_type: recordType, record_value: added });
      }
      for (const removed of removedRecords) {
        await recordDomainChange(domainId, userId, 'removed', `dns_${recordType.toLowerCase()}`, removed.record_value, null);
        await supabase.from('dns_records').delete().eq('id', removed.id);
      }
    }

    // 4. IP Addresses
    const ipVersions = ['ipv4', 'ipv6'];
    for (const version of ipVersions) {
      const newIps = domainInfo.ipAddresses[version].map((ip: string) => ip.toLowerCase());
      const { data: currentIps } = await supabase.from('ip_addresses').select('*').eq('domain_id', domainId).eq('is_ipv6', version === 'ipv6');

      const addedIps = newIps.filter(ip => !currentIps.some(cip => cip.ip_address.toLowerCase() === ip));
      const removedIps = currentIps.filter(cip => !newIps.includes(cip.ip_address.toLowerCase()));

      for (const added of addedIps) {
        await recordDomainChange(domainId, userId, 'added', `ip_${version}`, null, added);
        await supabase.from('ip_addresses').insert({ domain_id: domainId, ip_address: added, is_ipv6: version === 'ipv6' });
      }
      for (const removed of removedIps) {
        await recordDomainChange(domainId, userId, 'removed', `ip_${version}`, removed.ip_address, null);
        await supabase.from('ip_addresses').delete().eq('id', removed.id);
      }
    }

    // 5. SSL Certificate
    const existingSsl = (currentDomain.ssl_certificates && currentDomain.ssl_certificates.length) ? currentDomain.ssl_certificates[0] : null;
    if (existingSsl) {
      if (
        isDifferentCaseInsensitive(domainInfo.ssl.issuer, existingSsl.issuer) ||
        !areDatesEqual(domainInfo.ssl.validFrom, existingSsl.valid_from) ||
        !areDatesEqual(domainInfo.ssl.validTo, existingSsl.valid_to)
      ) {
        // Record any detected change
        await recordDomainChange(domainId, userId, 'updated', 'ssl_issuer', existingSsl.issuer, domainInfo.ssl.issuer);
        
        // Update the existing SSL certificate record
        await supabase
          .from('ssl_certificates')
          .update({
            issuer: domainInfo.ssl.issuer,
            valid_from: domainInfo.ssl.validFrom,
            valid_to: domainInfo.ssl.validTo,
          })
          .eq('domain_id', domainId);
      }
    } else {
      // No existing SSL record, so insert a new one
      await supabase.from('ssl_certificates').insert({
        domain_id: domainId,
        issuer: domainInfo.ssl.issuer,
        valid_from: domainInfo.ssl.validFrom,
        valid_to: domainInfo.ssl.validTo,
      });
    }

    // 6. Status Codes
    const newStatuses = domainInfo.status.map((s: string) => s.toLowerCase());

    if (!newStatuses || !newStatuses.length) {
      const { data: currentStatuses } = await supabase.from('domain_statuses').select('*').eq('domain_id', domainId);

      const addedStatuses = newStatuses.filter((s: string) => !currentStatuses.some((cs: any) => cs.status_code.toLowerCase() === s));
      const removedStatuses = currentStatuses.filter((cs: { status_code: string; }) => !newStatuses.includes(cs.status_code.toLowerCase()));
  
      for (const added of addedStatuses) {
        await recordDomainChange(domainId, userId, 'added', 'status', null, added);
        await supabase.from('domain_statuses').insert({ domain_id: domainId, status_code: added });
      }
      for (const removed of removedStatuses) {
        await recordDomainChange(domainId, userId, 'removed', 'status', removed.status_code, null);
        await supabase.from('domain_statuses').delete().eq('id', removed.id);
      }
    }

    // 7. Dates
    if (!areDatesEqual(domainInfo.dates.expiry, currentDomain.expiry_date)) {
      await recordDomainChange(domainId, userId, 'updated', 'dates_expiry', currentDomain.expiry_date, domainInfo.dates.expiry);
      await supabase.from('domains').update({ expiry_date: domainInfo.dates.expiry }).eq('id', domainId);
    }
    if (!areDatesEqual(domainInfo.dates.updated, currentDomain.updated_date)) {
      await recordDomainChange(domainId, userId, 'updated', 'dates_updated', currentDomain.updated_date, domainInfo.dates.updated);
      await supabase.from('domains').update({ updated_date: domainInfo.dates.updated }).eq('id', domainId);
    }
  } catch (error) {
    console.error(`Error updating domain data: ${(error as Error).message}`);
  }
}

// Serve function for Supabase
serve(async (req) => {
  const { domain, user_id } = await req.json();
  if (!domain || !user_id) {
    return new Response(JSON.stringify({ message: '❌ Domain could not be updated', error: 'Missing params, domain and/or user_id' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  
  if (!DB_URL || !DB_KEY) {
    return new Response(JSON.stringify({ message: `❌ ${domain} could not be updated`, error: 'Missing DB URL and/or KEY' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const domainInfo = await fetchDomainData(domain);
    const { data: domainRecord, error } = await supabase
      .from('domains')
      .select(`
        *,
        registrars (name, url),
        ip_addresses (ip_address, is_ipv6),
        ssl_certificates (issuer, valid_from, valid_to),
        whois_info (name, organization, state, country, street, city, postal_code),
        dns_records (record_type, record_value),
        domain_statuses (status_code)
      `)
      .eq('domain_name', domain)
      .eq('user_id', user_id)
      .single();

    if (error || !domainRecord) {
      return new Response('Domain not found for user', { status: 404 });
    }

    await updateDomainData(domainRecord.id, user_id, domainInfo, domainRecord);

    return new Response(JSON.stringify({ message: `✅ ${domain} updates successfully: ${changeCount} changes.` }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ message: `⚠️ ${domain} could not be updated`, error: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
