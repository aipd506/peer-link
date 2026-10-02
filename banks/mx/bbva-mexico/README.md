# BBVA Mexico

## Scope

1. Single supported bank surface: BBVA Mexico mobile app receipt and transfer detail view.
2. Single supported payment type: outgoing domestic MXN SPEI transfer.
3. Every supported record includes an explicit clave de rastreo tracking key and explicit sender and receiver account or CLABE identifiers.

## Semantics

1. Payer: sending account number or 18 digit CLABE identifier. Scheme is mx-clabe when 18 digits or bbva-account-number. Display names are ignored.
2. Payee: destination account number or 18 digit CLABE identifier. Scheme is mx-clabe when 18 digits or mx-bank-account. Masked values are rejected.
3. Amount: parsed from decimal string or numeric value into minor integer units in centavos with exponent 2. Floating point multiplication is avoided.
4. Currency: MXN ISO 4217 currency with minor exponent 2. Any differing or missing currency causes rejection.
5. Status: bank reported terminal completed status: COMPLETED, EXITOSO, or LIQUIDADO. Pending, failed, and reversed states abstain.
6. Time: explicit UTC ISO 8601 timestamp ending in Z.
7. Tracking reference: SPEI clave de rastreo is validated and extracted into observation limitations and available as transaction selection identifier.
8. Unsupported scopes: incoming credits, internal transfers lacking clave de rastreo, card payments, cash withdrawals, and utility payments.

## Local acquisition

1. The account owner signs in to the authorized BBVA Mexico mobile banking session.
2. Navigate to account activity and open the transfer receipt for an existing completed SPEI payment.
3. Inspect the JSON payload or receipt detail via developer inspection proxy and save to .local/bbva-mexico-response.json.
4. Run npm run try:bank mx/bbva-mexico .local/bbva-mexico-response.json <transactionId> to view the redacted summary.
5. Verify that the output matches the mobile receipt and write a live report. Never commit the raw response payload.

## Validation

1. Synthetic fixtures cover completed transfer, pending state, failed state, and unsupported transaction type.
2. Unit tests verify full branch and line coverage across all error paths and property boundaries.
