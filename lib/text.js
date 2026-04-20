function truncateToTokenBudget(text, tokenBudget) {
  const charLimit = tokenBudget * 4;
  if (text.length > charLimit) {
    return `${text.slice(0, charLimit)}\n\n[...TRUNCATED DUE TO TOKEN BUDGET...]`;
  }
  return text;
}

module.exports = {
  truncateToTokenBudget,
};
