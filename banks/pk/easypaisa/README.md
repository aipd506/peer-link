# Easypaisa

## Scope

1. Single supported bank surface: Easypaisa mobile application transaction receipt and payment confirmation view.
2. Single supported payment type: outgoing completed PKR money transfer between Easypaisa accounts or interbank Raast transfer.
3. Every supported record includes an explicit unmasked mobile number or account identifier and terminal execution status.

## Semantics

1. Payer: sending mobile account number normalized to E.164 (+92...) or account number. Scheme is pk-msisdn or pk-account-number. Masked numbers are rejected.
2. Payee: recipient mobile account number normalized to E.164 (+92...) or account number. Scheme is pk-msisdn or pk-account-number. Masked numbers are rejected.
3. Amount: parsed from decimal string or numeric value into minor integer units in paisas with exponent 2. Floating point multiplication is avoided.
4. Currency: PKR ISO 4217 currency with minor exponent 2. Any differing or missing currency causes rejection.
5. Status: network reported terminal completed status: COMPLETED, SUCCESS, or SUCCESSFUL. Pending, processing, failed, and reversed states abstain.
6. Time: explicit UTC ISO 8601 timestamp ending in Z.
7. Tracking reference: transaction ID or TRX reference number is local to Easypaisa network.
8. Unsupported scopes: incoming credits, mobile load and airtime packages, utility bills, merchant payments, and agent cash withdrawals.

## Local acquisition

1. The account owner signs in to the authorized Easypaisa mobile banking session.
2. Navigate to transaction history and open the receipt for an existing completed money transfer.
3. Inspect the JSON payload or receipt detail via developer inspection proxy and save to .local/easypaisa-response.json.
4. Run npm run try:bank pk/easypaisa .local/easypaisa-response.json <transactionId> to view the redacted summary.
5. Verify that the output matches the mobile receipt and write a live report. Never commit the raw response payload.

## Validation

1. Synthetic fixtures cover completed transfer, pending state, failed state, and unsupported bill payment type.
2. Unit tests verify full branch and line coverage across all error paths and property boundaries.
