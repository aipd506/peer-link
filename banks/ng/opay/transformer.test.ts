import { describe, expect, it } from "vitest";
import { interpretOpay } from "./transformer.js";

const VALID_INPUT = {
  account: {
    accountNumber: "8000000001",
    name: "Synthetic OPay Sender",
  },
  transactions: [
    {
      id: "OPAY0000TX01",
      type: "bankTransfer",
      direction: "debit",
      status: "COMPLETED",
      amount: "5000.00",
      currency: "NGN",
      completedAt: "2026-10-02T16:20:00Z",
      payer: {
        accountNumber: "8000000001",
        name: "Synthetic OPay Sender",
      },
      payee: {
        accountNumber: "0000000002",
        bankCode: "058",
        name: "Synthetic Recipient Corp",
      },
    },
  ],
};

describe("interpretOpay unit tests", () => {
  it("interprets a standard completed bankTransfer transaction", () => {
    const result = interpretOpay(VALID_INPUT, "OPAY0000TX01");
    expect(result.outcome).toBe("supported");
    if (result.outcome === "supported") {
      expect(result.payment.provider).toBe("ng/opay");
      expect(result.payment.amountMinor).toBe("500000");
      expect(result.payment.currency).toBe("NGN");
      expect(result.payment.currencyExponent).toBe(2);
      expect(result.payment.direction).toBe("outgoing");
      expect(result.payment.status).toBe("COMPLETED");
      expect(result.payment.payer.id).toBe("8000000001");
      expect(result.payment.payer.scheme).toBe("ng-nuban");
      expect(result.payment.payer.provenance).toBe("transaction.payer");
      expect(result.payment.payee.id).toBe("058:0000000002");
      expect(result.payment.payee.scheme).toBe("ng-nuban");
      expect(result.payment.timestamp).toBe("2026-10-02T16:20:00Z");
      expect(result.payment.sourceAuthenticated).toBe(false);
      expect(result.payment.limitations.length).toBeGreaterThan(0);
    }
  });

  it("supports array input directly", () => {
    const arrayInput = [VALID_INPUT.transactions[0]];
    const result = interpretOpay(arrayInput, "OPAY0000TX01");
    expect(result.outcome).toBe("supported");
  });

  it("supports items and data arrays in root", () => {
    const itemsInput = { items: [VALID_INPUT.transactions[0]] };
    expect(interpretOpay(itemsInput, "OPAY0000TX01").outcome).toBe("supported");

    const dataInput = { data: [VALID_INPUT.transactions[0]] };
    expect(interpretOpay(dataInput, "OPAY0000TX01").outcome).toBe("supported");
  });

  it("supports single object root matching id, reference, transactionId, or orderNo", () => {
    const singleRoot = structuredClone(VALID_INPUT.transactions[0]);
    expect(interpretOpay(singleRoot, "OPAY0000TX01").outcome).toBe("supported");

    const refRoot = structuredClone(VALID_INPUT.transactions[0]);
    delete (refRoot as Record<string, unknown>).id;
    (refRoot as Record<string, unknown>).reference = "OPAY0000TX01";
    expect(interpretOpay(refRoot, "OPAY0000TX01").outcome).toBe("supported");

    const txIdRoot = structuredClone(VALID_INPUT.transactions[0]);
    delete (txIdRoot as Record<string, unknown>).id;
    (txIdRoot as Record<string, unknown>).transactionId = "OPAY0000TX01";
    expect(interpretOpay(txIdRoot, "OPAY0000TX01").outcome).toBe("supported");

    const orderNoRoot = structuredClone(VALID_INPUT.transactions[0]);
    delete (orderNoRoot as Record<string, unknown>).id;
    (orderNoRoot as Record<string, unknown>).orderNo = "OPAY0000TX01";
    expect(interpretOpay(orderNoRoot, "OPAY0000TX01").outcome).toBe("supported");
  });

  it("supports wrapped receipt or transaction in root matching alternate identifiers", () => {
    const wrappedReceipt = { receipt: VALID_INPUT.transactions[0] };
    expect(interpretOpay(wrappedReceipt, "OPAY0000TX01").outcome).toBe("supported");

    const wrappedTx = { transaction: VALID_INPUT.transactions[0] };
    expect(interpretOpay(wrappedTx, "OPAY0000TX01").outcome).toBe("supported");

    const wrappedOrderNo = {
      receipt: {
        ...VALID_INPUT.transactions[0],
        id: undefined,
        orderNo: "OPAY0000TX01",
      },
    };
    expect(interpretOpay(wrappedOrderNo, "OPAY0000TX01").outcome).toBe("supported");
  });

  it("supports alternate transaction types for wallet and bank transfers", () => {
    const walletTypes = ["wallet_transfer", "wallet", "transfer", "p2p"];
    for (const t of walletTypes) {
      const input = structuredClone(VALID_INPUT);
      input.transactions[0].type = t;
      expect(interpretOpay(input, "OPAY0000TX01").outcome).toBe("supported");
    }

    const nipTypes = ["bank_transfer", "nip", "nipTransfer", "nip_transfer"];
    for (const t of nipTypes) {
      const input = structuredClone(VALID_INPUT);
      delete (input.transactions[0] as Record<string, unknown>).type;
      (input.transactions[0] as Record<string, unknown>).transactionType = t;
      expect(interpretOpay(input, "OPAY0000TX01").outcome).toBe("supported");
    }

    const outgoingDir = structuredClone(VALID_INPUT);
    outgoingDir.transactions[0].direction = "outgoing";
    expect(interpretOpay(outgoingDir, "OPAY0000TX01").outcome).toBe("supported");
  });

  it("supports SUCCESS and SUCCESSFUL completed statuses", () => {
    for (const s of ["SUCCESS", "SUCCESSFUL"]) {
      const input = structuredClone(VALID_INPUT);
      input.transactions[0].status = s;
      expect(interpretOpay(input, "OPAY0000TX01").outcome).toBe("supported");
    }
  });

  it("supports timestamp and transferredAt fields", () => {
    const tsInput = structuredClone(VALID_INPUT);
    delete (tsInput.transactions[0] as Record<string, unknown>).completedAt;
    (tsInput.transactions[0] as Record<string, unknown>).timestamp = "2026-10-02T16:20:00Z";
    expect(interpretOpay(tsInput, "OPAY0000TX01").outcome).toBe("supported");

    const transInput = structuredClone(VALID_INPUT);
    delete (transInput.transactions[0] as Record<string, unknown>).completedAt;
    (transInput.transactions[0] as Record<string, unknown>).transferredAt = "2026-10-02T16:20:00Z";
    expect(interpretOpay(transInput, "OPAY0000TX01").outcome).toBe("supported");
  });

  it("supports number amount and formatted string amount with ₦ or NGN", () => {
    const numInput = structuredClone(VALID_INPUT);
    numInput.transactions[0].amount = 5000 as unknown as string;
    const numResult = interpretOpay(numInput, "OPAY0000TX01");
    expect(numResult.outcome).toBe("supported");
    if (numResult.outcome === "supported") {
      expect(numResult.payment.amountMinor).toBe("500000");
    }

    const nairaInput = structuredClone(VALID_INPUT);
    nairaInput.transactions[0].amount = "₦12,345.50";
    const nairaResult = interpretOpay(nairaInput, "OPAY0000TX01");
    expect(nairaResult.outcome).toBe("supported");
    if (nairaResult.outcome === "supported") {
      expect(nairaResult.payment.amountMinor).toBe("1234550");
    }

    const ngnPrefix = structuredClone(VALID_INPUT);
    ngnPrefix.transactions[0].amount = "NGN 3000";
    const ngnResult = interpretOpay(ngnPrefix, "OPAY0000TX01");
    expect(ngnResult.outcome).toBe("supported");
    if (ngnResult.outcome === "supported") {
      expect(ngnResult.payment.amountMinor).toBe("300000");
    }

    const ngnSuffix = structuredClone(VALID_INPUT);
    ngnSuffix.transactions[0].amount = "400.2 NGN";
    const ngnSuffixResult = interpretOpay(ngnSuffix, "OPAY0000TX01");
    expect(ngnSuffixResult.outcome).toBe("supported");
    if (ngnSuffixResult.outcome === "supported") {
      expect(ngnSuffixResult.payment.amountMinor).toBe("40020");
    }
  });

  it("supports phone/NUBAN normalizations: 080..., +234..., 234...", () => {
    const phoneInput = structuredClone(VALID_INPUT);
    phoneInput.transactions[0].payer.accountNumber = "08000000001";
    phoneInput.transactions[0].payee.accountNumber = "+2348000000002";
    const result1 = interpretOpay(phoneInput, "OPAY0000TX01");
    expect(result1.outcome).toBe("supported");
    if (result1.outcome === "supported") {
      expect(result1.payment.payer.id).toBe("8000000001");
      expect(result1.payment.payee.id).toBe("058:8000000002");
    }

    const prefix234 = structuredClone(VALID_INPUT);
    prefix234.transactions[0].payer.accountNumber = "2348000000002";
    const result2 = interpretOpay(prefix234, "OPAY0000TX01");
    expect(result2.outcome).toBe("supported");
    if (result2.outcome === "supported") {
      expect(result2.payment.payer.id).toBe("8000000002");
    }
  });

  it("supports payer fallback to account object and alternate property keys", () => {
    const noPayerObj = structuredClone(VALID_INPUT);
    delete (noPayerObj.transactions[0] as Record<string, unknown>).payer;
    (noPayerObj.account as Record<string, unknown>).accountNumber = "8000000001";
    const result1 = interpretOpay(noPayerObj, "OPAY0000TX01");
    expect(result1.outcome).toBe("supported");
    if (result1.outcome === "supported") {
      expect(result1.payment.payer.provenance).toBe("account.number");
    }

    const accountField = structuredClone(VALID_INPUT);
    delete (accountField.transactions[0].payer as Record<string, unknown>).accountNumber;
    (accountField.transactions[0].payer as Record<string, unknown>).account = "8000000001";
    delete (accountField.transactions[0].payee as Record<string, unknown>).accountNumber;
    (accountField.transactions[0].payee as Record<string, unknown>).account = "0000000002";
    const result2 = interpretOpay(accountField, "OPAY0000TX01");
    expect(result2.outcome).toBe("supported");

    const phoneField = structuredClone(VALID_INPUT);
    delete (phoneField.transactions[0].payer as Record<string, unknown>).accountNumber;
    (phoneField.transactions[0].payer as Record<string, unknown>).phone = "8000000001";
    delete (phoneField.transactions[0].payee as Record<string, unknown>).accountNumber;
    (phoneField.transactions[0].payee as Record<string, unknown>).phone = "0000000002";
    const result3 = interpretOpay(phoneField, "OPAY0000TX01");
    expect(result3.outcome).toBe("supported");

    const idField = structuredClone(VALID_INPUT);
    delete (idField.transactions[0].payer as Record<string, unknown>).accountNumber;
    (idField.transactions[0].payer as Record<string, unknown>).id = "8000000001";
    delete (idField.transactions[0].payee as Record<string, unknown>).accountNumber;
    (idField.transactions[0].payee as Record<string, unknown>).id = "0000000002";
    const result4 = interpretOpay(idField, "OPAY0000TX01");
    expect(result4.outcome).toBe("supported");
  });

  it("requires valid bankCode for NIP transfers and supports wallet transfers without bankCode", () => {
    const noBankCode = structuredClone(VALID_INPUT);
    delete (noBankCode.transactions[0].payee as Record<string, unknown>).bankCode;
    const result1 = interpretOpay(noBankCode, "OPAY0000TX01");
    expect(result1.outcome).toBe("insufficient_evidence");
    if (result1.outcome === "insufficient_evidence") {
      expect(result1.reason).toContain("destination bank code");
    }

    const invalidBankCode = structuredClone(VALID_INPUT);
    (invalidBankCode.transactions[0].payee as Record<string, unknown>).bankCode = "AB";
    const result2 = interpretOpay(invalidBankCode, "OPAY0000TX01");
    expect(result2.outcome).toBe("insufficient_evidence");
    if (result2.outcome === "insufficient_evidence") {
      expect(result2.reason).toContain("destination bank code");
    }

    const walletTx = structuredClone(VALID_INPUT);
    walletTx.transactions[0].type = "walletTransfer";
    delete (walletTx.transactions[0].payee as Record<string, unknown>).bankCode;
    const result3 = interpretOpay(walletTx, "OPAY0000TX01");
    expect(result3.outcome).toBe("supported");
    if (result3.outcome === "supported") {
      expect(result3.payment.payee.id).toBe("0000000002");
    }

    const validNip = structuredClone(VALID_INPUT);
    (validNip.transactions[0].payee as Record<string, unknown>).bankCode = "058";
    const result4 = interpretOpay(validNip, "OPAY0000TX01");
    expect(result4.outcome).toBe("supported");
    if (result4.outcome === "supported") {
      expect(result4.payment.payee.id).toBe("058:0000000002");
    }
  });

  it("rejects invalid or missing transactionId parameter", () => {
    expect(interpretOpay(VALID_INPUT, "").outcome).toBe("insufficient_evidence");
    expect(interpretOpay(VALID_INPUT, "   ").outcome).toBe("insufficient_evidence");
    expect(interpretOpay(VALID_INPUT, null as unknown as string).outcome).toBe(
      "insufficient_evidence",
    );
  });

  it("rejects invalid input envelope or missing transaction", () => {
    expect(interpretOpay(null, "OPAY0000TX01").outcome).toBe("insufficient_evidence");
    expect(interpretOpay(42, "OPAY0000TX01").outcome).toBe("insufficient_evidence");
    expect(interpretOpay({}, "OPAY0000TX01").outcome).toBe("insufficient_evidence");
    expect(interpretOpay(VALID_INPUT, "MISSING_ID").outcome).toBe("insufficient_evidence");
  });

  it("rejects duplicate transaction occurrences", () => {
    const dupInput = {
      transactions: [VALID_INPUT.transactions[0], VALID_INPUT.transactions[0]],
    };
    expect(interpretOpay(dupInput, "OPAY0000TX01").outcome).toBe("insufficient_evidence");
  });

  it("returns unsupported for non-transfer types or non-outgoing direction", () => {
    const airtime = structuredClone(VALID_INPUT);
    airtime.transactions[0].type = "airtime";
    expect(interpretOpay(airtime, "OPAY0000TX01").outcome).toBe("unsupported");

    const incoming = structuredClone(VALID_INPUT);
    incoming.transactions[0].direction = "credit";
    expect(interpretOpay(incoming, "OPAY0000TX01").outcome).toBe("unsupported");
  });

  it("rejects pending, processing, failed, cancelled, reversed, or unknown status", () => {
    for (const status of ["PENDING", "PROCESSING"]) {
      const input = structuredClone(VALID_INPUT);
      input.transactions[0].status = status;
      const res = interpretOpay(input, "OPAY0000TX01");
      expect(res.outcome).toBe("insufficient_evidence");
      if (res.outcome === "insufficient_evidence") {
        expect(res.reason).toBe("Transaction is still pending execution");
      }
    }

    for (const status of ["FAILED", "CANCELLED", "REVERSED"]) {
      const input = structuredClone(VALID_INPUT);
      input.transactions[0].status = status;
      const res = interpretOpay(input, "OPAY0000TX01");
      expect(res.outcome).toBe("insufficient_evidence");
      if (res.outcome === "insufficient_evidence") {
        expect(res.reason).toBe("Transaction failed or was reversed");
      }
    }

    const invalidStatus = structuredClone(VALID_INPUT);
    invalidStatus.transactions[0].status = "OTHER";
    expect(interpretOpay(invalidStatus, "OPAY0000TX01").outcome).toBe("insufficient_evidence");

    const nonStringStatus = structuredClone(VALID_INPUT);
    nonStringStatus.transactions[0].status = 123 as unknown as string;
    expect(interpretOpay(nonStringStatus, "OPAY0000TX01").outcome).toBe("insufficient_evidence");
  });

  it("rejects non-NGN currency", () => {
    const usdInput = structuredClone(VALID_INPUT);
    usdInput.transactions[0].currency = "USD";
    expect(interpretOpay(usdInput, "OPAY0000TX01").outcome).toBe("insufficient_evidence");
  });

  it("rejects non-positive numeric amounts and non-number/non-string amounts", () => {
    for (const bad of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      const input = structuredClone(VALID_INPUT);
      input.transactions[0].amount = bad as unknown as string;
      expect(interpretOpay(input, "OPAY0000TX01").outcome).toBe("insufficient_evidence");
    }

    for (const bad of [null, undefined, true, {}, []]) {
      const input = structuredClone(VALID_INPUT);
      input.transactions[0].amount = bad as unknown as string;
      expect(interpretOpay(input, "OPAY0000TX01").outcome).toBe("insufficient_evidence");
    }
  });

  it("rejects invalid amount strings, bad comma placement, excessive precision, or zero amounts", () => {
    const badStrings = ["abc", "1,200", "1.2.3", "50.123", "0.00", "0", "-50.00", "010.00"];
    for (const bad of badStrings) {
      const input = structuredClone(VALID_INPUT);
      input.transactions[0].amount = bad;
      expect(interpretOpay(input, "OPAY0000TX01").outcome).toBe("insufficient_evidence");
    }
  });

  it("rejects invalid timestamp format and invalid calendar date", () => {
    const badDates = [
      "2026-10-02",
      "not-a-date",
      "2026-02-30T16:20:00Z",
      "2026-10-02T16:20:00+01:00",
    ];
    for (const d of badDates) {
      const input = structuredClone(VALID_INPUT);
      input.transactions[0].completedAt = d;
      expect(interpretOpay(input, "OPAY0000TX01").outcome).toBe("insufficient_evidence");
    }

    const nonStringDate = structuredClone(VALID_INPUT);
    nonStringDate.transactions[0].completedAt = 123456789 as unknown as string;
    expect(interpretOpay(nonStringDate, "OPAY0000TX01").outcome).toBe("insufficient_evidence");
  });

  it("rejects masked or invalid payer and payee NUBAN numbers", () => {
    const maskedPayer = structuredClone(VALID_INPUT);
    maskedPayer.transactions[0].payer.accountNumber = "80000***01";
    delete (maskedPayer.account as Record<string, unknown>).accountNumber;
    expect(interpretOpay(maskedPayer, "OPAY0000TX01").outcome).toBe("insufficient_evidence");

    const badPayer = structuredClone(VALID_INPUT);
    badPayer.transactions[0].payer.accountNumber = "12345";
    delete (badPayer.account as Record<string, unknown>).accountNumber;
    expect(interpretOpay(badPayer, "OPAY0000TX01").outcome).toBe("insufficient_evidence");

    const missingPayer = structuredClone(VALID_INPUT);
    delete (missingPayer.transactions[0] as Record<string, unknown>).payer;
    delete (missingPayer.account as Record<string, unknown>).accountNumber;
    expect(interpretOpay(missingPayer, "OPAY0000TX01").outcome).toBe("insufficient_evidence");

    const maskedPayee = structuredClone(VALID_INPUT);
    maskedPayee.transactions[0].payee.accountNumber = "00000???02";
    expect(interpretOpay(maskedPayee, "OPAY0000TX01").outcome).toBe("insufficient_evidence");

    const badPayee = structuredClone(VALID_INPUT);
    badPayee.transactions[0].payee.accountNumber = "123456789012";
    expect(interpretOpay(badPayee, "OPAY0000TX01").outcome).toBe("insufficient_evidence");

    const missingPayee = structuredClone(VALID_INPUT);
    delete (missingPayee.transactions[0] as Record<string, unknown>).payee;
    expect(interpretOpay(missingPayee, "OPAY0000TX01").outcome).toBe("insufficient_evidence");
  });
});
