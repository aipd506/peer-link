# OPay

## Scope

Scope: OPay Nigeria (OPay App receipt detail) outgoing NGN domestic transfers (wallet to wallet and bank NIP transfers). Input is the JSON response envelope or transaction receipt payload containing transfer details, plus an explicit transaction ID or reference. The pure function `interpretOpay` is in `transformer.js` (typechecked via TypeScript JSDoc). `matchPayment` compares its output against exact payer, payee, amount and currency claims.

## Semantics

1. Payer: Full 10-digit Nigerian NUBAN account number or mobile wallet account normalized to 10 digits under scheme `ng-nuban`. Masked values fail closed.
2. Payee: Full destination 10-digit NUBAN account number, optionally prefixed with destination bank code (for NIP bank transfers), under scheme `ng-nuban`. Masked values fail closed.
3. Amount: NGN decimal string or number converted to integer minor units (kobo, exponent 2: 1 NGN = 100 kobo) using `BigInt` fixed-point arithmetic without floating-point math. Rejects excessive precision (> 2 decimal places), negative, or zero amounts.
4. Currency: `NGN` only. Missing or conflicting currency fails closed.
5. Status: Only explicit final bank-reported completed statuses (`SUCCESS`, `SUCCESSFUL`, `COMPLETED`). Pending (`PENDING`, `PROCESSING`) or failed statuses fail closed.
6. Time: Explicit UTC ISO-8601 string ending with `Z` (`completedAt`, `timestamp`, or `transferredAt`). Must pass strict calendar date sanity checks.
7. ID: Selected OPay transaction reference or NIBSS session ID. Memos and display text are untrusted.

Unsupported: Airtime top-ups, utility bill payments, betting wallet funding, merchant QR payments, incoming received transfers, and transaction reversals. Missing or ambiguous facts return `insufficient_evidence`.

## Local acquisition

1. The account owner signs in normally into the OPay App or online statement portal.
2. Navigate to Transaction History and locate an existing outgoing domestic transfer receipt. Do not initiate new payments.
3. Using authorized device inspection or statement export, save the receipt JSON payload to `.local/opay-receipt.json`.
4. Run the parser locally: `npm run try:bank -- ng/opay .local/opay-receipt.json <transactionId>` and verify that output matches the network receipt.
