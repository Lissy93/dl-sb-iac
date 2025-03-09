
       ____                        _         _               _             
      |  _ \  ___  _ __ ___   __ _(_)_ __   | |    ___   ___| | _____ _ __ 
      | | | |/ _ \| '_ ` _ \ / _` | | '_ \  | |   / _ \ / __| |/ / _ \ '__|
      | |_| | (_) | | | | | | (_| | | | | | | |__| (_) | (__|   <  __/ |   
      |____/ \___/|_| |_| |_|\__,_|_|_| |_| |_____\___/ \___|_|\_\___|_|   
                                                                           

>> This repo contains the config, schema and edge functions for Domain Locker <<
>> For the main project and app, see https://github.com/lissy93/domain-locker <<

================================================================================
DIRECTORY STRUCTURE
================================================================================
domain-locker-edge/
├─ supabase/
│  ├─ functions/    # Deno Edge functions
│  ├─ migrations/   # Database schema
│  ├─ templates/    # Mailer templates
│  ╰─ config.toml   # Supabase configuration
├─ .github/         # Repo admin, and GH Actions
│  ├─ workflows/    # CI/CD files for deployment
│  ╰─ README.txt    # You're looking at it ;)
├─ Makefile         # Project commands
├─ deno.json        # Deno project config
╰─ .gitignore       # Stuff to not commit

================================================================================
DEVELOPING
================================================================================
Pre-requisites:
  - Install Git, Deno, Supabase CLI, Postgres and Docker on your local machine
  - Deploy a Supabase instance. See https://supabase.io/docs/guides/self-hosting
  - Configure all the required environmental variables for services (see below)

Project setup:
  git clone git@github.com:Lissy93/domain-locker-edge.git
  supabase link --project-ref PROJECT_REF

Development:
  supabase start
  supabase status
  supabase functions serve

================================================================================
DEPLOYING
================================================================================
supabase secrets set-from-env   # Set environments
supabase config push            # Apply configuration
supabase db push                # Deploy schema
supabase functions deploy       # Deploy functions

See the `Makefile` for all deployment commands.

The easiest way to deploy is via GitHub Actions, which we use for CI/CD. 
Just push to main or trigger the supabase.yml workflow, and it will deploy

You'll need to configure the following GitHub secrets to authenticate:
  SUPABASE_PROJECT_ID     - The Supabase project ID
  SUPABASE_ACCESS_TOKEN   - The Supabase access token
  SUPABASE_DB_PASSWORD    - The Postgres password for your Supabase DB
  SUPABASE_ENV_FILE       - Raw text env vars for all else you need (see below)

================================================================================
ENVIRONMENT VARIABLES
================================================================================
Supabase:
  DB_URL - The URL to your Supabase instance and project
  DB_KEY - The anon key to your new Supabase project

Authentication
  SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID   - Google OAuth Client ID
  SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET      - Google OAuth Secret
  SUPABASE_AUTH_EXTERNAL_FACEBOOK_CLIENT_ID - Facebook OAuth Client ID
  SUPABASE_AUTH_EXTERNAL_FACEBOOK_SECRET    - Facebook OAuth Secret
  SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID   - GitHub OAuth Client ID
  SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET      - GitHub OAuth Secret

API Endpoints:
  AS93_DOMAIN_INFO_URL  - The URL to our external domain info API
  AS93_DOMAIN_INFO_KEY  - And the key for the domain info API
  AS93_SPONSORS_API     - The URL to our GitHub sponsors API

Worker Endpoints:
  WORKER_DOMAIN_UPDATER_URL - The URL to domain-updater function
  WORKER_SEND_NOTIFICATION_URL - The URL to send-notification function

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

Twilio:
  TWILIO_SID - Twilio account SID
  TWILIO_AUTH_TOKEN - Twilio auth token
  TWILIO_PHONE_NUMBER - Twilio phone number
  TWILIO_WHATSAPP_NUMBER - Twilio WhatsApp number

Telegram
  TELEGRAM_BOT_TOKEN - The token for the telegram notification bot

It's advisable to use a secret store for this. We use Supabase Vault.
Or, you can pass secrets to Supabase, by running:
supabase secrets set --env-file supabase/functions/.env

================================================================================
FUNCTIONS
================================================================================
Stripe and Billing:
- cancel-subscription Cancels a user's subscription
- checkout-session    Creates a new checkout session for a subscription
- stripe-webhook      Handles incoming events triggered from Stripe
- new-user-billing    Adds a billing record for new users + checks if sponsor

User Management:
- delete-account      Deletes a user account and all associated data
- export-data         Exports all (selected) data for a user in a given format

Domain Management:
- trigger-updates     Selects all domains for users, and triggers domain-updater
- domain-updater      Updates domains with latest info, triggers notifications
- send-notification   Sends a notification to user id with message
- website-monitor     Gets response info for each (pro) domain, updates db

Info Routes:
- domain-info         Fetches all info for any given domain name
- domain-subs         Fetches all subdomains for any given domain

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
  - Endpoint: https://[supabase-instance]/functions/v1/trigger-updates

JOB 2 - Trigger website monitor every hour
  - Schedule: 0 * * * *
  - Nodename: localhost
  - Nodeport: 5432
  - Database: postgres
  - Username: postgres
  - Job Name: run_website_monitor_job
  - Endpoint: https://[supabase-instance]/functions/v1/website-monitor

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
SUPPORT
================================================================================
We do not provide support for this codebase. It is provided as-is.
If you need help, please refer to the official docs for the services used.
We are not accepting feature requests or bug reports (except security issues).

The difficulty of deploying this project is graded at moderate to hard
You'll need a solid understanding of Deno, Supabase, Postgres and Docker

It is also possible to run Domain Locker without Supabase, using Postgres only.

================================================================================
NOTES
================================================================================
For troubleshooting, ensure protocol, method, port, headers and body are correct
You must set and upload ALL environmental variables properly for things to work
Avoid configuring in the Supabase UI, instead update the TOML file and re-deploy

Example CURL request:
  curl -i --location \
    --request POST 'https://[project].supabase.co/functions/v1/hello-world' \
    --header 'Authorization: Bearer xxxxx' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Dino"}'

Or, for local dev, the URL would be: 127.0.0.1:54321/functions/v1/hello-world

It is your responsibility to maintain, secure and backup your Supabase instance

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
