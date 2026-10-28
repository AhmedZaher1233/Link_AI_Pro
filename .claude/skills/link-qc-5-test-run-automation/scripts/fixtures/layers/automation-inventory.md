# Automation inventory — layers fixture

## API / DB mapping

| Operation | Method | Path | Effect | Evidence |
|---|---|---|---|---|
| search orders | POST | /api/orders/search | read | src/routes/orders.ts:41 (no write in the handler) |
| create order | POST | /api/orders | mutation | src/routes/orders.ts:12 (repository.save) |
| order by id | GET | /api/orders/{id} | read | openapi.yaml#getOrder |
