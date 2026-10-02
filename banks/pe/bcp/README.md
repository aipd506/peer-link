# Banco de Credito del Peru (pe/bcp)

## Scope

1. Surface: Banco de Credito del Peru web banking transfer receipt (web-banking-receipt).
2. Capability: Interpret outgoing domestic PEN transfers between BCP accounts or interbank CCI destinations as sender bank reported debits.
3. Transaction selection: Matches on transaction operation number or unique movement ID across transaction list or receipt envelope.

## Semantics

1. Payer: Source BCP account number (14 digits, scheme bcp-account-number) or interbank CCI (20 digits, scheme pe-cci).
2. Payee: Destination BCP account number (14 digits, scheme bcp-account-number) or interbank CCI (20 digits, scheme pe-cci).
3. Amount: PEN céntimos decimal string converted to integer minor units (currencyExponent: 2).
4. Currency: ISO 4217 code PEN. Conflicting currencies return insufficient_evidence.
5. Status: Completed statuses (COMPLETED, REALIZADA, SUCCESS, EXITOSA) yield supported. Pending statuses (PENDING, EN_PROCESO, PROGRAMADA, EN_CURSO) and failed statuses yield insufficient_evidence.
6. Time: ISO 8601 UTC timestamp converted from Peru local time (PET, UTC-5) or UTC string.
7. ID: Unique operation number or transaction reference. Memos, descriptions, and user notes are unauthenticated and excluded from evidence claims.

## Unsupported

1. Yape mobile wallet P2P payments.
2. International wire transfers and foreign exchange operations.
3. Service and utility bill payments.
4. Credit and debit card payment settlements.
5. Incoming credit confirmations.
6. Recipient credit confirmation.
7. Cryptographic source authentication.

## Local acquisition

1. The account owner signs in normally (including MFA) in their own browser session.
2. Navigate to Transferencias or Movimientos and locate an existing completed BCP transfer. Do not create new payments.
3. Inspect network payloads or export movement JSON into .local/bcp.json.
4. Run npm run try:bank with pe/bcp, your local capture, and the target operation number.
5. Verify the sanitized output matches the bank receipt. Publish only a report, never raw credentials or payloads.

## Validation

1. Synthetic fixtures cover completed BCP transfers, interbank CCI transfers, pending processing, and failed executions.
2. Negative unit tests check invalid currency, missing account numbers, negative amounts, status variations, and missing identifiers.
