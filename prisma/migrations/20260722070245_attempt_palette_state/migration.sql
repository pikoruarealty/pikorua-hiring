-- AlterTable
ALTER TABLE "Attempt" ADD COLUMN     "markedForReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "visited" BOOLEAN NOT NULL DEFAULT false;
