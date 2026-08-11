export type AdapterMode = "disabled" | "fictional-test";

export type AdapterContext = Readonly<{
  organizationId: string;
  branchId: string;
  idempotencyKey: string;
  requestedAt: string;
}>;

export type ProviderResult<T> = Readonly<
  | { status: "DISABLED"; code: string; message: string }
  | { status: "TEST_ONLY"; testOnly: true; value: T }
>;

export interface PaymentServiceProviderAdapter {
  readonly kind: "PSP";
  readonly mode: AdapterMode;
  createIntent(
    context: AdapterContext,
    input: Readonly<{ amountPesewas: number; currency: "GHS" }>,
  ): Promise<ProviderResult<{ providerReference: string }>>;
  query(
    context: AdapterContext,
    providerReference: string,
  ): Promise<ProviderResult<{ providerReference: string; state: "PENDING" }>>;
}

export interface GraFiscalAdapter {
  readonly kind: "GRA_FISCAL";
  readonly mode: AdapterMode;
  submitCommercialSnapshot(
    context: AdapterContext,
    input: Readonly<{ receiptId: string; snapshotHash: string }>,
  ): Promise<
    ProviderResult<{
      commercialReceiptId: string;
      watermark: "FICTIONAL TEST ADAPTER — NOT A FISCAL RECEIPT";
    }>
  >;
}

export interface PrinterAdapter {
  readonly kind: "PRINTER";
  readonly mode: AdapterMode;
  print(
    context: AdapterContext,
    input: Readonly<{ jobId: string; contentType: string; body: string }>,
  ): Promise<ProviderResult<{ jobId: string; accepted: true }>>;
}

export interface NotificationAdapter {
  readonly kind: "NOTIFICATION";
  readonly mode: AdapterMode;
  send(
    context: AdapterContext,
    input: Readonly<{
      messageId: string;
      channel: "SMS" | "EMAIL";
      body: string;
    }>,
  ): Promise<ProviderResult<{ messageId: string; accepted: true }>>;
}

const disabled = <T>(code: string, message: string): ProviderResult<T> => ({
  status: "DISABLED",
  code,
  message,
});

class DisabledPspAdapter implements PaymentServiceProviderAdapter {
  readonly kind = "PSP";
  readonly mode = "disabled";
  async createIntent() {
    return disabled<{ providerReference: string }>(
      "PSP_ADAPTER_DISABLED",
      "No licensed payment provider has been selected or configured.",
    );
  }
  async query() {
    return disabled<{ providerReference: string; state: "PENDING" }>(
      "PSP_ADAPTER_DISABLED",
      "No licensed payment provider has been selected or configured.",
    );
  }
}

class DisabledFiscalAdapter implements GraFiscalAdapter {
  readonly kind = "GRA_FISCAL";
  readonly mode = "disabled";
  async submitCommercialSnapshot() {
    return disabled<{
      commercialReceiptId: string;
      watermark: "FICTIONAL TEST ADAPTER — NOT A FISCAL RECEIPT";
    }>(
      "GRA_FISCAL_ADAPTER_DISABLED",
      "No approved GRA fiscal integration is configured.",
    );
  }
}

class DisabledPrinterAdapter implements PrinterAdapter {
  readonly kind = "PRINTER";
  readonly mode = "disabled";
  async print() {
    return disabled<{ jobId: string; accepted: true }>(
      "PRINTER_ADAPTER_DISABLED",
      "No hardware printer adapter is configured; browser print remains separate.",
    );
  }
}

class DisabledNotificationAdapter implements NotificationAdapter {
  readonly kind = "NOTIFICATION";
  readonly mode = "disabled";
  async send() {
    return disabled<{ messageId: string; accepted: true }>(
      "NOTIFICATION_ADAPTER_DISABLED",
      "No approved notification provider or recipient policy is configured.",
    );
  }
}

const fictionalReference = (prefix: string, idempotencyKey: string) =>
  `FICTIONAL-${prefix}-${idempotencyKey}`.slice(0, 160);

class FictionalTestPspAdapter implements PaymentServiceProviderAdapter {
  readonly kind = "PSP";
  readonly mode = "fictional-test";
  async createIntent(context: AdapterContext) {
    return {
      status: "TEST_ONLY" as const,
      testOnly: true as const,
      value: {
        providerReference: fictionalReference("PSP", context.idempotencyKey),
      },
    };
  }
  async query(_context: AdapterContext, providerReference: string) {
    return {
      status: "TEST_ONLY" as const,
      testOnly: true as const,
      value: { providerReference, state: "PENDING" as const },
    };
  }
}

class FictionalTestFiscalAdapter implements GraFiscalAdapter {
  readonly kind = "GRA_FISCAL";
  readonly mode = "fictional-test";
  async submitCommercialSnapshot(
    _context: AdapterContext,
    input: Readonly<{ receiptId: string; snapshotHash: string }>,
  ) {
    return {
      status: "TEST_ONLY" as const,
      testOnly: true as const,
      value: {
        commercialReceiptId: input.receiptId,
        watermark: "FICTIONAL TEST ADAPTER — NOT A FISCAL RECEIPT" as const,
      },
    };
  }
}

class FictionalMemoryPrinterAdapter implements PrinterAdapter {
  readonly kind = "PRINTER";
  readonly mode = "fictional-test";
  async print(_context: AdapterContext, input: Readonly<{ jobId: string }>) {
    return {
      status: "TEST_ONLY" as const,
      testOnly: true as const,
      value: { jobId: input.jobId, accepted: true as const },
    };
  }
}

class FictionalTestNotificationAdapter implements NotificationAdapter {
  readonly kind = "NOTIFICATION";
  readonly mode = "fictional-test";
  async send(_context: AdapterContext, input: Readonly<{ messageId: string }>) {
    return {
      status: "TEST_ONLY" as const,
      testOnly: true as const,
      value: { messageId: input.messageId, accepted: true as const },
    };
  }
}

export type IntegrationRegistry = Readonly<{
  psp: PaymentServiceProviderAdapter;
  fiscal: GraFiscalAdapter;
  printer: PrinterAdapter;
  notification: NotificationAdapter;
}>;

export function createIntegrationRegistry(
  environment: NodeJS.ProcessEnv,
): IntegrationRegistry {
  const testAllowed =
    environment.ALLOW_FICTIONAL_INTEGRATION_ADAPTERS === "true";
  const choose = <T>(
    variable: string,
    disabledAdapter: T,
    testAdapter: T,
  ): T => {
    const selected = environment[variable] ?? "disabled";
    if (
      selected === "disabled" ||
      (variable === "PRINTER_ADAPTER" && selected === "browser")
    ) {
      return disabledAdapter;
    }
    if (
      selected === "fictional-test" &&
      testAllowed &&
      environment.NODE_ENV !== "production"
    ) {
      return testAdapter;
    }
    throw new Error(`${variable}_UNAVAILABLE: ${selected}`);
  };

  return {
    psp: choose<PaymentServiceProviderAdapter>(
      "PSP_ADAPTER",
      new DisabledPspAdapter(),
      new FictionalTestPspAdapter(),
    ),
    fiscal: choose<GraFiscalAdapter>(
      "GRA_FISCAL_ADAPTER",
      new DisabledFiscalAdapter(),
      new FictionalTestFiscalAdapter(),
    ),
    printer: choose<PrinterAdapter>(
      "PRINTER_ADAPTER",
      new DisabledPrinterAdapter(),
      new FictionalMemoryPrinterAdapter(),
    ),
    notification: choose<NotificationAdapter>(
      "NOTIFICATION_ADAPTER",
      new DisabledNotificationAdapter(),
      new FictionalTestNotificationAdapter(),
    ),
  };
}
