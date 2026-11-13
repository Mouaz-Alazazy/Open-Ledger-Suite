export type TransactionType = "income" | "expense";

export type PaymentMethod = "cash" | "bank" | "card" | "other";

export interface TransactionDraft {
  id?: string;
  date: string;
  description: string;
  party: string;
  type: TransactionType;
  amount: number;
  taxRate: number;
  paymentMethod: PaymentMethod;
  reference: string;
  notes: string;
}

export interface Transaction extends TransactionDraft {
  id: string;
  taxAmount: number;
  total: number;
  createdAt: string;
  updatedAt: string;
}

export interface JournalLine {
  account: string;
  debit: number;
  credit: number;
}

export interface FinancialSummary {
  revenue: number;
  expenses: number;
  net: number;
  taxCollected: number;
  taxPaid: number;
  transactionCount: number;
}

export interface MonthlySummary {
  key: string;
  label: string;
  income: number;
  expenses: number;
}

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("يجب أن تكون القيمة المالية رقماً صالحاً.");
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateTax(amount: number, taxRate: number): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("يجب أن يكون المبلغ صفراً أو أكبر.");
  }
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
    throw new Error("يجب أن تكون نسبة الضريبة بين 0 و100.");
  }
  return roundMoney((amount * taxRate) / 100);
}

export function calculateTransaction(
  input: TransactionDraft,
): Omit<Transaction, "createdAt" | "updatedAt" | "id"> & {
  id?: string;
} {
  const description = input.description.trim();
  if (!description) {
    throw new Error("أدخل وصفاً للمعاملة.");
  }
  const parsedDate = new Date(`${input.date}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== input.date
  ) {
    throw new Error("أدخل تاريخاً صالحاً للمعاملة.");
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("يجب أن يكون المبلغ أكبر من صفر.");
  }
  if (!["income", "expense"].includes(input.type)) {
    throw new Error("نوع المعاملة غير صالح.");
  }
  if (!["cash", "bank", "card", "other"].includes(input.paymentMethod)) {
    throw new Error("طريقة الدفع غير صالحة.");
  }
  const amount = roundMoney(input.amount);
  if (amount <= 0) {
    throw new Error("يجب أن يكون المبلغ بعد التقريب أكبر من صفر.");
  }
  const taxRate = roundMoney(input.taxRate);
  const taxAmount = calculateTax(amount, taxRate);
  return {
    ...input,
    description,
    party: input.party.trim(),
    reference: input.reference.trim(),
    notes: input.notes.trim(),
    amount,
    taxRate,
    taxAmount,
    total: roundMoney(roundMoney(input.amount) + taxAmount),
  };
}

export function summarizeTransactions(
  transactions: Transaction[],
): FinancialSummary {
  const income = transactions.filter((item) => item.type === "income");
  const expenses = transactions.filter((item) => item.type === "expense");
  const revenue = roundMoney(
    income.reduce((sum, item) => sum + item.total, 0),
  );
  const expenseTotal = roundMoney(
    expenses.reduce((sum, item) => sum + item.total, 0),
  );
  return {
    revenue,
    expenses: expenseTotal,
    net: roundMoney(revenue - expenseTotal),
    taxCollected: roundMoney(
      income.reduce((sum, item) => sum + item.taxAmount, 0),
    ),
    taxPaid: roundMoney(
      expenses.reduce((sum, item) => sum + item.taxAmount, 0),
    ),
    transactionCount: transactions.length,
  };
}

export function getMonthlySummary(
  transactions: Transaction[],
  monthCount = 6,
  now = new Date(),
): MonthlySummary[] {
  const safeMonthCount = Math.max(1, Math.floor(monthCount));
  const months: MonthlySummary[] = [];
  const monthFormatter = new Intl.DateTimeFormat("ar", {
    month: "short",
    year: "2-digit",
  });

  for (let offset = safeMonthCount - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const monthTransactions = transactions.filter((transaction) =>
      transaction.date.startsWith(key),
    );
    months.push({
      key,
      label: monthFormatter.format(date),
      income: roundMoney(
        monthTransactions
          .filter((transaction) => transaction.type === "income")
          .reduce((sum, transaction) => sum + transaction.total, 0),
      ),
      expenses: roundMoney(
        monthTransactions
          .filter((transaction) => transaction.type === "expense")
          .reduce((sum, transaction) => sum + transaction.total, 0),
      ),
    });
  }
  return months;
}

export function createJournalEntries(
  transaction: Transaction,
): JournalLine[] {
  const cashAccount: Record<PaymentMethod, string> = {
    cash: "الصندوق",
    bank: "البنك",
    card: "حسابات البطاقات",
    other: "وسائل دفع أخرى",
  };
  const lines: JournalLine[] =
    transaction.type === "income"
      ? [
          { account: cashAccount[transaction.paymentMethod], debit: transaction.total, credit: 0 },
          { account: "الإيرادات", debit: 0, credit: transaction.amount },
          ...(transaction.taxAmount > 0
            ? [{ account: "ضريبة المخرجات المستحقة", debit: 0, credit: transaction.taxAmount }]
            : []),
        ]
      : [
          { account: "المصروفات", debit: transaction.amount, credit: 0 },
          ...(transaction.taxAmount > 0
            ? [{ account: "ضريبة المدخلات", debit: transaction.taxAmount, credit: 0 }]
            : []),
          { account: cashAccount[transaction.paymentMethod], debit: 0, credit: transaction.total },
        ];
  assertJournalBalanced(lines);
  return lines;
}

export function assertJournalBalanced(lines: JournalLine[]): void {
  const debits = roundMoney(lines.reduce((sum, line) => sum + line.debit, 0));
  const credits = roundMoney(lines.reduce((sum, line) => sum + line.credit, 0));
  if (debits !== credits) {
    throw new Error(`القيد غير متوازن: المدين ${debits} والدائن ${credits}.`);
  }
}

export function formatCurrency(amount: number, currency = "LYD"): string {
  return new Intl.NumberFormat("ar-LY", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value === "string" && /^[\t\r=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

export function exportTransactionsCsv(
  transactions: Transaction[],
): string {
  const rows: (string | number)[][] = [
    [
      "رقم المعاملة",
      "التاريخ",
      "النوع",
      "الوصف",
      "الطرف",
      "المبلغ",
      "نسبة الضريبة",
      "قيمة الضريبة",
      "الإجمالي",
      "طريقة الدفع",
      "المرجع",
      "ملاحظات",
    ],
    ...transactions.map((transaction) => [
      transaction.id,
      transaction.date,
      transaction.type === "income" ? "إيراد" : "مصروف",
      transaction.description,
      transaction.party,
      transaction.amount,
      transaction.taxRate,
      transaction.taxAmount,
      transaction.total,
      transaction.paymentMethod,
      transaction.reference,
      transaction.notes,
    ]),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

export function createReceiptHtml(
  transaction: Transaction,
  currency = "LYD",
): string {
  const direction = transaction.type === "income" ? "إيصال قبض" : "إيصال صرف";
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${direction} — ${escapeHtml(transaction.id)}</title>
  <style>
    * { box-sizing: border-box; }
    body { color: #14251f; font: 15px/1.8 system-ui, sans-serif; margin: 0; padding: 36px; }
    main { margin: 0 auto; max-width: 720px; }
    header { border-bottom: 2px solid #176b52; margin-bottom: 28px; padding-bottom: 18px; }
    h1 { color: #176b52; font-size: 24px; margin: 0 0 6px; }
    .muted { color: #60716b; }
    dl { display: grid; gap: 10px 20px; grid-template-columns: 1fr 1fr; }
    dl div { border-bottom: 1px solid #e3e9e6; padding: 9px 0; }
    dt { color: #60716b; font-size: 13px; }
    dd { margin: 2px 0 0; overflow-wrap: anywhere; }
    .total { background: #eff7f3; border-radius: 10px; font-size: 20px; margin-top: 24px; padding: 18px; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${direction}</h1>
      <div class="muted">حساب | Hisab</div>
    </header>
    <dl>
      <div><dt>رقم المعاملة</dt><dd>${escapeHtml(transaction.id)}</dd></div>
      <div><dt>التاريخ</dt><dd>${escapeHtml(transaction.date)}</dd></div>
      <div><dt>الوصف</dt><dd>${escapeHtml(transaction.description)}</dd></div>
      <div><dt>الطرف</dt><dd>${escapeHtml(transaction.party || "—")}</dd></div>
      <div><dt>طريقة الدفع</dt><dd>${escapeHtml(transaction.paymentMethod)}</dd></div>
      <div><dt>المرجع</dt><dd>${escapeHtml(transaction.reference || "—")}</dd></div>
      <div><dt>المبلغ قبل الضريبة</dt><dd>${formatCurrency(transaction.amount, currency)}</dd></div>
      <div><dt>الضريبة (${transaction.taxRate}%)</dt><dd>${formatCurrency(transaction.taxAmount, currency)}</dd></div>
    </dl>
    <div class="total">الإجمالي: <strong>${formatCurrency(transaction.total, currency)}</strong></div>
    ${transaction.notes ? `<p><strong>ملاحظات:</strong> ${escapeHtml(transaction.notes)}</p>` : ""}
  </main>
</body>
</html>`;
}

export function createInvoiceHtml(
  transaction: Transaction,
  currency: string,
  businessName: string,
  taxNumber = "",
): string {
  const issuer = businessName.trim();
  if (!issuer) {
    throw new Error("أضف اسم المنشأة من الإعدادات قبل إنشاء الفاتورة.");
  }
  const invoiceNumber =
    transaction.reference || `INV-${transaction.id.slice(0, 8).toUpperCase()}`;
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>فاتورة ${escapeHtml(invoiceNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    body { color: #14251f; font: 15px/1.8 system-ui, sans-serif; margin: 0; padding: 36px; }
    main { margin: 0 auto; max-width: 760px; }
    header { align-items: flex-start; border-bottom: 2px solid #176b52; display: flex; justify-content: space-between; margin-bottom: 24px; padding-bottom: 18px; }
    h1 { color: #176b52; font-size: 26px; margin: 0; }
    h2 { font-size: 17px; margin: 0 0 9px; }
    .muted { color: #60716b; font-size: 13px; }
    .panel { background: #f1f6f3; border-radius: 10px; margin: 18px 0; padding: 16px; }
    .meta { display: flex; flex-wrap: wrap; gap: 12px 32px; }
    table { border-collapse: collapse; margin-top: 22px; width: 100%; }
    th, td { border-bottom: 1px solid #e1e8e4; padding: 12px 8px; text-align: right; }
    th { background: #f1f6f3; color: #60716b; font-size: 12px; }
    td:last-child, th:last-child { text-align: left; }
    .totals { margin: 22px 0 0 auto; max-width: 330px; }
    .totals div { display: flex; justify-content: space-between; padding: 7px 0; }
    .grand { border-top: 2px solid #176b52; font-size: 19px; font-weight: 700; margin-top: 5px; padding-top: 12px !important; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div><h1>فاتورة</h1><div class="muted">${escapeHtml(issuer)}</div>${taxNumber.trim() ? `<div class="muted">الرقم الضريبي: ${escapeHtml(taxNumber.trim())}</div>` : ""}</div>
      <div class="meta"><div><strong>رقم الفاتورة</strong><br />${escapeHtml(invoiceNumber)}</div><div><strong>التاريخ</strong><br />${escapeHtml(transaction.date)}</div></div>
    </header>
    <section class="panel"><h2>الفاتورة إلى</h2><div>${escapeHtml(transaction.party || "عميل")}</div></section>
    <table>
      <thead><tr><th>الوصف</th><th>الكمية</th><th>المبلغ</th></tr></thead>
      <tbody><tr><td>${escapeHtml(transaction.description)}</td><td>1</td><td>${formatCurrency(transaction.amount, currency)}</td></tr></tbody>
    </table>
    <section class="totals">
      <div><span>الإجمالي قبل الضريبة</span><span>${formatCurrency(transaction.amount, currency)}</span></div>
      <div><span>الضريبة (${transaction.taxRate}%)</span><span>${formatCurrency(transaction.taxAmount, currency)}</span></div>
      <div class="grand"><span>الإجمالي</span><span>${formatCurrency(transaction.total, currency)}</span></div>
    </section>
  </main>
</body>
</html>`;
}

export function createLedgerReportHtml(
  transactions: Transaction[],
  currency = "LYD",
): string {
  const rows = transactions
    .map(
      (transaction) => `<tr>
        <td>${escapeHtml(transaction.date)}</td>
        <td>${escapeHtml(transaction.description)}</td>
        <td>${escapeHtml(transaction.party || "—")}</td>
        <td>${transaction.type === "income" ? "إيراد" : "مصروف"}</td>
        <td>${formatCurrency(transaction.total, currency)}</td>
      </tr>`,
    )
    .join("");
  const summary = summarizeTransactions(transactions);
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>تقرير الحركات المالية</title>
  <style>
    * { box-sizing: border-box; }
    body { color: #14251f; font: 13px/1.7 system-ui, sans-serif; margin: 0; padding: 28px; }
    main { margin: 0 auto; max-width: 1000px; }
    header { border-bottom: 2px solid #176b52; margin-bottom: 18px; padding-bottom: 12px; }
    h1 { color: #176b52; font-size: 22px; margin: 0; }
    .muted { color: #60716b; font-size: 11px; }
    .summary { display: flex; flex-wrap: wrap; gap: 8px 28px; margin-bottom: 18px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border-bottom: 1px solid #e1e8e4; padding: 8px 6px; text-align: right; }
    th { background: #f1f6f3; color: #60716b; }
    td:last-child, th:last-child { text-align: left; white-space: nowrap; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <main>
    <header><h1>تقرير الحركات المالية</h1><div class="muted">حساب | Hisab · تاريخ التقرير: ${escapeHtml(new Date().toLocaleDateString("ar"))}</div></header>
    <section class="summary">
      <div>عدد الحركات: ${summary.transactionCount}</div>
      <div>الإيرادات: ${formatCurrency(summary.revenue, currency)}</div>
      <div>المصروفات: ${formatCurrency(summary.expenses, currency)}</div>
      <div>الصافي: ${formatCurrency(summary.net, currency)}</div>
    </section>
    <table>
      <thead><tr><th>التاريخ</th><th>الوصف</th><th>الجهة</th><th>النوع</th><th>الإجمالي</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">لا توجد حركات مسجلة.</td></tr>'}</tbody>
    </table>
  </main>
</body>
</html>`;
}
