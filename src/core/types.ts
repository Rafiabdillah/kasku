export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

export type NormalBalance = 'DEBIT' | 'CREDIT';

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  normal_balance: NormalBalance;
  is_active: boolean;
  is_wallet?: boolean;
}

export type JournalKind = 'biasa' | 'saldo_awal' | 'pembalik';

export type TransactionActionType =
  | 'masuk'
  | 'keluar'
  | 'pindah'
  | 'belanja_utang'
  | 'bayar_utang'
  | 'pinjamkan'
  | 'dilunasi'
  | 'saldo_awal';

export interface TransactionMeta {
  actionType: TransactionActionType;
  amount: number;
  adminFee?: number;
  walletId?: string;
  toWalletId?: string;
  categoryAccountId?: string;
  counterparty?: string;
}

export interface Journal {
  id: string;
  date: string; // YYYY-MM-DD local calendar date (never UTC)
  number: string; // e.g., JU-0001
  description: string;
  created_at: string; // UTC ISO timestamp
  voided_at: string | null;
  void_of_id?: string | null;
  reversal_journal_id?: string | null;
  kind: JournalKind;
  tx_meta?: TransactionMeta;
}

export interface JournalLine {
  id: string;
  journal_id: string;
  account_id: string;
  debit: number; // integer rupiah >= 0
  credit: number; // integer rupiah >= 0
  memo: string;
}

export interface AppSettings {
  ownerName: string;
  businessName: string;
  pinEnabled: boolean;
  pinHash: string | null;
  pinSalt?: string | null;
  spreadsheetId: string;
}

export interface RecurringRule {
  id: string;
  description: string;
  actionType: 'masuk' | 'keluar';
  amount: number; // integer rupiah > 0
  walletId: string;
  categoryAccountId: string;
  dayOfMonth: number; // 1..31
  isActive: boolean;
  lastGeneratedMonth: string | null; // YYYY-MM
}

export interface CloudLink {
  uid: string;
  revision: number;
  baselineHash: string;
  lastSyncedAt: string;
}

export interface LedgerDatabase {
  cloudLink?: CloudLink;
  version: number;
  accounts: Account[];
  journals: Journal[];
  journalLines: JournalLine[];
  settings: AppSettings;
  budgets?: Record<string, number>; // account_id -> integer rupiah monthly budget
  recurringRules?: RecurringRule[];
}

export interface TransactionInput {
  actionType: TransactionActionType;
  amount: number;
  adminFee?: number;
  walletId?: string;
  toWalletId?: string;
  categoryAccountId?: string;
  date: string; // YYYY-MM-DD
  description: string;
  counterparty?: string;
}

export interface JurnalUmumEntry {
  journal: Journal;
  lines: Array<{
    line: JournalLine;
    account: Account;
  }>;
  totalDebit: number;
  totalCredit: number;
}

export interface BukuBesarRow {
  journalId: string;
  journalNumber: string;
  date: string;
  description: string;
  memo: string;
  ref: string;
  debit: number;
  credit: number;
  runningBalance: number;
  isVoided: boolean;
  kind: JournalKind;
}

export interface NeracaSaldoRow {
  account: Account;
  debit: number;
  credit: number;
  netBalance: number;
}

export interface NeracaReport {
  upToDate: string;
  assets: Array<{ account: Account; amount: number }>;
  liabilities: Array<{ account: Account; amount: number }>;
  equities: Array<{ account: Account; amount: number }>; // positive increases equity, Prive negative
  currentNetProfit: number;
  totalAssets: number;
  totalLiabilities: number;
  totalEquityWithProfit: number;
  totalLiabilitiesAndEquity: number;
  isBalanced: boolean;
}

export interface LabaRugiReport {
  month: string; // YYYY-MM
  revenues: Array<{ account: Account; amount: number }>;
  expenses: Array<{ account: Account; amount: number }>;
  totalRevenue: number;
  totalExpense: number;
  netProfit: number;
}

export interface CounterpartyLedgerItem {
  key: string;
  counterparty: string;
  kind: 'piutang' | 'utang';
  accountId: string;
  accountCode: string;
  accountName: string;
  totalAdded: number;
  totalSettled: number;
  remaining: number;
  lastDate: string;
}

export interface BudgetProgressItem {
  account: Account;
  budget: number;
  spent: number;
  remaining: number;
  percentUsed: number;
  status: 'aman' | 'mendekati' | 'melebihi';
}
