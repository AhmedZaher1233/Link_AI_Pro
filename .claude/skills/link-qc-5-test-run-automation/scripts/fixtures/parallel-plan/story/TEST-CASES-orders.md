# Test Cases — orders

**Status:** APPROVED
**Feature:** orders

## Test cases

### TC-01 — Create an order with valid data
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-ORD-01
- **Stage:** @positive
- **Preconditions:**
  1. Open the portal [E1]
- **Steps:**
  1. Login as Administrator [A1]
  2. Click on New order
  3. Enter a unique order name
  4. Click on Save
  5. Check that the new order is listed
- **Expected Result:** The new order is saved and appears in the orders list.
- **Data Oracle:** —
- **Smoke:** YES
- **Automation Candidate:** YES
- **Data effect:** creates
- **Shared data:** —
- **Tags:** —
- **Validation:** draft — not app-validated

### TC-02 — View the Sample price list
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-ORD-01
- **Stage:** @positive
- **Preconditions:**
  1. The price list "Sample" [D1] exists with its 12 products
- **Steps:**
  1. Login as Administrator [A1]
  2. Open the price list "Sample" [D1]
  3. Check the product count
- **Expected Result:** The price list shows its 12 products.
- **Data Oracle:** price list "Sample" [D1] — expected count: 12
- **Smoke:** NO
- **Automation Candidate:** YES
- **Data effect:** read-only
- **Shared data:** —
- **Tags:** —
- **Validation:** draft — not app-validated

### TC-03 — Check the help page
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-ORD-01
- **Stage:** @positive
- **Preconditions:**
  1. Open the portal [E1]
- **Steps:**
  1. Login as Administrator [A1]
  2. Open Help
  3. Check the version label
- **Expected Result:** The help page shows the version label.
- **Data Oracle:** —
- **Smoke:** NO
- **Automation Candidate:** YES
- **Data effect:** read-only
- **Shared data:** —
- **Tags:** —
- **Validation:** draft — not app-validated

### TC-04 — Check the order count on the dashboard
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-ORD-04
- **Stage:** @positive
- **Preconditions:**
  1. Open the portal [E1]
- **Steps:**
  1. Login as Administrator [A1]
  2. Open Dashboard
  3. Check the order count
- **Expected Result:** The order count matches the number of orders in the orders list.
- **Data Oracle:** order count matches the orders list
- **Smoke:** NO
- **Automation Candidate:** YES
- **Data effect:** read-only
- **Shared data:** —
- **Tags:** —
- **Validation:** draft — not app-validated

### TC-05 — Check the About dialog
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-ORD-01
- **Stage:** @positive
- **Preconditions:**
  1. Open the portal [E1]
- **Steps:**
  1. Login as Administrator [A1]
  2. Open About
  3. Check the product name
- **Expected Result:** The About dialog shows the product name.
- **Data Oracle:** —
- **Smoke:** NO
- **Automation Candidate:** YES
- **Data effect:** read-only
- **Shared data:** —
- **Tags:** —
- **Validation:** draft — not app-validated

### TC-06 — Check the latest audit entry for orders
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-ORD-01
- **Stage:** @positive
- **Preconditions:**
  1. Open the portal [E1]
- **Steps:**
  1. Login as Administrator [A1]
  2. Open Audit log
  3. Search for the latest order entry
  4. Check the latest entry
- **Expected Result:** The latest entry names the order that was created last.
- **Data Oracle:** —
- **Smoke:** NO
- **Automation Candidate:** YES
- **Data effect:** read-only
- **Shared data:** —
- **Tags:** —
- **Validation:** draft — not app-validated

### TC-10 — Create the lifecycle order
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-ORD-02
- **Stage:** @positive
- **Preconditions:**
  1. Open the portal [E1]
- **Steps:**
  1. Login as Administrator [A1]
  2. Click on New order
  3. Enter the lifecycle order name
  4. Click on Save
- **Expected Result:** The lifecycle order is saved.
- **Data Oracle:** —
- **Smoke:** NO
- **Automation Candidate:** YES
- **Data effect:** creates
- **Shared data:** —
- **Tags:** —
- **Validation:** draft — not app-validated

### TC-11 — Change the lifecycle order quantity
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-ORD-02
- **Stage:** @positive
- **Preconditions:**
  1. The lifecycle order created by TC-10 exists
- **Steps:**
  1. Login as Administrator [A1]
  2. Open the lifecycle order
  3. Change the quantity to 3
  4. Click on Save
- **Expected Result:** The lifecycle order shows quantity 3.
- **Data Oracle:** —
- **Smoke:** NO
- **Automation Candidate:** YES
- **Data effect:** modifies
- **Shared data:** lifecycle order (depends on TC-10)
- **Tags:** —
- **Validation:** draft — not app-validated

### TC-12 — Delete the lifecycle order
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-ORD-02
- **Stage:** @positive
- **Preconditions:**
  1. The lifecycle order changed by TC-11 exists
- **Steps:**
  1. Login as Administrator [A1]
  2. Open the lifecycle order
  3. Delete the lifecycle order
  4. Check that the order is gone
- **Expected Result:** The lifecycle order is no longer listed.
- **Data Oracle:** —
- **Smoke:** NO
- **Automation Candidate:** YES
- **Data effect:** deletes
- **Shared data:** lifecycle order (depends on TC-11)
- **Tags:** —
- **Validation:** draft — not app-validated

### TC-20 — Check the shared order customer
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-ORD-03
- **Stage:** @positive
- **Preconditions:**
  1. The shared order [D2] exists
- **Steps:**
  1. Login as Administrator [A1]
  2. Open the shared order
  3. Check the customer
- **Expected Result:** The shared order shows its customer.
- **Data Oracle:** —
- **Smoke:** NO
- **Automation Candidate:** YES
- **Data effect:** read-only
- **Shared data:** shared order [D2]
- **Tags:** —
- **Validation:** draft — not app-validated

### TC-21 — Check the shared order state
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-ORD-03
- **Stage:** @positive
- **Preconditions:**
  1. The shared order [D2] exists
- **Steps:**
  1. Login as Administrator [A1]
  2. Open the shared order
  3. Check the order status
- **Expected Result:** The shared order shows the status "Open".
- **Data Oracle:** —
- **Smoke:** NO
- **Automation Candidate:** YES
- **Data effect:** read-only
- **Shared data:** shared order [D2]
- **Tags:** —
- **Validation:** draft — not app-validated

### TC-30 — Approve a seeded order
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-ORD-05
- **Stage:** @positive
- **Preconditions:**
  1. Open the portal [E1]
- **Steps:**
  1. Login as Administrator [A1]
  2. Open the seeded order
  3. Approve the seeded order
  4. Check that the order status is "Approved"
- **Expected Result:** The seeded order shows the status "Approved".
- **Data Oracle:** —
- **Smoke:** NO
- **Automation Candidate:** YES
- **Data effect:** modifies
- **Shared data:** —
- **Tags:** —
- **Validation:** draft — not app-validated

### TC-31 — Run the clean-up job
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-ORD-05
- **Stage:** @positive
- **Preconditions:**
  1. Open the portal [E1]
- **Steps:**
  1. Login as Administrator [A1]
  2. Open Maintenance
  3. Click on Run clean-up
  4. Check the confirmation message
- **Expected Result:** A confirmation message is shown.
- **Data Oracle:** —
- **Smoke:** NO
- **Automation Candidate:** YES
- **Data effect:** modifies
- **Shared data:** —
- **Tags:** —
- **Validation:** draft — not app-validated

### TC-32 — Check the layout variants
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-ORD-05
- **Stage:** @positive
- **Preconditions:**
  1. Open the portal [E1]
- **Steps:**
  1. Login as Administrator [A1]
  2. Open the Orders screen
  3. Switch the layout to compact and to wide
  4. Check the layout
- **Expected Result:** Each layout variant is shown.
- **Data Oracle:** —
- **Smoke:** NO
- **Automation Candidate:** YES
- **Data effect:** read-only
- **Shared data:** —
- **Tags:** —
- **Validation:** draft — not app-validated

### TC-33 — Change the date format setting
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-ORD-05
- **Stage:** @positive
- **Preconditions:**
  1. Open the portal [E1]
- **Steps:**
  1. Login as Administrator [A1]
  2. Open System settings
  3. Change the date format to "YYYY-MM-DD"
  4. Click on Save
  5. Check the confirmation message
- **Expected Result:** The date format setting is saved.
- **Data Oracle:** —
- **Smoke:** NO
- **Automation Candidate:** YES
- **Data effect:** modifies
- **Shared data:** —
- **Tags:** —
- **Validation:** draft — not app-validated

### TC-34 — Reject a wrong password for the Approver
- **Type:** negative
- **Locale:** en
- **Requirement:** REQ-ORD-05
- **Stage:** @negative
- **Preconditions:**
  1. Open the portal [E1]
- **Steps:**
  1. Open the portal [E1]
  2. Login as Approver [A2] with a wrong password
  3. Check the error message
- **Expected Result:** An error message is shown and the Approver stays signed out.
- **Data Oracle:** —
- **Smoke:** NO
- **Automation Candidate:** YES
- **Data effect:** —
- **Shared data:** —
- **Tags:** —
- **Validation:** draft — not app-validated

### TC-35 — Check the Approver dashboard
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-ORD-05
- **Stage:** @positive
- **Preconditions:**
  1. Open the portal [E1]
- **Steps:**
  1. Login as Approver [A2]
  2. Open Dashboard
  3. Check the welcome message
- **Expected Result:** The Approver dashboard shows the welcome message.
- **Data Oracle:** —
- **Smoke:** NO
- **Automation Candidate:** YES
- **Data effect:** read-only
- **Shared data:** —
- **Tags:** —
- **Validation:** draft — not app-validated

### TC-40 — Check the catalog name
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-CAT-01
- **Stage:** @positive
- **Preconditions:**
  1. Open the portal [E1]
- **Steps:**
  1. Login as Administrator [A1]
  2. Open the catalog
  3. Check the catalog name
- **Expected Result:** The catalog shows its name.
- **Data Oracle:** —
- **Smoke:** NO
- **Automation Candidate:** YES
- **Data effect:** read-only
- **Shared data:** —
- **Tags:** —
- **Validation:** draft — not app-validated

### TC-41 — Check the catalog currency
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-CAT-01
- **Stage:** @positive
- **Preconditions:**
  1. Open the portal [E1]
- **Steps:**
  1. Login as Administrator [A1]
  2. Open the catalog
  3. Check the catalog currency
- **Expected Result:** The catalog shows its currency.
- **Data Oracle:** —
- **Smoke:** NO
- **Automation Candidate:** YES
- **Data effect:** read-only
- **Shared data:** —
- **Tags:** —
- **Validation:** draft — not app-validated

### TC-50 — Check the printed invoice layout
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-ORD-06
- **Stage:** @positive
- **Preconditions:**
  1. Open the portal [E1]
- **Steps:**
  1. Login as Administrator [A1]
  2. Print an invoice
  3. [HUMAN] Check the printed page
- **Expected Result:** The printed page shows the invoice layout.
- **Data Oracle:** —
- **Smoke:** NO
- **Automation Candidate:** NO
- **Data effect:** read-only
- **Shared data:** —
- **Tags:** —
- **Validation:** draft — not app-validated
