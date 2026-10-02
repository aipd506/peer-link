# MTN MoMo Ghana (experimental)

## Scope

MTN MoMo Ghana mobile application or web receipt for completed outgoing domestic GHS transfers between mobile money wallets. Input is the JSON transaction payload loaded by the client or statement view, along with an explicit transaction identifier. The pure function interpretMtn resides in transformer.js.

## Semantics

1. Payer: Full Ghana mobile station international subscriber directory number (MSISDN) formatted as 10 digits starting with 0 (for example 0240000001) or 12 digits international format starting with 233. Scheme is gh-msisdn. Masked values fail closed.
2. Payee: Full recipient Ghana mobile number formatted as 10 digits starting with 0 or 12 digits international format. Scheme is gh-msisdn. Masked values fail closed.
3. Amount: Ghanaian Cedi decimal string or numeric value converted to integer minor units (Pesewas, exponent 2: 1 GHS equals 100 Pesewas) using BigInt arithmetic without floating point math. Zero or negative amounts fail closed.
4. Currency: GHS only. Missing or conflicting currency fails closed.
5. Status: Only explicit completed bank reported statuses (COMPLETED, SUCCESS, SUCCESSFUL). Pending, failed, or reversed statuses fail closed.
6. Time: Explicit UTC ISO 8601 string ending with Z. Calendar date validity is enforced.
7. ID: Transaction reference identifier scoped to MTN MoMo Ghana. Display names and memos are untrusted data.

Unsupported: Merchant payments, agent cash out, airtime topups, bill payments, bank push or pull transfers, cross border remittances, and incoming credits. Missing or ambiguous facts return insufficient_evidence.

## Local acquisition

1. The account owner signs in normally with multi-factor authentication into the official MTN MoMo Ghana mobile application or web portal.
2. Navigate to Transaction History or Statement Records and open an existing completed outgoing transfer. Do not initiate payments.
3. Inspect the read-only network response or transaction receipt JSON payload using browser developer tools or authorized device proxy.
4. Save the response body to .local/gh-mtn-response.json without modifying headers or credentials.
5. Execute npm run try:bank gh/mtn .local/gh-mtn-response.json <transactionId> to inspect the redacted observation summary.

## Validation

Synthetic fixtures cover completed transfers, pending transfers, failed transfers, and alternative currency formatting with GHS prefixes. Unit tests verify exact minor unit conversion, calendar date validation, mobile number normalization, masked identifier rejection, and untrusted memo handling.
