export const BUDGET_CATEGORIES = ['Transportation', 'Lodging', 'Food', 'Activities', 'Shopping', 'Other'] as const;
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];

export const EXPENSE_CATEGORIES = ['Lodging', 'Food', 'Transportation', 'Activities', 'Shopping', 'Tickets', 'Gas', 'Other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** Expense categories roll up into budget categories. */
export const BUDGET_ROLLUP: Record<ExpenseCategory, BudgetCategory> = {
  Lodging: 'Lodging',
  Food: 'Food',
  Transportation: 'Transportation',
  Gas: 'Transportation',
  Activities: 'Activities',
  Tickets: 'Activities',
  Shopping: 'Shopping',
  Other: 'Other',
};

export type BudgetStatus = 'under' | 'near' | 'over' | 'none';

export const DEFAULT_NEAR_PCT = 80;

export interface BudgetLine {
  category: BudgetCategory | 'Total';
  budgetCents: number;
  actualCents: number;
  remainingCents: number; // negative when over
  percentUsed: number; // whole percent, floor
  status: BudgetStatus;
  message: string;
}

export function budgetStatus(budget: number, actual: number, nearPct = DEFAULT_NEAR_PCT): BudgetStatus {
  if (budget <= 0) return 'none';
  if (actual > budget) return 'over';
  if (actual * 100 >= budget * nearPct) return 'near'; // integer math
  return 'under';
}

function message(label: string, pct: number, status: BudgetStatus): string {
  switch (status) {
    case 'over':
      return `You're ${pct - 100}% past your ${label} budget.`;
    case 'near':
      return `You've used ${pct}% of your ${label} budget.`;
    case 'under':
      return `${pct}% of your ${label} budget used. Plenty of room.`;
    default:
      return `No ${label} budget set.`;
  }
}

export function budgetLine(category: BudgetLine['category'], budgetCents: number, actualCents: number, nearPct = DEFAULT_NEAR_PCT): BudgetLine {
  const status = budgetStatus(budgetCents, actualCents, nearPct);
  const percentUsed = budgetCents > 0 ? Math.floor((actualCents * 100) / budgetCents) : 0;
  return {
    category,
    budgetCents,
    actualCents,
    remainingCents: budgetCents - actualCents,
    percentUsed,
    status,
    message: message(category === 'Total' ? 'trip' : category.toLowerCase(), percentUsed, status),
  };
}

export interface BudgetRow {
  category: BudgetCategory | null; // null = total budget
  amountCents: number;
  currency: string;
}
export interface BudgetExpense {
  category: ExpenseCategory;
  amountCents: number;
  currency: string;
}

export interface BudgetSummary {
  currency: string | null;
  total: BudgetLine | null;
  categories: BudgetLine[];
  /** Expenses in a different currency than the budget are excluded, never converted. */
  excludedForeignCurrency: number;
}

export function summarizeBudget(budgets: BudgetRow[], expenses: BudgetExpense[], nearPct = DEFAULT_NEAR_PCT): BudgetSummary {
  const currency = budgets[0]?.currency ?? null;
  const counted = expenses.filter((e) => e.currency === currency);
  const actualFor = (cat: BudgetCategory) =>
    counted.filter((e) => BUDGET_ROLLUP[e.category] === cat).reduce((a, e) => a + e.amountCents, 0);
  const totalActual = counted.reduce((a, e) => a + e.amountCents, 0);
  const totalRow = budgets.find((b) => b.category === null);
  return {
    currency,
    total: totalRow ? budgetLine('Total', totalRow.amountCents, totalActual, nearPct) : null,
    categories: budgets
      .filter((b): b is BudgetRow & { category: BudgetCategory } => b.category !== null)
      .sort((a, b) => BUDGET_CATEGORIES.indexOf(a.category) - BUDGET_CATEGORIES.indexOf(b.category))
      .map((b) => budgetLine(b.category, b.amountCents, actualFor(b.category), nearPct)),
    excludedForeignCurrency: expenses.length - counted.length,
  };
}
