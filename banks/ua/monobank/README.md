# Monobank Ukraine: Experimental Adapter

## Scope

Scope: Monobank Ukraine outgoing domestic UAH transfers via IBAN and card-to-card payment rails.
Input is the JSON statement envelope or transaction receipt loaded by the Monobank mobile application or official personal API, plus an explicitly selected transaction identifier.
The pure transformer function `interpretMonobank` resides in `transformer.js`.
The helper `matchPayment` verifies its output against expected settlement parameters.

## Semantics

1. Payer: Full Ukrainian IBAN (29 characters starting with UA) or client account identifier. Masked values fail closed.
2. Payee: Full destination Ukrainian IBAN (29 characters) or destination card identifier (16 numeric digits). Masked values fail closed.
3. Amount: Absolute non-negative integer minor units (kopecks, 100 kopecks per UAH) parsed from signed debits or decimal amounts using integer arithmetic.
4. Currency: UAH (ISO 4217 code UAH or numeric 980). Any other currency fails closed.
5. Status: Bank-reported final execution. Holds (`hold: true`), pending execution, reversals, and failures fail closed.
6. Time: Explicit ISO 8601 UTC timestamp ending in Z.
7. Transaction ID: Unique transaction or receipt identifier assigned by Monobank.
8. Unsupported categories: Merchant POS purchases, utility payments, mobile top-ups, foreign exchange, cash withdrawals, and incoming credits.

## Local acquisition

1. The account owner signs into the Monobank application or uses an authorized personal API token in local memory.
2. The owner inspects the transaction statement or receipt detail for the completed outgoing domestic transfer.
3. The response JSON is extracted into local memory without committing private credentials.
4. Run `npm run try:bank -- ua/monobank .local/monobank-sample.json <transactionId>` to inspect output.
5. The sample payload is securely purged from local memory following verification.
