import { describe, expect, it } from "vitest";
import { toAttestationCandidate } from "../../../lib/attestation-candidate";
import { matchPayment } from "../../../lib/match";
import type { PaymentClaim } from "../../../lib/types";
import { interpretBofa } from "./transformer.js";

const VALID_INPUT = {
  account: {
    id: "100000000001",
    accountNumber: "100000000001",
    routingNumber: "122000049",
    name: "Synthetic BofA Account Holder",
  },
  transfers: [
    {
      id: "BOFA-TR-20261002-00001",
      type: "domesticTransfer",
      direction: "debit",
      status: "COMPLETED",
      amount: "450.75",
      currency: "USD",
      postedAt: "2026-10-02T15:45:00Z",
      payer: {
        accountNumber: "100000000001",
        routingNumber: "122000049",
        name: "Synthetic BofA Account Holder",
      },
      payee: {
        accountNumber: "300000000003",
        routingNumber: "021000021",
        name: "Synthetic Counterparty",
      },
      memo: "Synthetic transfer test",
    },
  ],
};

describe("interpretBofa unit and contract coverage", () => {
  it("interprets standard completed transfer correctly", () => {
    const result = interpretBofa(VALID_INPUT, "BOFA-TR-20261002-00001");
    expect(result.outcome).toBe("supported");
    if (result.outcome !== "supported") return;
    expect(result.payment.amountMinor).toBe("45075");
    expect(result.payment.currency).toBe("USD");
    expect(result.payment.status).toBe("COMPLETED");
    expect(result.payment.payer.id).toBe("122000049:100000000001");
    expect(result.payment.payer.scheme).toBe("us-routing-account");
    expect(result.payment.payee.id).toBe("021000021:300000000003");
    expect(result.payment.payee.scheme).toBe("us-routing-account");
    expect(result.payment.timestamp).toBe("2026-10-02T15:45:00Z");
    expect(result.payment.sourceAuthenticated).toBe(false);
    expect(result.payment.limitations.length).toBeGreaterThan(0);
  });

  it("converts supported payment to attestation candidate without errors", () => {
    const result = interpretBofa(VALID_INPUT, "BOFA-TR-20261002-00001");
    expect(result.outcome).toBe("supported");
    if (result.outcome === "supported") {
      const candidate = toAttestationCandidate(result);
      expect(candidate.amount).toBe(45075n);
      expect(candidate.currency).toBe("USD");
    }
  });

  it("verifies matchPayment succeeds on exact matching claim", () => {
    const result = interpretBofa(VALID_INPUT, "BOFA-TR-20261002-00001");
    expect(result.outcome).toBe("supported");
    const claim: PaymentClaim = {
      payerId: "122000049:100000000001",
      payeeId: "021000021:300000000003",
      amountMinor: "45075",
      currency: "USD",
      payerScheme: "us-routing-account",
      payeeScheme: "us-routing-account",
    };
    const match = matchPayment(result, claim);
    expect(match.outcome).toBe("supported");
  });

  it("verifies matchPayment fails on mismatched claim attributes", () => {
    const result = interpretBofa(VALID_INPUT, "BOFA-TR-20261002-00001");
    expect(result.outcome).toBe("supported");
    const wrongAmount: PaymentClaim = {
      payerId: "122000049:100000000001",
      payeeId: "021000021:300000000003",
      amountMinor: "99999",
      currency: "USD",
    };
    const match = matchPayment(result, wrongAmount);
    expect(match.outcome).toBe("contradicted");
  });

  it("supports array input directly", () => {
    const arrayInput = VALID_INPUT.transfers;
    const result = interpretBofa(arrayInput, "BOFA-TR-20261002-00001");
    expect(result.outcome).toBe("supported");
  });

  it("supports root transactions array", () => {
    const txInput = { transactions: VALID_INPUT.transfers };
    const result = interpretBofa(txInput, "BOFA-TR-20261002-00001");
    expect(result.outcome).toBe("supported");
  });

  it("supports root items array", () => {
    const itemsInput = { items: VALID_INPUT.transfers };
    const result = interpretBofa(itemsInput, "BOFA-TR-20261002-00001");
    expect(result.outcome).toBe("supported");
  });

  it("supports root data array", () => {
    const dataInput = { data: VALID_INPUT.transfers };
    const result = interpretBofa(dataInput, "BOFA-TR-20261002-00001");
    expect(result.outcome).toBe("supported");
  });

  it("supports single object root where id matches directly", () => {
    const singleInput = VALID_INPUT.transfers[0];
    const result = interpretBofa(singleInput, "BOFA-TR-20261002-00001");
    expect(result.outcome).toBe("supported");
  });

  it("supports root wrapped transfer object", () => {
    const wrappedInput = { transfer: VALID_INPUT.transfers[0] };
    const result = interpretBofa(wrappedInput, "BOFA-TR-20261002-00001");
    expect(result.outcome).toBe("supported");
  });

  it("supports root wrapped data object", () => {
    const wrappedData = { data: VALID_INPUT.transfers[0] };
    const result = interpretBofa(wrappedData, "BOFA-TR-20261002-00001");
    expect(result.outcome).toBe("supported");
  });

  it("supports numeric amount input", () => {
    const numericInput = structuredClone(VALID_INPUT);
    numericInput.transfers[0].amount = 600.5 as unknown as string;
    const result = interpretBofa(numericInput, "BOFA-TR-20261002-00001");
    expect(result.outcome).toBe("supported");
    if (result.outcome === "supported") {
      expect(result.payment.amountMinor).toBe("60050");
    }
  });

  it("supports integer amount string without decimal point", () => {
    const integerInput = structuredClone(VALID_INPUT);
    integerInput.transfers[0].amount = "250";
    const result = interpretBofa(integerInput, "BOFA-TR-20261002-00001");
    expect(result.outcome).toBe("supported");
    if (result.outcome === "supported") {
      expect(result.payment.amountMinor).toBe("25000");
    }
  });

  it("supports comma formatted amount with USD prefix", () => {
    const formattedInput = structuredClone(VALID_INPUT);
    formattedInput.transfers[0].amount = "USD 1,450.25";
    const result = interpretBofa(formattedInput, "BOFA-TR-20261002-00001");
    expect(result.outcome).toBe("supported");
    if (result.outcome === "supported") {
      expect(result.payment.amountMinor).toBe("145025");
    }
  });

  it("supports payer identifier fallback when payer routing is absent", () => {
    const noPayerRouting = structuredClone(VALID_INPUT);
    delete (noPayerRouting.transfers[0].payer as Record<string, unknown>).routingNumber;
    delete (noPayerRouting.account as Record<string, unknown>).routingNumber;
    const result = interpretBofa(noPayerRouting, "BOFA-TR-20261002-00001");
    expect(result.outcome).toBe("supported");
    if (result.outcome === "supported") {
      expect(result.payment.payer.id).toBe("100000000001");
      expect(result.payment.payer.scheme).toBe("bofa-account-number");
    }
  });

  it("supports fallback to account object when transaction payer is absent", () => {
    const noPayerInTx = structuredClone(VALID_INPUT);
    delete (noPayerInTx.transfers[0] as Record<string, unknown>).payer;
    const result = interpretBofa(noPayerInTx, "BOFA-TR-20261002-00001");
    expect(result.outcome).toBe("supported");
    if (result.outcome === "supported") {
      expect(result.payment.payer.id).toBe("122000049:100000000001");
    }
  });

  it("supports timestamp field fallback when postedAt is absent", () => {
    const timestampFallback = structuredClone(VALID_INPUT);
    delete (timestampFallback.transfers[0] as Record<string, unknown>).postedAt;
    (timestampFallback.transfers[0] as Record<string, unknown>).timestamp = "2026-10-02T15:45:00Z";
    const result = interpretBofa(timestampFallback, "BOFA-TR-20261002-00001");
    expect(result.outcome).toBe("supported");
  });

  it("supports POSTED and PROCESSED statuses", () => {
    for (const status of ["POSTED", "PROCESSED"]) {
      const input = structuredClone(VALID_INPUT);
      input.transfers[0].status = status;
      const result = interpretBofa(input, "BOFA-TR-20261002-00001");
      expect(result.outcome).toBe("supported");
    }
  });

  it("supports alternative transfer type aliases", () => {
    for (const type of ["transfer", "achTransfer", "achDebit"]) {
      const input = structuredClone(VALID_INPUT);
      input.transfers[0].type = type;
      const result = interpretBofa(input, "BOFA-TR-20261002-00001");
      expect(result.outcome).toBe("supported");
    }
  });

  it("supports transferType field alias", () => {
    const aliasInput = structuredClone(VALID_INPUT);
    delete (aliasInput.transfers[0] as Record<string, unknown>).type;
    (aliasInput.transfers[0] as Record<string, unknown>).transferType = "domesticTransfer";
    const result = interpretBofa(aliasInput, "BOFA-TR-20261002-00001");
    expect(result.outcome).toBe("supported");
  });

  it("supports outgoing direction alias", () => {
    const outgoingInput = structuredClone(VALID_INPUT);
    outgoingInput.transfers[0].direction = "outgoing";
    const result = interpretBofa(outgoingInput, "BOFA-TR-20261002-00001");
    expect(result.outcome).toBe("supported");
  });

  it("supports payee id when payee accountNumber is absent", () => {
    const payeeIdInput = structuredClone(VALID_INPUT);
    delete (payeeIdInput.transfers[0].payee as Record<string, unknown>).accountNumber;
    (payeeIdInput.transfers[0].payee as Record<string, unknown>).id = "300000000003";
    const result = interpretBofa(payeeIdInput, "BOFA-TR-20261002-00001");
    expect(result.outcome).toBe("supported");
    if (result.outcome === "supported") {
      expect(result.payment.payee.id).toBe("021000021:300000000003");
    }
  });

  it("supports payer id when payer accountNumber is absent", () => {
    const payerIdInput = structuredClone(VALID_INPUT);
    delete (payerIdInput.transfers[0].payer as Record<string, unknown>).accountNumber;
    (payerIdInput.transfers[0].payer as Record<string, unknown>).id = "100000000001";
    delete (payerIdInput.account as Record<string, unknown>).accountNumber;
    (payerIdInput.account as Record<string, unknown>).id = "100000000001";
    const result = interpretBofa(payerIdInput, "BOFA-TR-20261002-00001");
    expect(result.outcome).toBe("supported");
    if (result.outcome === "supported") {
      expect(result.payment.payer.id).toBe("122000049:100000000001");
    }
  });

  it("rejects when payee routingNumber is absent or non-string", () => {
    const noRouting = structuredClone(VALID_INPUT);
    delete (noRouting.transfers[0].payee as Record<string, unknown>).routingNumber;
    expect(interpretBofa(noRouting, "BOFA-TR-20261002-00001").outcome).toBe(
      "insufficient_evidence",
    );
  });

  it("rejects when payee id and accountNumber are both absent", () => {
    const noPayeeAcc = structuredClone(VALID_INPUT);
    delete (noPayeeAcc.transfers[0].payee as Record<string, unknown>).accountNumber;
    delete (noPayeeAcc.transfers[0].payee as Record<string, unknown>).id;
    expect(interpretBofa(noPayeeAcc, "BOFA-TR-20261002-00001").outcome).toBe(
      "insufficient_evidence",
    );
  });

  it("rejects empty or whitespace transaction ID", () => {
    expect(interpretBofa(VALID_INPUT, "").outcome).toBe("insufficient_evidence");
    expect(interpretBofa(VALID_INPUT, "   ").outcome).toBe("insufficient_evidence");
  });

  it("rejects null or non-object input", () => {
    expect(interpretBofa(null, "BOFA-TR-20261002-00001").outcome).toBe("insufficient_evidence");
    expect(interpretBofa(42, "BOFA-TR-20261002-00001").outcome).toBe("insufficient_evidence");
  });

  it("rejects when transfers list is missing", () => {
    expect(interpretBofa({}, "BOFA-TR-20261002-00001").outcome).toBe("insufficient_evidence");
  });

  it("rejects when transaction ID is not found", () => {
    expect(interpretBofa(VALID_INPUT, "BOFA-MISSING").outcome).toBe("insufficient_evidence");
  });

  it("rejects duplicate transaction IDs in same envelope", () => {
    const dupInput = {
      transfers: [VALID_INPUT.transfers[0], VALID_INPUT.transfers[0]],
    };
    expect(interpretBofa(dupInput, "BOFA-TR-20261002-00001").outcome).toBe("insufficient_evidence");
  });

  it("returns unsupported for wire or zelle transfer types", () => {
    const wireInput = structuredClone(VALID_INPUT);
    wireInput.transfers[0].type = "wireTransfer";
    const result = interpretBofa(wireInput, "BOFA-TR-20261002-00001");
    expect(result.outcome).toBe("unsupported");
  });

  it("returns unsupported for incoming credit transfers", () => {
    const creditInput = structuredClone(VALID_INPUT);
    creditInput.transfers[0].direction = "credit";
    const result = interpretBofa(creditInput, "BOFA-TR-20261002-00001");
    expect(result.outcome).toBe("unsupported");
  });

  it("rejects pending, processing, scheduled, or in-progress status", () => {
    for (const status of ["PENDING", "PROCESSING", "SCHEDULED", "IN_PROGRESS"]) {
      const input = structuredClone(VALID_INPUT);
      input.transfers[0].status = status;
      const result = interpretBofa(input, "BOFA-TR-20261002-00001");
      expect(result.outcome).toBe("insufficient_evidence");
      if (result.outcome === "insufficient_evidence") {
        expect(result.reason).toBe("Transaction is still pending bank execution");
      }
    }
  });

  it("rejects cancelled, failed, returned, or rejected status", () => {
    for (const status of ["CANCELLED", "FAILED", "RETURNED", "REJECTED"]) {
      const input = structuredClone(VALID_INPUT);
      input.transfers[0].status = status;
      const result = interpretBofa(input, "BOFA-TR-20261002-00001");
      expect(result.outcome).toBe("insufficient_evidence");
      if (result.outcome === "insufficient_evidence") {
        expect(result.reason).toBe("Transaction failed or was cancelled");
      }
    }
  });

  it("rejects unknown or invalid status", () => {
    const input = structuredClone(VALID_INPUT);
    input.transfers[0].status = "UNKNOWN_STATUS";
    expect(interpretBofa(input, "BOFA-TR-20261002-00001").outcome).toBe("insufficient_evidence");
  });

  it("rejects non-USD currency", () => {
    const eurInput = structuredClone(VALID_INPUT);
    eurInput.transfers[0].currency = "EUR";
    expect(interpretBofa(eurInput, "BOFA-TR-20261002-00001").outcome).toBe("insufficient_evidence");
  });

  it("rejects invalid amount types and non-positive numbers", () => {
    const invalidTypes = [null, undefined, true, {}, []];
    for (const bad of invalidTypes) {
      const input = structuredClone(VALID_INPUT);
      input.transfers[0].amount = bad as unknown as string;
      expect(interpretBofa(input, "BOFA-TR-20261002-00001").outcome).toBe("insufficient_evidence");
    }
    const nonPositive = [-10, 0, Number.NaN, Number.POSITIVE_INFINITY];
    for (const num of nonPositive) {
      const input = structuredClone(VALID_INPUT);
      input.transfers[0].amount = num as unknown as string;
      expect(interpretBofa(input, "BOFA-TR-20261002-00001").outcome).toBe("insufficient_evidence");
    }
  });

  it("rejects invalid amount strings and precision beyond two decimals", () => {
    const invalidStrings = ["abc", "10.123", "-50.00", "0.00", "1,200", "1.2.3"];
    for (const bad of invalidStrings) {
      const input = structuredClone(VALID_INPUT);
      input.transfers[0].amount = bad;
      expect(interpretBofa(input, "BOFA-TR-20261002-00001").outcome).toBe("insufficient_evidence");
    }
  });

  it("rejects invalid timestamp format or calendar date", () => {
    const badTimestamps = [
      "2026-10-02",
      "not-a-timestamp",
      "2026-10-02T15:45:00+02:00",
      "2026-02-30T15:45:00Z",
    ];
    for (const ts of badTimestamps) {
      const input = structuredClone(VALID_INPUT);
      input.transfers[0].postedAt = ts;
      expect(interpretBofa(input, "BOFA-TR-20261002-00001").outcome).toBe("insufficient_evidence");
    }
  });

  it("rejects masked or missing payer identifier", () => {
    const maskedPayer = structuredClone(VALID_INPUT);
    maskedPayer.transfers[0].payer.accountNumber = "1000000****1";
    delete (maskedPayer.account as Record<string, unknown>).accountNumber;
    expect(interpretBofa(maskedPayer, "BOFA-TR-20261002-00001").outcome).toBe(
      "insufficient_evidence",
    );

    const missingPayer = structuredClone(VALID_INPUT);
    delete (missingPayer.transfers[0].payer as Record<string, unknown>).accountNumber;
    delete (missingPayer.transfers[0].payer as Record<string, unknown>).id;
    delete (missingPayer.account as Record<string, unknown>).accountNumber;
    delete (missingPayer.account as Record<string, unknown>).id;
    expect(interpretBofa(missingPayer, "BOFA-TR-20261002-00001").outcome).toBe(
      "insufficient_evidence",
    );
  });

  it("rejects invalid payee routing or account number", () => {
    const badRouting = structuredClone(VALID_INPUT);
    badRouting.transfers[0].payee.routingNumber = "12345";
    expect(interpretBofa(badRouting, "BOFA-TR-20261002-00001").outcome).toBe(
      "insufficient_evidence",
    );

    const maskedPayee = structuredClone(VALID_INPUT);
    maskedPayee.transfers[0].payee.accountNumber = "3000000****3";
    expect(interpretBofa(maskedPayee, "BOFA-TR-20261002-00001").outcome).toBe(
      "insufficient_evidence",
    );

    const shortPayee = structuredClone(VALID_INPUT);
    shortPayee.transfers[0].payee.accountNumber = "12";
    expect(interpretBofa(shortPayee, "BOFA-TR-20261002-00001").outcome).toBe(
      "insufficient_evidence",
    );

    const longPayee = structuredClone(VALID_INPUT);
    longPayee.transfers[0].payee.accountNumber = "123456789012345678";
    expect(interpretBofa(longPayee, "BOFA-TR-20261002-00001").outcome).toBe(
      "insufficient_evidence",
    );
  });
});
