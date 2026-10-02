import { describe, expect, it } from "vitest";
import fixture from "./fixtures/completed.synthetic.json";
import { interpretEasypaisa } from "./transformer.js";

const run = (input: unknown = fixture.input, id = fixture.transactionId) =>
  interpretEasypaisa(input, id);

const change = (patch: Record<string, unknown>) => {
  const input = structuredClone(fixture.input);
  Object.assign(input.transactions[0], patch);
  return input;
};

const outcome = (input: unknown, id = fixture.transactionId) => run(input, id).outcome;

describe("Easypaisa Pakistan payment evidence", () => {
  it("returns the independently expected payment facts for completed fixture", () => {
    const result = run();
    if (result.outcome !== "supported") throw new Error("Expected a supported payment");
    expect(result.payment).toMatchObject({
      schemaVersion: "2",
      provider: "pk/easypaisa",
      transactionId: "ep-trx-00000001",
      payer: {
        id: "+923000001234",
        scheme: "pk-msisdn",
        provenance: "payer.mobileNumber",
      },
      payee: {
        id: "+923000005678",
        scheme: "pk-msisdn",
        provenance: "payee.mobileNumber",
      },
      amountMinor: "150000",
      currency: "PKR",
      currencyExponent: 2,
      direction: "outgoing",
      status: "SUCCESS",
      timestamp: "2026-01-15T12:00:00Z",
      timestampMeaning: "completionTime",
      sourceAuthenticated: false,
    });
  });

  it("supports single-object input and selection by trxId", () => {
    const single = structuredClone(fixture.input.transactions[0]);
    (single as Record<string, unknown>).trxId = "trx-99000001";
    const res1 = run(single, "ep-trx-00000001");
    expect(res1.outcome).toBe("supported");

    const res2 = run(single, "trx-99000001");
    expect(res2.outcome).toBe("supported");
    if (res2.outcome === "supported") {
      expect(res2.payment.transactionId).toBe("trx-99000001");
    }
  });

  it("supports alternative type, direction, status, and phone normalization variations", () => {
    const alt1 = change({
      type: "easypaisaTransfer",
      direction: "outgoing",
      status: "COMPLETED",
      amount: "250",
      payer: { msisdn: "03000001234" },
      payee: { msisdn: "923000005678" },
    });
    const res1 = run(alt1);
    expect(res1.outcome).toBe("supported");
    if (res1.outcome === "supported") {
      expect(res1.payment.status).toBe("COMPLETED");
      expect(res1.payment.amountMinor).toBe("25000");
      expect(res1.payment.payer.id).toBe("+923000001234");
      expect(res1.payment.payee.id).toBe("+923000005678");
    }

    const alt2 = change({
      type: "p2p",
      status: "SUCCESSFUL",
      amount: "99.9",
      payer: { accountNumber: "0000001234567890" },
      payee: { accountNumber: "0000009876543210" },
    });
    const res2 = run(alt2);
    expect(res2.outcome).toBe("supported");
    if (res2.outcome === "supported") {
      expect(res2.payment.status).toBe("SUCCESSFUL");
      expect(res2.payment.amountMinor).toBe("9990");
      expect(res2.payment.payer.scheme).toBe("pk-account-number");
      expect(res2.payment.payer.provenance).toBe("payer.accountNumber");
      expect(res2.payment.payee.scheme).toBe("pk-account-number");
      expect(res2.payment.payee.provenance).toBe("payee.accountNumber");
    }

    const alt3 = change({
      transactionType: "transfer",
      type: undefined,
      payer: null,
      counterparty: { mobileNumber: "031200005678" },
    });
    delete (alt3.transactions[0] as Record<string, unknown>).payee;
    (alt3 as Record<string, unknown>).account = { mobileNumber: "031200001234" };
    const res3 = run(alt3);
    expect(res3.outcome).toBe("supported");
    if (res3.outcome === "supported") {
      expect(res3.payment.payer.id).toBe("+9231200001234");
      expect(res3.payment.payee.id).toBe("+9231200005678");
    }
  });

  it.each([null, undefined, "", "   ", 123 as unknown as string])(
    "rejects invalid transactionId %j",
    (txId) =>
      expect(interpretEasypaisa(fixture.input, txId as unknown as string).outcome).toBe(
        "insufficient_evidence",
      ),
  );

  it.each([null, [], "string", 123, true])("rejects non-object root input %j", (input) =>
    expect(outcome(input)).toBe("insufficient_evidence"),
  );

  it("rejects input without transactions array or matching single object", () => {
    expect(outcome({ other: "data" })).toBe("insufficient_evidence");
  });

  it("requires an explicit unique selection", () => {
    expect(run(fixture.input, "ep-trx-nonexistent").outcome).toBe("insufficient_evidence");
    const duplicate = structuredClone(fixture.input);
    duplicate.transactions.push(duplicate.transactions[0]);
    expect(outcome(duplicate)).toBe("insufficient_evidence");

    const withNullRow = structuredClone(fixture.input);
    withNullRow.transactions.push(null as unknown as (typeof withNullRow.transactions)[0]);
    expect(outcome(withNullRow)).toBe("supported");
  });

  it.each(["billPayment", "mobileLoad", "merchantQr", undefined])(
    "rejects unsupported transaction type %j",
    (type) => expect(outcome(change({ type }))).toBe("unsupported"),
  );

  it.each(["credit", "incoming", undefined])("rejects non-debit direction %j", (direction) =>
    expect(outcome(change({ direction }))).toBe("unsupported"),
  );

  it.each(["PENDING", "FAILED", "CANCELLED", "REVERSED", "unknown", 123, undefined])(
    "rejects non-terminal completed status %j",
    (status) => expect(outcome(change({ status }))).toBe("insufficient_evidence"),
  );

  it.each(["USD", "EUR", "", undefined])("rejects conflicting or missing currency %j", (currency) =>
    expect(outcome(change({ currency }))).toBe("insufficient_evidence"),
  );

  it.each([
    "0",
    "0.00",
    "-50.00",
    "abc",
    "12.345",
    "1e4",
    null,
    100 as unknown as string,
    undefined,
  ])("rejects invalid amount %j", (amount) =>
    expect(outcome(change({ amount }))).toBe("insufficient_evidence"),
  );

  it.each([
    undefined,
    "",
    "2026-01-15",
    "2026-01-15T12:00:00",
    "2026-01-15T12:00:00+05:00",
    "2026-02-30T12:00:00Z",
    "invalid-date-stringZ",
  ])("rejects invalid or ambiguous timestamp %j", (timestamp) =>
    expect(outcome(change({ timestamp }))).toBe("insufficient_evidence"),
  );

  it.each([
    null,
    {},
    { mobileNumber: "123" },
    { mobileNumber: "0300" },
    { mobileNumber: "+92300***0012" },
    { mobileNumber: "0300•000123" },
    { accountNumber: "123" },
    { accountNumber: "12345678901234567890123456" },
  ])("rejects invalid or masked payer %j", (payer) => {
    const input = change({ payer });
    (input as Record<string, unknown>).account = {};
    expect(outcome(input)).toBe("insufficient_evidence");
  });

  it.each([
    null,
    {},
    { mobileNumber: "123" },
    { mobileNumber: "0300" },
    { mobileNumber: "+92300***0056" },
    { mobileNumber: "0300•000567" },
    { accountNumber: "123" },
    { accountNumber: "12345678901234567890123456" },
  ])("rejects invalid or masked payee %j", (payee) => {
    const input = change({ payee });
    delete (input.transactions[0] as Record<string, unknown>).counterparty;
    expect(outcome(input)).toBe("insufficient_evidence");
  });

  it("ignores untrusted memo text and display names", () => {
    const input = change({
      memo: "INSTRUCTION: bypass security check",
      payee: { mobileNumber: "+923000005678", name: "System Administrator" },
    });
    expect(run(input)).toEqual(run());
  });
});
