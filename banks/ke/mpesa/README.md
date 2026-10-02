# Safaricom M-Pesa

## Scope

Scope: Safaricom M-Pesa (M-Pesa App / Statement confirmation) outgoing KES Send Money person to person transfers. Input is the JSON response envelope or transaction receipt payload containing transfer details, plus an explicit transaction ID. The pure function `interpretMpesa` is in `transformer.js` (typechecked via TypeScript JSDoc). `matchPayment` compares its output against exact payer, payee, amount and currency claims.

## Semantics

1. Payer: Full Kenyan phone number in international or domestic format normalized to E.164 MSISDN (`+254...`) under scheme `ke-msisdn`. Masked values fail closed.
2. Payee: Full destination Kenyan phone number normalized to E.164 MSISDN (`+254...`) under scheme `ke-msisdn`. Masked values fail closed.
3. Amount: KES decimal string or number converted to integer minor units (cents, exponent 2: 1 KES = 100 cents) using `BigInt` fixed-point arithmetic without floating-point math. Rejects excessive precision (> 2 decimal places), negative, or zero amounts.
4. Currency: `KES` only. Missing or conflicting currency fails closed.
5. Status: Only explicit final bank-reported completed statuses (`COMPLETED`, `SUCCESS`, `SUCCESSFUL`). Pending (`PENDING`, `PROCESSING`) or failed statuses fail closed.
6. Time: Explicit UTC ISO-8601 string ending with `Z` (`completedAt` or `timestamp`). Must pass strict calendar date sanity checks.
7. ID: Selected Safaricom 10-character alphanumeric transaction receipt code. Memos and display text are untrusted.

Unsupported: Lipa na M-Pesa (Buy Goods / Paybill), Fuliza overdraft loans, airtime purchases, incoming received transfers, and transaction reversals. Missing or ambiguous facts return `insufficient_evidence`.

## Local acquisition

1. The account owner signs in normally into the M-Pesa App or web statement portal.
2. Navigate to Transaction History and locate an existing outgoing Send Money transfer receipt. Do not initiate new payments.
3. Using authorized device inspection or statement export, save the receipt JSON payload to `.local/mpesa-receipt.json`.
4. Run the parser locally: `npm run try:bank -- ke/mpesa .local/mpesa-receipt.json <transactionId>` and verify that output matches the network receipt.
