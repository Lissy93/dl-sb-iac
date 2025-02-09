
 /$$$$$$$                                    /$$            
| $$__  $$                                  |__/            
| $$  \ $$  /$$$$$$  /$$$$$$/$$$$   /$$$$$$  /$$ /$$$$$$$   
| $$  | $$ /$$__  $$| $$_  $$_  $$ |____  $$| $$| $$__  $$  
| $$  | $$| $$  \ $$| $$ \ $$ \ $$  /$$$$$$$| $$| $$  \ $$  
| $$  | $$| $$  | $$| $$ | $$ | $$ /$$__  $$| $$| $$  | $$  
| $$$$$$$/|  $$$$$$/| $$ | $$ | $$|  $$$$$$$| $$| $$  | $$  
|_______/  \______/ |__/ |__/ |__/ \_______/|__/|__/  |__/  
                                                            
                                                            
                                                            
 /$$                           /$$                          
| $$                          | $$                          
| $$        /$$$$$$   /$$$$$$$| $$   /$$  /$$$$$$   /$$$$$$ 
| $$       /$$__  $$ /$$_____/| $$  /$$/ /$$__  $$ /$$__  $$
| $$      | $$  \ $$| $$      | $$$$$$/ | $$$$$$$$| $$  \__/
| $$      | $$  | $$| $$      | $$_  $$ | $$_____/| $$      
| $$$$$$$$|  $$$$$$/|  $$$$$$$| $$ \  $$|  $$$$$$$| $$      
|________/ \______/  \_______/|__/  \__/ \_______/|__/      
                                                            

>> This repo contains the code for Domain Locker's serverless edge functions. <<

================================================================================
PROJECT SETUP
================================================================================
Pre-requisites:
Install Supabase CLI, launch Docker, login, link project, and start Supabase:
  npx supabase login
  npx supabase link --project-ref ********************
  npx supabase start
  supabase status

Development:
  npx supabase functions serve

Deploy:
  npx supabase functions deploy


================================================================================
FUNCTIONS
================================================================================
Stripe and Billing:
- cancel-subscription
- checkout-session
- stripe-webhook

Domain Management:
- trigger-updates - Selects all domains for users, and triggers domain-updater
- domain-updater - Updates domains with latest info, triggers notifications
- send-notification - Sends a notification to user id with message
- website-monitor - Gets response info for each (pro) domain, updates db

Info Routes:
- domain-info

================================================================================
ENVIRONMENT VARIABLES
================================================================================
Supabase:
  DB_URL - The URL to your Supabase project
  DB_KEY - The anon key to your Supabase project

API Endpoints:
  AS93_DOMAIN_INFO_URL - The URL to our external domain info API
  AS93_DOMAIN_INFO_KEY - And the key for the domain info API

Stripe:
  STRIPE_SECRET_KEY - Stripe secret key (starting with sk_live_ or sk_test_)
  STRIPE_WEBHOOK_SECRET - Stripe webhook secret (starting with whsec_)

Stripe Prices:
  STRIPE_PRICE_HM - Stripe price ID for the hobby monthly plan (starting price_)
  STRIPE_PRICE_HA - Price ID for the hobby annual plan
  STRIPE_PRICE_PM - Price ID for the pro monthly plan
  STRIPE_PRICE_PA - Price ID for the pro annual plan

Resend:
  RESEND_API_KEY - The API key for the Resend service (send access)
  RESEND_SENDER - The sender email for Resend

Don't forget to pass the env vars to Supabase, with:
npx supabase secrets set --env-file ./supabase/.env

================================================================================
CRON JOBS
================================================================================
We use crons to trigger some functions at specific times via pg_cron in Posthres
This is used for keeping the domain info up-to-date, and for monitoring websites

JOB 1 - Trigger domain updates at 04:00 every day
  - Schedule: 0 4 * * *
  - Nodename: localhost
  - Nodeport: 5432
  - Database: postgres
  - Username: postgres
  - Job Name: run_domain_update_job
  - Endpoint: https://[supabase-project].supabase.co/functions/v1/trigger-updates

JOB 2 - Trigger website monitor every hour
  - Schedule: 0 * * * *
  - Nodename: localhost
  - Nodeport: 5432
  - Database: postgres
  - Username: postgres
  - Job Name: run_website_monitor_job
  - Endpoint: https://[supabase-project].supabase.co/functions/v1/website-monitor

Example SQL for cron job:
  SELECT
    net.http_post(
      url := '[url to endpoint]',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer YOUR_API_KEY'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 5000
    ) AS request_id;


================================================================================
NOTES
================================================================================
Example CURL request:

curl -i --location \
  --request POST 'https://[project].supabase.co/functions/v1/hello-world' \
  --header 'Authorization: Bearer xxxxx' \
  --header 'Content-Type: application/json' \
  --data '{"name":"Dino"}'

For local dev, the URL would be: http://127.0.0.1:54321/functions/v1/hello-world
You can get the token from the Supabase dashboard, under settings --> API


The code is intended to be portable.
Deployable to Supabase functions, Deno Deploy, Fly.io, or any system via Docker.


================================================================================
LICENSE
================================================================================
Copyright (c) 2025 Alicia Sykes

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

================================================================================
ABOUT
================================================================================
Coded with ❤ and ♨ by Alicia Sykes                      https://aliciasykes.com
Built for Domain Locker                                https://domain-locker.com

Thanks for being here! (●'◡'●)
================================================================================

               __
              /°_)
     _.----._/ /
    /         /
 __/ (  | (  |
/__.-'|_|--|_|
