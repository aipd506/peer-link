# Bancolombia (co/bancolombia)

## Scope

1. Surface: Bancolombia web banking movement receipt (web-banking-receipt).
2. Capability: Interpret outgoing domestic COP transfers between Bancolombia accounts as sender bank reported debits.
3. Transaction selection: Matches on transaction reference ID or voucher number across transaction list or detail payload.

## Semantics

1. Payer: Source Bancolombia account number (11 digits, scheme bancolombia-account-number).
2. Payee: Destination Bancolombia account number (11 digits, scheme bancolombia-account-number).
3. Amount: COP whole peso integer representation without fractional centavos (currencyExponent: 0).
4. Currency: ISO 4217 code COP. Conflicting currencies return insufficient_evidence.
5. Status: Completed statuses (COMPLETED, EXITOSA, SUCCESS, APROBADA) yield supported. Pending statuses (PENDING, EN_PROCESO, PROGRAMADA, EN_TRAMITE) and failed statuses yield insufficient_evidence.
6. Time: ISO 8601 UTC timestamp converted from Colombian local time (COT, UTC-5) or UTC string.
7. ID: Unique voucher code or transaction reference. Memos, descriptions, and user notes are unauthenticated and excluded from evidence claims.

## Unsupported

1. Transfiya fast payment rails.
2. Interbank ACH transfers to other Colombian financial entities.
3. International wire transfers.
4. QR code and merchant gateway payments.
5. Direct debits and recurring utility payments.
6. Incoming credit confirmations.
7. Recipient credit confirmation.
8. Cryptographic source authentication.

## Local acquisition

1. The account owner signs in normally (including MFA) in their own browser session.
2. Navigate to Transferencias or Movimientos and locate an existing completed Bancolombia transfer. Do not create new payments.
3. Inspect network payloads or export movement JSON into .local/bancolombia.json.
4. Run npm run try:bank with co/bancolombia, your local capture, and the target reference ID.
5. Verify the sanitized output matches the bank receipt. Publish only a report, never raw credentials or payloads.

## Validation

1. Synthetic fixtures cover completed transfers, pending processing, failed executions, and formatted amount representations.
2. Negative unit tests check invalid currency, missing account numbers, negative amounts, status variations, and missing identifiers.
