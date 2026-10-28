# GALOIR — Importing Pending Orders from Manual Booklets

## Where to start
Open **https://app.galoir.com** as **Admin or Manager**.
On the Dashboard, choose **📖 + Import Manual Order**, or open **Manual Booklet Orders** in the left menu.

Sales and Tailoring accounts cannot import or change existing booklet records.

## Import one old order
1. Enter the **booklet/register name** (example: `Book 3 — Oct 2026`).
2. Enter the **original handwritten slip number** (example: `4852`).
3. Enter the **existing POS bill number**. **Do not create a second bill.**
4. Enter the customer phone and name (name is required only if the phone has no existing GALOIR customer).
5. Enter the actual old order date, **promised delivery date**, order type, preparation days and current work status.
6. Optional: enter the original total and amount paid. Leave **both blank** if payment records are unknown. Do not assume paid is ₹0.
7. **Photograph the original measurement-book page.** Cover any handwritten customer phone numbers or other unnecessary personal details before taking the picture, because the page may also be shown on the tailor's printout.
8. Tick **Enter digital measurements later** if transcribing will be done separately.
9. Press **Import Old Order & Assign GL Barcode**.

The app assigns a new **GL slip number** but preserves the old booklet number and existing bill number. The imported order is **already billed** in the measurement system: the Billing Desk does not charge it again.

The combination of **booklet name + old slip number** must be unique. If two booklets use the same slip number, give them different booklet names. Multiple articles can legitimately share one POS bill number.

## Track imported orders
- Existing pending orders appear in **Deliver Today**, **Send to Master Room**, the calendar and the relevant daily/tailoring lists. Historical overdue dates are allowed.
- Current status can be Pending, Sent to Master Room, Stitching, Alteration, Trial, Ready, or Delivered.
- The import intentionally bypasses current capacity and preparation-date restrictions because the commitment was already made manually. It still counts toward the workload.
- Search by **GL number, original manual slip number, original bill number or customer phone**.
- Open **Manual Booklet Orders** to filter imports, see how many need photos/transcription, view full handwritten pages and print a new GL barcode slip.

## Enter missing digital measurements later
Select **Edit / Attach Photo** for any imported order, enter the measurements, add a photo or adjust fitting notes, then untick **Still needs full digital measurements** when transcribing is complete.

Editing measurements does not change the original invoice, promised delivery date or payment values.

## WhatsApp behavior
- Imports **never** trigger retroactive **Order Finalised** messages.
- A Ready-for-Collection update can be sent *later* only if the customer expressly opted in, the outfit transitions to Ready, and Admin has enabled the WATI integration.
- Importing an outfit already marked Ready does **not** send a retroactive notification.
- At implementation, GALOIR's WATI automation is **OFF**.

## Recommended sequence
1. Transfer orders **due in the next 7–14 days first**.
2. Enter all other outstanding orders.
3. Have the tailoring team progressively transcribe measurements and attach any missing old pages.
4. Reconcile each digital GL slip to its original booklet reference and POS invoice.

Bulk Excel/CSV import is **not included** in this initial module; this screen supports one order at a time, avoiding silent duplicate imports.
