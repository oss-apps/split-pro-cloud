-- Groups were always created as USD. Use the currency the group's expenses use most (the latest
-- one on a tie), or else the creator's currency.
UPDATE "Group" g
SET "defaultCurrency" = COALESCE(
  (
    SELECT e."currency"
    FROM "Expense" e
    WHERE e."groupId" = g."id" AND e."deletedAt" IS NULL
    GROUP BY e."currency"
    ORDER BY COUNT(*) DESC, MAX(e."createdAt") DESC
    LIMIT 1
  ),
  (SELECT u."currency" FROM "User" u WHERE u."id" = g."userId"),
  g."defaultCurrency"
)
WHERE g."defaultCurrency" = 'USD';
