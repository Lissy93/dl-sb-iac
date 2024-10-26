import { serve } from 'https://deno.land/std@0.131.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Keys
const DB_URL = Deno.env.get('DB_URL') ?? '';
const DB_KEY = Deno.env.get('DB_KEY') ?? '';


const AS93_DOMAIN_INFO_URL = Deno.env.get('AS93_DOMAIN_INFO_URL') ?? '';
const AS93_DOMAIN_INFO_KEY = Deno.env.get('AS93_DOMAIN_INFO_KEY') ?? '';


let changeCount = 0;

// Initialize Supabase client with superuser privileges to bypass RLS
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

// Compare two dates ignoring time and timezone
function areDatesEqual(date1: string | null, date2: string | null): boolean {
  if (!date1 || !date2) return false;

  try {
    const d1 = new Date(date1).toISOString().slice(0, 10);
    const d2 = new Date(date2).toISOString().slice(0, 10);
    return d1 === d2;
  } catch (error) {
    console.error(`Error comparing dates: ${error.message}`);
    return false;
  }
}

// Record domain change in the `domain_updates` table
async function recordDomainChange(domainId: string, userId: string, changeType: string, field: string, oldValue: any, newValue: any) {
  try {
    console.log(`Domain "${domainId}" "${changeType}" "${field}" from "${oldValue}" to "${newValue}"`);
    changeCount++;
    await supabase.from('domain_updates').insert({
      domain_id: domainId,
      user_id: userId, // Record the user ID
      change: field,
      change_type: changeType,
      old_value: oldValue,
      new_value: newValue,
      date: new Date(),
    });
  } catch (error) {
    console.error(`Error recording domain change: ${error.message}`);
  }
}

// Update WHOIS info
async function updateWhoisInfo(domainId: string, userId: string, domainInfo: any, currentDomain: any) {
  const whoisFields = ['name', 'organization', 'stateProvince', 'city', 'country', 'postal_code'];
  for (const field of whoisFields) {
    const key = {
      name: 'name',
      organization: 'organization',
      stateProvince: 'state',
      city: 'city',
      country: 'country',
      postalCode: 'postal_code',
    }[field] || '';

    if (domainInfo.whois[field] !== currentDomain.whois_info[key] && domainInfo.whois[field] !== 'Unknown') {
      await recordDomainChange(domainId, userId, 'updated', `whois_${field}`, currentDomain.whois_info[key], domainInfo.whois[field]);

      // Check if whois info exists, then update; otherwise, insert
      const { data: existingWhois } = await supabase
        .from('whois_info')
        .select('id')
        .eq('domain_id', domainId)
        .single();

      if (existingWhois) {
        // Update existing WHOIS info
        await supabase
          .from('whois_info')
          .update({ [key]: domainInfo.whois[field] })
          .eq('domain_id', domainId);
      } else {
        // Insert new WHOIS info if not already present
        await supabase.from('whois_info').insert({
          domain_id: domainId,
          [key]: domainInfo.whois[field],
        });
      }
    }
  }
}

// Update DNS records, WHOIS, SSL certificates, IP addresses, and statuses
async function updateDomainData(domainId: string, userId: string, domainInfo: any, currentDomain: any) {
  try {
    // 1. Update registrar
    if (domainInfo.registrar && domainInfo.registrar.name !== currentDomain.registrars.name && domainInfo.registrar.name !== 'Unknown') {
      await recordDomainChange(domainId, userId, 'updated', 'registrar', currentDomain.registrars.name, domainInfo.registrar.name);

      const { data: existingRegistrar } = await supabase
        .from('registrars')
        .select('id')
        .eq('name', domainInfo.registrar.name)
        .single();

      if (existingRegistrar) {
        await supabase.from('domains').update({ registrar_id: existingRegistrar.id }).eq('id', domainId);
      } else {
        const { data: newRegistrar, error: registrarError } = await supabase
          .from('registrars')
          .insert({
            name: domainInfo.registrar.name,
            url: domainInfo.registrar.url,
          })
          .select('id')
          .single();

        if (!registrarError) {
          await supabase.from('domains').update({ registrar_id: newRegistrar.id }).eq('id', domainId);
        }
      }
    }

    // 2. Update WHOIS info
    await updateWhoisInfo(domainId, userId, domainInfo, currentDomain);

    // 3. Update DNS records (NS, TXT, MX)
    const dnsRecordsToUpdate = ['NS', 'TXT', 'MX'];
    for (const recordType of dnsRecordsToUpdate) {
      const key = { NS: 'nameServers', TXT: 'txtRecords', MX: 'mxRecords' }[recordType] || '';
      const newRecords = domainInfo.dns[key] || [];
      const { data: currentRecords } = await supabase
        .from('dns_records')
        .select('*')
        .eq('domain_id', domainId)
        .eq('record_type', recordType);

      const addedRecords = newRecords.filter(r => !currentRecords.some(cr => cr.record_value === r));
      const removedRecords = currentRecords.filter(cr => !newRecords.some(nr => nr === cr.record_value));

      for (const added of addedRecords) {
        await recordDomainChange(domainId, userId, 'added', `dns_${recordType.toLowerCase()}`, null, added);
        await supabase.from('dns_records').insert({ domain_id: domainId, record_type: recordType, record_value: added });
      }

      for (const removed of removedRecords) {
        await recordDomainChange(domainId, userId, 'removed', `dns_${recordType.toLowerCase()}`, removed.record_value, null);
        await supabase.from('dns_records').delete().eq('id', removed.id);
      }
    }

    // 4. Update IP addresses (IPv4, IPv6)
    const ipVersions = ['ipv4', 'ipv6'];
    for (const ipVersion of ipVersions) {
      const newIps = domainInfo.ipAddresses[ipVersion];
      const { data: currentIps } = await supabase
        .from('ip_addresses')
        .select('*')
        .eq('domain_id', domainId)
        .eq('is_ipv6', ipVersion === 'ipv6');

      const addedIps = newIps.filter(ip => !currentIps.some(cip => cip.ip_address === ip));
      const removedIps = currentIps.filter(cip => !newIps.some(nip => nip === cip.ip_address));

      for (const added of addedIps) {
        await recordDomainChange(domainId, userId, 'added', `ip_${ipVersion}`, null, added);
        await supabase.from('ip_addresses').insert({ domain_id: domainId, ip_address: added, is_ipv6: ipVersion === 'ipv6' });
      }

      for (const removed of removedIps) {
        await recordDomainChange(domainId, userId, 'removed', `ip_${ipVersion}`, removed.ip_address, null);
        await supabase.from('ip_addresses').delete().eq('id', removed.id);
      }
    }

    // 5. Update SSL certificates
    if (domainInfo.ssl && domainInfo.ssl.issuer !== currentDomain.ssl_certificates.issuer && domainInfo.ssl.issuer !== 'Unknown') {
      await recordDomainChange(domainId, userId, 'updated', 'ssl_issuer', currentDomain.ssl_certificates.issuer, domainInfo.ssl.issuer);
      await supabase.from('ssl_certificates').upsert({
        domain_id: domainId,
        issuer: domainInfo.ssl.issuer,
        valid_from: domainInfo.ssl.validFrom,
        valid_to: domainInfo.ssl.validTo,
      });
    }

    // 6. Update status codes
    const { data: currentStatuses } = await supabase.from('domain_statuses').select('*').eq('domain_id', domainId);
    const newStatuses = domainInfo.status;

    const addedStatuses = newStatuses.filter(s => !currentStatuses.some(cs => cs.status_code === s));
    const removedStatuses = currentStatuses.filter(cs => !newStatuses.some(ns => ns === cs.status_code));

    for (const added of addedStatuses) {
      await recordDomainChange(domainId, userId, 'added', 'status', null, added);
      await supabase.from('domain_statuses').insert({ domain_id: domainId, status_code: added });
    }

    for (const removed of removedStatuses) {
      await recordDomainChange(domainId, userId, 'removed', 'status', removed.status_code, null);
      await supabase.from('domain_statuses').delete().eq('id', removed.id);
    }

    // 7. Update expiry and update dates
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

// Supabase function handler
serve(async (req) => {
  const { domain, user_id } = await req.json(); // Get domain and user_id from request body

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
