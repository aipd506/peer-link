# bKash Bangladesh: Experimental Adapter

## Scope

Scope: bKash Bangladesh outgoing domestic BDT Send Money transfers (peer-to-peer mobile wallet transfers).
Input is the JSON statement envelope or transaction receipt loaded by the bKash mobile application or transaction statement surface, plus an explicitly selected transaction identifier.
The pure transformer function `interpretBkash` resides in `transformer.js`.
The helper `matchPayment` verifies its output against expected settlement parameters.

## Semantics

1. Payer: Full Bangladeshi mobile telephone number (E.164 format +8801XXXXXXXXX) identifying the sending wallet account. Masked values fail closed.
2. Payee: Full destination Bangladeshi mobile telephone number (E.164 format +8801XXXXXXXXX). Masked values fail closed.
3. Amount: Absolute non-negative integer minor units (poisha, 100 poisha per BDT) parsed from signed debits or decimal amounts using integer arithmetic.
4. Currency: BDT (ISO 4217 code BDT or numeric 050). Conflicting currency fails closed.
5. Status: Bank-reported final execution (COMPLETED, SUCCESS, SUCCESSFUL). Pending and failed transfers fail closed.
6. Time: Explicit ISO 8601 UTC timestamp ending in Z.
7. Transaction ID: Unique bKash transaction identifier (TrxID) assigned by bKash.
8. Unsupported categories: Cash Out withdrawals, merchant payments, mobile recharge, utility bill payments, add money from bank, and incoming credits.

## Local acquisition

1. The account owner signs into the bKash mobile app or transaction history portal.
2. The owner inspects the transaction statement or receipt detail for the completed outgoing Send Money transfer.
3. The response JSON is extracted into local memory without committing private credentials.
4. Run `npm run try:bank -- bd/bkash .local/bkash-sample.json <transactionId>` to inspect output.
5. The sample payload is securely purged from local memory following verification.
