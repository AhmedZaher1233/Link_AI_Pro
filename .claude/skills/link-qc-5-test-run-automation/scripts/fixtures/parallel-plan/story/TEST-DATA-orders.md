# Test Data — orders

## 0. Environment
| ID | What | Value | Status |
|----|------|-------|--------|
| E1 | application base URL | https://app.example.com | READY |

## 1. Accounts
| ID | Role | Username | Status | Note |
|----|------|----------|--------|------|
| A1 | Administrator | admin.user | READY | — |
| A2 | Approver | approver.user | READY | locks after 3 wrong passwords |

## 2. Test data at a glance
| # | Data item (plain name) | Must look like | Status | Used by TCs |
|---|------------------------|----------------|--------|-------------|
| D1 | price list "Sample" | 12 products | READY | TC-02 |
| D2 | shared order | created by the describe's beforeAll | READY | TC-20, TC-21 |
