import {
  calculateTransaction,
  type Transaction,
  type TransactionDraft,
} from "@/core/accounting";

export type StorageMode = "desktop-sqlite" | "browser-indexeddb";

const DATABASE_NAME = "hisab-accounting";
const STORE_NAME = "transactions";
const SQL_DATABASE_URL = "sqlite:hisab.db";

interface TauriTransactionRow {
  id: string;
  date: string;
  description: string;
  party: string;
  type: "income" | "expense";
  amount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  paymentMethod: "cash" | "bank" | "card" | "other";
  reference: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

interface TauriSqlDatabase {
  execute(query: string, bindValues?: unknown[]): Promise<unknown>;
  select<T>(query: string, bindValues?: unknown[]): Promise<T[]>;
}

let browserDatabasePromise: Promise<IDBDatabase> | undefined;
let sqliteDatabasePromise: Promise<TauriSqlDatabase> | undefined;

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window
  );
}

export function getStorageMode(): StorageMode {
  return isTauriRuntime() ? "desktop-sqlite" : "browser-indexeddb";
}

function openBrowserDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new Error("هذا المتصفح لا يدعم التخزين المحلي IndexedDB."),
    );
  }
  if (!browserDatabasePromise) {
    browserDatabasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, {
            keyPath: "id",
          });
          store.createIndex("date", "date");
          store.createIndex("type", "type");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        browserDatabasePromise = undefined;
        reject(
          request.error ??
            new Error("تعذر فتح قاعدة البيانات المحلية في المتصفح."),
        );
      };
      request.onblocked = () => {
        browserDatabasePromise = undefined;
        reject(
          new Error("أغلق علامات التبويب الأخرى التي تستخدم قاعدة حساب."),
        );
      };
    });
  }
  return browserDatabasePromise;
}

async function openSqliteDatabase(): Promise<TauriSqlDatabase> {
  if (!sqliteDatabasePromise) {
    sqliteDatabasePromise = (async () => {
      const { default: Database } = await import("@tauri-apps/plugin-sql");
      const database = await Database.load(SQL_DATABASE_URL);
      await database.execute(
        `CREATE TABLE IF NOT EXISTS transactions (
          id TEXT PRIMARY KEY NOT NULL,
          date TEXT NOT NULL,
          description TEXT NOT NULL,
          party TEXT NOT NULL DEFAULT '',
          type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
          amount REAL NOT NULL CHECK (amount > 0),
          taxRate REAL NOT NULL DEFAULT 0 CHECK (taxRate >= 0 AND taxRate <= 100),
          taxAmount REAL NOT NULL DEFAULT 0,
          total REAL NOT NULL,
          paymentMethod TEXT NOT NULL DEFAULT 'cash',
          reference TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        )`,
      );
      await database.execute(
        "CREATE INDEX IF NOT EXISTS transactions_date_idx ON transactions(date)",
      );
      return database as unknown as TauriSqlDatabase;
    })().catch((error: unknown) => {
      sqliteDatabasePromise = undefined;
      throw new Error(
        `تعذر فتح قاعدة SQLite في التطبيق المكتبي: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
  return sqliteDatabasePromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("تعذر تنفيذ عملية التخزين المحلية."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("تم إلغاء عملية التخزين."));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("تعذر حفظ البيانات محلياً."));
  });
}

export async function listTransactions(): Promise<Transaction[]> {
  if (isTauriRuntime()) {
    const database = await openSqliteDatabase();
    const rows = await database.select<TauriTransactionRow>(
      "SELECT * FROM transactions ORDER BY date DESC, createdAt DESC",
    );
    return rows.map((row) => ({
      ...row,
      amount: Number(row.amount),
      taxRate: Number(row.taxRate),
      taxAmount: Number(row.taxAmount),
      total: Number(row.total),
    }));
  }
  const database = await openBrowserDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const result = await requestResult(
    transaction.objectStore(STORE_NAME).getAll() as IDBRequest<Transaction[]>,
  );
  return result.sort(
    (left, right) =>
      right.date.localeCompare(left.date) ||
      right.createdAt.localeCompare(left.createdAt),
  );
}

export async function saveTransaction(
  input: TransactionDraft,
): Promise<Transaction> {
  const calculated = calculateTransaction(input);
  const now = new Date().toISOString();
  const existing = input.id
    ? (await listTransactions()).find((item) => item.id === input.id)
    : undefined;
  const transaction: Transaction = {
    ...calculated,
    id: input.id ?? crypto.randomUUID(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  if (isTauriRuntime()) {
    const database = await openSqliteDatabase();
    await database.execute(
      `INSERT INTO transactions (
        id, date, description, party, type, amount, taxRate, taxAmount, total,
        paymentMethod, reference, notes, createdAt, updatedAt
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT(id) DO UPDATE SET
        date = excluded.date,
        description = excluded.description,
        party = excluded.party,
        type = excluded.type,
        amount = excluded.amount,
        taxRate = excluded.taxRate,
        taxAmount = excluded.taxAmount,
        total = excluded.total,
        paymentMethod = excluded.paymentMethod,
        reference = excluded.reference,
        notes = excluded.notes,
        updatedAt = excluded.updatedAt`,
      [
        transaction.id,
        transaction.date,
        transaction.description,
        transaction.party,
        transaction.type,
        transaction.amount,
        transaction.taxRate,
        transaction.taxAmount,
        transaction.total,
        transaction.paymentMethod,
        transaction.reference,
        transaction.notes,
        transaction.createdAt,
        transaction.updatedAt,
      ],
    );
    return transaction;
  }

  const database = await openBrowserDatabase();
  const dbTransaction = database.transaction(STORE_NAME, "readwrite");
  dbTransaction.objectStore(STORE_NAME).put(transaction);
  await transactionComplete(dbTransaction);
  return transaction;
}

export async function deleteTransaction(id: string): Promise<void> {
  if (isTauriRuntime()) {
    const database = await openSqliteDatabase();
    await database.execute("DELETE FROM transactions WHERE id = $1", [id]);
    return;
  }
  const database = await openBrowserDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).delete(id);
  await transactionComplete(transaction);
}
