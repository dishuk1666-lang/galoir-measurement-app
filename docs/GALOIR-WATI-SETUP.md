# GALOIR × WATI — WhatsApp Notification Setup

## Current state and safety
The GALOIR app integrates with **your existing WATI Business account** using the WATI v3 API.
Messaging is **OFF by default** in GALOIR Admin Settings. Only future billed orders where the cashier checks customer WhatsApp consent are eligible.
Existing billed orders are never contacted retroactively. Repeated Ready scans do not create duplicate notifications.

**Never paste the WATI API token into the client-side app, GitHub or customer chat.** Use Supabase Edge Function Secrets.

## 1 — WATI credentials
Sign in to WATI:
1. Go to **Connector → API → Create API Token**.
2. Choose the required scope **messagetemplatev3:write**.
3. Note the **WhatsApp sending/channel phone number** in international form, digits only (e.g. 91xxxxxxxxxx).
4. Add these secrets to Supabase **Edge Functions → Secrets** for project `ooowmzrfthsozgbcjskm`:

| Secret name | Meaning |
|---|---|
| `WATI_API_TOKEN` | The secret WATI API token; required |
| `WATI_CHANNEL_NUMBER` | Connected WATI sending number, international digits, no `+`; required |
| `WATI_TEMPLATE_ORDER_CONFIRMED` | Exact approved WATI template name; optional if default below |
| `WATI_TEMPLATE_READY_FOR_COLLECTION` | Exact approved WATI template name; optional if default below |

These secrets are used only by the deployed Supabase Edge Function `galoir-whatsapp-dispatch`.

## 2 — Create two Utility templates in WATI
Go to **WATI → Campaigns → Template Messages → Your Templates → New Template Message**.
Choose **Utility**, English, text only; submit each for approval.

**Template 1 — `galoir_order_finalised_wati_v1`**

```
Hello {{customer_name}},

Your GALOIR order has been finalised.

Bill Number: {{bill_no}}
GL Slip Number: {{slip_no}}
Total Amount: ₹{{total_amount}}
Amount Paid: ₹{{paid_amount}}
Balance Due: ₹{{balance_amount}}
Expected Delivery: {{delivery_date}}

We will update you when your outfit is ready for collection.

GALOIR
```

Variables sent from the app are named exactly:
`customer_name`, `slip_no`, `bill_no`, `total_amount`, `paid_amount`, `balance_amount`, `delivery_date`.

**Template 2 — `galoir_ready_for_collection_wati_v1`**

```
Hello {{customer_name}},

Your GALOIR outfit for GL Slip {{slip_no}} (Bill {{bill_no}}) is ready for collection.

Please contact our store to confirm the collection arrangements.

GALOIR
```

Variables sent from the app are named exactly:
`customer_name`, `slip_no`, `bill_no`.

**Template variable names must match exactly, including case.** Meta approves the Utility templates through WATI. Do not add promotional text.

## 3 — Enable from GALOIR Admin
1. Sign into `https://app.galoir.com` with an Admin account.
2. Open **Capacity Settings → WhatsApp Business Notifications · WATI**.
3. Click **Check API Setup** and confirm credentials are detected.
4. Tick the confirmation that both WATI Utility templates are approved and the sending number verified.
5. Click **Enable WhatsApp Automation**.

Messages are queued after:
- **Billing completed:** Only if the cashier recorded Amount Paid and ticked customer WhatsApp opt-in.
- **CRM Ready:** When an outfit is first marked Ready by barcode scan, the Ready checkbox, or the tailoring status. Only billed, opted-in slips qualify.

The queue prevents duplicate messages for the same slip and event. Failed transmissions are logged; **do not blindly retry** because a WATI timeout may have been accepted.
The Settings notification log shows **Submitted/Accepted by WATI**, not proof of delivery; check WATI's dashboard for delivered/read receipts.

## 4 — Test safely
Use a fresh test order with your own opted-in test number after approved templates and credentials are configured.
Test amounts, one Ready scan, duplicate scan, and WATI delivery status. Do not use a real customer's number for testing.

## References
- WATI API overview: https://support.wati.io/en/articles/11462487-wati-apis-overview
- WATI v3 template messages: https://docs.wati.io/reference/messagetemplate_sendtemplatemessages
- WATI template approval: https://support.wati.io/en/articles/11463495-how-to-create-and-submit-template-messages
