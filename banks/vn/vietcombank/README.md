# Vietcombank Vietnam: Experimental Adapter

## Scope

Scope: Vietcombank Vietnam (VCB Digibank) outgoing domestic VND bank account transfers, including intra-bank and NAPAS 247 domestic transfers.
Input is the JSON receipt or transaction detail payload loaded by the VCB Digibank mobile or web banking interface, plus an explicitly selected transaction identifier.
The pure transformer function `interpretVietcombank` resides in `transformer.js`.
The helper `matchPayment` verifies its output against expected settlement parameters.

## Semantics

1. Payer: Full Vietcombank account number (10 to 13 digits) or customer identifier. Masked values fail closed.
2. Payee: Full destination domestic bank account number (Vietcombank or other Vietnamese bank via NAPAS 247). Masked values fail closed.
3. Amount: Whole Vietnamese dong (VND) without minor units (exponent 0, 1 VND equals 1 unit) represented as a positive integer string using integer arithmetic. Fractional amounts fail closed.
4. Currency: VND (ISO 4217 code VND or numeric 704). Any conflicting currency fails closed.
5. Status: Bank-reported final execution (SUCCESS, COMPLETED, THANH_CONG). Pending and failed transfers fail closed.
6. Time: Explicit ISO 8601 UTC timestamp ending in Z.
7. Transaction ID: Unique transaction reference number (ma giao dich) assigned by Vietcombank.
8. Unsupported categories: Utility bill payments, mobile phone top-ups, QR merchant payments, international wires, fixed deposits, and incoming credits.

## Local acquisition

1. The account owner signs into the VCB Digibank mobile app or web banking portal.
2. The owner inspects the transaction detail receipt for the completed outgoing transfer.
3. The response JSON is extracted into local memory without committing private credentials.
4. Run `npm run try:bank -- vn/vietcombank .local/vietcombank-sample.json <transactionId>` to inspect output.
5. The sample payload is securely purged from local memory following verification.
