-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "allowMultipleAnswers" BOOLEAN NOT NULL DEFAULT true;

-- Backfill: existing MCQ questions authored with exactly one positively-scored
-- option were, in effect, single-answer questions before this toggle existed —
-- default those to radio-button (false) so their participant-facing behavior
-- doesn't silently change. Anything else (0, 2+ positively-scored options)
-- keeps the multi-select checkbox default.
UPDATE "Question" q
SET "allowMultipleAnswers" = false
WHERE q."type" = 'MCQ'
  AND (
    SELECT COUNT(*) FROM "Option" o WHERE o."questionId" = q.id AND o."score" > 0
  ) = 1;
