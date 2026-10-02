# Bank of America

## Scope

Scope: Bank of America (BofA Online / Mobile Banking) outgoing domestic USD transfers. Input is the JSON response envelope or transaction detail payload containing transfer details, plus an explicit transaction ID. The pure function `interpretBofa` is in `transformer.js` (typechecked via TypeScript JSDoc). `matchPayment` compares its output against exact payer, payee, amount and currency claims.

## Semantics

1. Payer: Full Bank of America checking or savings account number (`bofa-account-number`) or account identifier. Masked values fail closed.
2. Payee: Full destination US routing number (9 digits) and account number (4 to 17 digits) under scheme `us-routing-account`. Masked values fail closed.
3. Amount: USD decimal string or number converted to integer minor units (cents, exponent 2: 1 USD = 100 cents) using `BigInt` fixed-point arithmetic without floating-point math. Rejects excessive precision (> 2 decimal places), negative, or zero amounts.
4. Currency: `USD` only. Missing or conflicting currency fails closed.
5. Status: Only explicit final bank-reported completed statuses (`COMPLETED`, `POSTED`, `PROCESSED`). Pending (`PENDING`, `PROCESSING`, `SCHEDULED`, `IN_PROGRESS`) or failed statuses fail closed.
6. Time: Explicit UTC ISO-8601 string ending with `Z` (`postedAt` or `timestamp`). Must pass strict calendar date sanity checks.
7. ID: Selected Bank of America transaction or confirmation ID. Memos and display text are untrusted.

Unsupported: Zelle transfers, wire transfers, debit card purchases, bill payments, incoming credits, and check deposits. Missing or ambiguous facts return `insufficient_evidence`.

## Local acquisition

1. The account owner signs in normally into Bank of America Online Banking.
2. Navigate to Transfer Activity and locate an existing outgoing domestic transfer. Do not initiate new payments.
3. Using authorized browser developer tools, save the transaction transfer response payload to `.local/bofa-transfer.json`.
4. Run the parser locally: `npm run try:bank -- us/bofa .local/bofa-transfer.json <transactionId>` and verify that output matches the bank record.
