/** Cost snapshots follow the same per-business visibility rule as catalog costs. */
const canViewCostPrice = (businessRole) => ["SUPERADMIN", "ADMIN"].includes(businessRole);

const stripItemCostPrice = ({ costPrice, ...item }) => item;

/** Default to hiding costs, including when a service is called without options. */
const withTransactionCostVisibility = (transaction, { includeCostPrice = false } = {}) => {
  if (includeCostPrice) return transaction;
  return { ...transaction, items: transaction.items.map(stripItemCostPrice) };
};

module.exports = { canViewCostPrice, stripItemCostPrice, withTransactionCostVisibility };
