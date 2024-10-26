import { serve } from 'https://deno.land/std@0.131.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const DB_URL = Deno.env.get('DB_URL') ?? '';
const DB_KEY = Deno.env.get('DB_KEY') ?? '';
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

// Record domain change in the `domain_updates` table
async function recordDomainChange(domainId: string, userId: string, changeType: string, field: string, oldValue: any, newValue: any) {
  changeCount++;
  console.log(`Change ${changeCount}: ${changeType} ${field} from ${oldValue} to ${newValue}`);
  await supabase.from('domain_updates').insert({
    domain_id: domainId,
    user_id: userId,
    change: field,
    change_type: changeType,
    old_value: oldValue,
    new_value: newValue,
    date: new Date(),
  });
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
      const newIps = domainInfo.ipAddresses[version].map(ip => ip.toLowerCase());
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
    const newStatuses = domainInfo.status.map(s => s.toLowerCase());
    const { data: currentStatuses } = await supabase.from('domain_statuses').select('*').eq('domain_id', domainId);

    const addedStatuses = newStatuses.filter(s => !currentStatuses.some(cs => cs.status_code.toLowerCase() === s));
    const removedStatuses = currentStatuses.filter(cs => !newStatuses.includes(cs.status_code.toLowerCase()));

    for (const added of addedStatuses) {
      await recordDomainChange(domainId, userId, 'added', 'status', null, added);
      await supabase.from('domain_statuses').insert({ domain_id: domainId, status_code: added });
    }
    for (const removed of removedStatuses) {
      await recordDomainChange(domainId, userId, 'removed', 'status', removed.status_code, null);
      await supabase.from('domain_statuses').delete().eq('id', removed.id);
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
    console.error(`Error updating domain data: ${error.message}`);
  }
}

// Serve function for Supabase
serve(async (req) => {
  const { domain, user_id } = await req.json();
  if (!domain || !user_id) {
    return new Response('Domain and user_id are required', { status: 400 });
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

    return new Response(JSON.stringify({ message: 'Domain updated successfully', fieldsUpdated: changeCount }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(error.message, { status: 500 });
  }
});
