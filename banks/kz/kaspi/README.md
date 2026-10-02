# Kaspi Bank Kazakhstan: Experimental Adapter

## Scope

Scope: Kaspi Bank Kazakhstan outgoing domestic KZT transfers via phone number (Kaspi-to-Kaspi) and card-to-card transfer payment rails.
Input is the JSON statement envelope or transaction receipt loaded by the Kaspi.kz mobile application or web portal, plus an explicitly selected transaction identifier.
The pure transformer function `interpretKaspi` resides in `transformer.js`.
The helper `matchPayment` verifies its output against expected settlement parameters.

## Semantics

1. Payer: Full Kazakhstani mobile phone number (E.164 format +77XXXXXXXXX) or unmasked 16-digit card number. Masked values fail closed.
2. Payee: Full destination Kazakhstani mobile phone number (E.164 format +77XXXXXXXXX) or destination card number. Partial recipient display names without full phone or card numbers fail closed.
3. Amount: Absolute non-negative integer minor units (tiyn, 100 tiyn per KZT) parsed from signed debits or decimal amounts using integer arithmetic.
4. Currency: KZT (ISO 4217 code KZT or numeric 398). Any conflicting currency fails closed.
5. Status: Bank-reported final execution (COMPLETED, SUCCESS, SUCCESSFUL). Pending and failed transfers fail closed.
6. Time: Explicit ISO 8601 UTC timestamp ending in Z.
7. Transaction ID: Unique transaction or receipt identifier assigned by Kaspi.kz.
8. Unsupported categories: Kaspi Red installments, Kaspi Kredit loans, Kaspi Pay merchant QR, utility bills, mobile top-ups, government taxes, and incoming credits.

## Local acquisition

1. The account owner signs into the Kaspi.kz mobile app or web banking portal.
2. The owner inspects the transaction statement or receipt detail for the completed outgoing transfer.
3. The response JSON is extracted into local memory without committing private credentials.
4. Run `npm run try:bank -- kz/kaspi .local/kaspi-sample.json <transactionId>` to inspect output.
5. The sample payload is securely purged from local memory following verification.
