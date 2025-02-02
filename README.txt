

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
DB_URL - The URL to your Supabase project
DB_KEY - The anon key to your Supabase project

AS93_DOMAIN_INFO_URL - The URL to our external domain info API
AS93_DOMAIN_INFO_KEY - And the key for the domain info API

STRIPE_SECRET_KEY - Stripe secret key (starting with sk_live_ or sk_test_)
STRIPE_WEBHOOK_SECRET - Stripe webhook secret (starting with whsec_)

STRIPE_PRICE_HM - Stripe price ID for the hobby monthly plan (starting with price_)
STRIPE_PRICE_HA - Price ID for the hobby annual plan
STRIPE_PRICE_PM - Price ID for the pro monthly plan
STRIPE_PRICE_PA - Price ID for the pro annual plan

Don't forget to pass the env vars to Supabase, with:
npx supabase secrets set --env-file ./supabase/.env

================================================================================
NOTES
================================================================================

Example CURL request:

curl -i --location \
  --request POST 'https://[project].supabase.co/functions/v1/hello-world' \
  --header 'Authorization: Bearer xxxxx' \
  --header 'Content-Type: application/json' \
  --data '{"name":"Dino"}'

During development, the URL would be: http://127.0.0.1:54321/functions/v1/hello-world
You can get the token from the Supabase dashboard, under settings --> API
