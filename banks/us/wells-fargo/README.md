# Wells Fargo — experimental

## Scope

Wells Fargo web account activity and transaction detail records for completed outgoing domestic USD wire and ACH transfers.
The caller supplies an activity response envelope and explicitly selects one transaction by its unique identifier.

## Semantics

- **Payer (A)**: Identified by `account.id` (Wells Fargo internal depository account reference, scheme `wells-fargo-account-id`). It represents the sending depository account and is not inferred from a personal display name.
- **Payee (B)**: Identified by `transaction.counterparty.routingNumber` and `transaction.counterparty.accountNumber` (scheme `us-routing-account`, formatted as `<routing>:<account>`). Unmasked full routing and account numbers are required; masked or truncated values fail closed.
- **Amount**: Represented as a positive decimal string in USD. Converted safely via integer arithmetic to minor units (cents, exponent 2).
- **Currency**: Explicitly verified from `currency` field as `USD`. ISO 4217 minor unit exponent is 2.
- **Status**: Bank-reported completed status (`completed` or `POSTED`). Pending, scheduled, failed, reversed, and unknown states return `insufficient_evidence`.
- **Time**: Sourced from `postedAt` as an explicit UTC ISO-8601 string ending in `Z`. Represents the ledger posting timestamp.
- **ID**: Scoped to the Wells Fargo account activity record (`transaction.id`). Cross-bank uniqueness is not assumed.
- **Unsupported**: Incoming transfers, checks, card transactions, international wires, and non-USD currencies remain unsupported. Any ambiguous or incomplete record returns `insufficient_evidence`.

## Local acquisition

1. The authorized account owner authenticates normally to Wells Fargo online banking in their own browser.
2. Navigate to Account Activity / Transaction Details for an existing outgoing domestic wire or ACH transfer.
3. Open Developer Tools (Network tab), filter by Fetch/XHR, and select the transaction activity response payload.
4. Save the JSON payload to `.local/wells-fargo-response.json` (kept strictly local, never committed).
5. Run `npm run try:bank -- us/wells-fargo .local/wells-fargo-response.json <transactionId>` to review the redacted summary against the online banking UI.

## Validation

Covered by synthetic fixtures with independently derived expected outputs:
- `fixtures/completed.synthetic.json`: Standard completed outgoing domestic ACH transfer.
- `fixtures/wire-completed.synthetic.json`: Completed outgoing domestic USD wire transfer.
- `fixtures/pending.synthetic.json`: Pending debit transfer returning insufficient evidence.

Tested via `transformer.test.ts` across positive cases, negative cases (masked identifiers, amount and currency errors, pending/failed/unknown statuses, missing counterparty, invalid routing, duplicate selection, prompt injection memos), and attestation candidate conversion.
