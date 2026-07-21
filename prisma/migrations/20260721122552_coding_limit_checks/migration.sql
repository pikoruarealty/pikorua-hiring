-- Defense-in-depth CHECK constraints for admin-set coding limits.
-- These mirror the zod validation ranges (time 1-15s, memory 16-512MB) at the DB layer.
ALTER TABLE "CodingQuestionConfig"
  ADD CONSTRAINT "CodingQuestionConfig_timeLimitSeconds_check"
  CHECK ("timeLimitSeconds" BETWEEN 1 AND 15);

ALTER TABLE "CodingQuestionConfig"
  ADD CONSTRAINT "CodingQuestionConfig_memoryLimitMb_check"
  CHECK ("memoryLimitMb" BETWEEN 16 AND 512);