# Test Cases — layers
**Status:** APPROVED
**Scope:** Fixture TC document for the layer cases of the validator, check and run-data harnesses.
**Generated:** 2026-10-27
**Test layers:** ui, api, db, hybrid

## Test Cases

### TC-01 — Create an order through the API
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-014
- **Stage:** @positive
- **Preconditions:**
  1. Account Administrator [A1] exists.
- **Steps:**
  1. [API] POST [E2] /api/orders as [A1] with {"name": "A-1"} → capture body.id as $order
- **Expected Result:**
  - [API] status 201
  - [API] body.id = $order
- **Data effect:** creates
- **Shared data:** —
- **Validation:** draft — not app-validated

### TC-02 — The created order is stored
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-014
- **Stage:** @positive
- **Steps:**
  1. [API] POST [E2] /api/orders as [A1] with {"name": "A-2"} → capture body.id as $order
- **Expected Result:**
  - [API] status 201
  - [DB] Check that the order record where id = $order has status = "Pending"
- **Data effect:** creates
- **Shared data:** —
- **Validation:** draft — not app-validated

### TC-03 — The order status is stored
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-014
- **Stage:** @positive
- **Steps:**
  1. [DB] Create the order record "A-3"
- **Expected Result:**
  - [DB] Check that the order record where name = "A-3" has status = "Pending"
- **Data effect:** creates
- **Shared data:** —
- **Validation:** draft — not app-validated

### TC-04 — An order saved in the UI is stored
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-014
- **Stage:** @positive
- **Steps:**
  1. Open Orders and save the order "A-4" — the list shows it.
- **Expected Result:** The order "A-4" is listed.
  - [DB] Check that the order record where name = "A-4" has status = "Pending"
- **Data effect:** creates
- **Shared data:** —
- **Validation:** draft — not app-validated

### TC-05 — The orders list opens
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-014
- **Stage:** @positive
- **Steps:**
  1. Open Orders — the list is visible.
- **Expected Result:** The orders list is visible.
- **Data effect:** read-only
- **Shared data:** —
- **Validation:** draft — not app-validated

### TC-06 — The list shows a created order
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-014
- **Stage:** @positive
- **Steps:**
  1. Open Orders — the order "A-1" is listed.
- **Expected Result:** The order "A-1" is listed.
- **Data effect:** read-only
- **Shared data:** —
- **Validation:** draft — not app-validated
