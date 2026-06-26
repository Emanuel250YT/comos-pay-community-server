-- AlterTable
ALTER TABLE "payment_intent" DROP COLUMN "memoType",
ALTER COLUMN "memo" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "payment_intent_consumerId_memo_key" ON "payment_intent"("consumerId", "memo");
