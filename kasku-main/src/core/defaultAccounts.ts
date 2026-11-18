import type { Account, AppSettings } from './types';

export const DEFAULT_ACCOUNTS: Account[] = [
  { id: 'acc-1101', code: '1101', name: 'Kas', type: 'ASSET', normal_balance: 'DEBIT', is_active: true, is_wallet: true },
  { id: 'acc-1102', code: '1102', name: 'Bank', type: 'ASSET', normal_balance: 'DEBIT', is_active: true, is_wallet: true },
  { id: 'acc-1103', code: '1103', name: 'E-Wallet', type: 'ASSET', normal_balance: 'DEBIT', is_active: true, is_wallet: true },
  { id: 'acc-1201', code: '1201', name: 'Piutang', type: 'ASSET', normal_balance: 'DEBIT', is_active: true },
  { id: 'acc-1501', code: '1501', name: 'Peralatan', type: 'ASSET', normal_balance: 'DEBIT', is_active: true },
  { id: 'acc-2101', code: '2101', name: 'Utang', type: 'LIABILITY', normal_balance: 'CREDIT', is_active: true },
  { id: 'acc-2102', code: '2102', name: 'Utang Paylater', type: 'LIABILITY', normal_balance: 'CREDIT', is_active: true },
  { id: 'acc-3101', code: '3101', name: 'Modal Awal', type: 'EQUITY', normal_balance: 'CREDIT', is_active: true },
  { id: 'acc-3102', code: '3102', name: 'Prive', type: 'EQUITY', normal_balance: 'DEBIT', is_active: true },
  { id: 'acc-4101', code: '4101', name: 'Pendapatan Usaha', type: 'REVENUE', normal_balance: 'CREDIT', is_active: true },
  { id: 'acc-4102', code: '4102', name: 'Uang Saku', type: 'REVENUE', normal_balance: 'CREDIT', is_active: true },
  { id: 'acc-5101', code: '5101', name: 'Makan', type: 'EXPENSE', normal_balance: 'DEBIT', is_active: true },
  { id: 'acc-5102', code: '5102', name: 'Transport', type: 'EXPENSE', normal_balance: 'DEBIT', is_active: true },
  { id: 'acc-5103', code: '5103', name: 'Pulsa/Internet', type: 'EXPENSE', normal_balance: 'DEBIT', is_active: true },
  { id: 'acc-5104', code: '5104', name: 'Kos', type: 'EXPENSE', normal_balance: 'DEBIT', is_active: true },
  { id: 'acc-5105', code: '5105', name: 'Pendidikan', type: 'EXPENSE', normal_balance: 'DEBIT', is_active: true },
  { id: 'acc-5106', code: '5106', name: 'Admin Bank', type: 'EXPENSE', normal_balance: 'DEBIT', is_active: true },
  { id: 'acc-5107', code: '5107', name: 'Hiburan', type: 'EXPENSE', normal_balance: 'DEBIT', is_active: true },
  { id: 'acc-5108', code: '5108', name: 'Kesehatan', type: 'EXPENSE', normal_balance: 'DEBIT', is_active: true },
  { id: 'acc-5109', code: '5109', name: 'Lain-lain', type: 'EXPENSE', normal_balance: 'DEBIT', is_active: true },
];

export const DEFAULT_SETTINGS: AppSettings = {
  ownerName: 'Dzaki Rafi',
  businessName: 'BukuKu Pribadi & Usaha',
  pinEnabled: false,
  pinHash: null,
  spreadsheetId: '',
};
