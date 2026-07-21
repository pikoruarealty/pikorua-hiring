-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'PARTICIPANT');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MCQ', 'TEXT', 'CODING');

-- CreateEnum
CREATE TYPE "ContestVisibility" AS ENUM ('INVITE_ONLY', 'OPEN');

-- CreateEnum
CREATE TYPE "ContestStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'LIVE', 'ENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('INVITED', 'REGISTERED', 'IN_PROGRESS', 'SUBMITTED', 'AUTO_SUBMITTED', 'LOCKED_OUT');

-- CreateEnum
CREATE TYPE "QuestionDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "AttemptType" AS ENUM ('RUN', 'SUBMIT');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('PENDING', 'QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'PARTIAL', 'ERROR', 'TIME_LIMIT_EXCEEDED', 'RATE_LIMITED', 'LOCKED');

-- CreateEnum
CREATE TYPE "ProctoringEventType" AS ENUM ('FULLSCREEN_EXIT', 'TAB_BLUR', 'VISIBILITY_HIDDEN', 'DEVTOOLS_ATTEMPT', 'RIGHT_CLICK', 'COPY_PASTE', 'PRINT_ATTEMPT', 'MULTI_MONITOR_DETECTED', 'FOCUS_RETURN');

-- CreateEnum
CREATE TYPE "ProctoringAction" AS ENUM ('NONE', 'WARNED', 'AUTO_SUBMITTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'PARTICIPANT',
    "fullName" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "sessionVersion" INTEGER NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contest" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "instructions" TEXT,
    "visibility" "ContestVisibility" NOT NULL DEFAULT 'INVITE_ONLY',
    "status" "ContestStatus" NOT NULL DEFAULT 'DRAFT',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "resultsVisibleToParticipants" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestParticipant" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ParticipantStatus" NOT NULL DEFAULT 'INVITED',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registeredAt" TIMESTAMP(3),
    "contestStartedAt" TIMESTAMP(3),
    "contestSubmittedAt" TIMESTAMP(3),
    "autoSubmittedReason" TEXT,
    "totalScore" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "tieBreakExecutionTimeMs" INTEGER,

    CONSTRAINT "ContestParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "defaultPoints" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "difficulty" "QuestionDifficulty",
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Option" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "score" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Option_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TextAnswerConfig" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "correctAnswer" TEXT NOT NULL,

    CONSTRAINT "TextAnswerConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodingQuestionConfig" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "timeLimitSeconds" INTEGER NOT NULL,
    "memoryLimitMb" INTEGER NOT NULL,
    "allowedLanguages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "starterCode" JSONB,
    "defaultHardLockSeconds" INTEGER,
    "solutionCode" JSONB,

    CONSTRAINT "CodingQuestionConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCase" (
    "id" TEXT NOT NULL,
    "codingConfigId" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "expectedOutput" TEXT NOT NULL,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "score" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TestCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestQuestion" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "pointsOverride" DECIMAL(10,2),
    "hardLockSecondsOverride" INTEGER,
    "sectionLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContestQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL,
    "contestParticipantId" TEXT NOT NULL,
    "contestQuestionId" TEXT NOT NULL,
    "attemptType" "AttemptType" NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'PENDING',
    "language" TEXT,
    "code" TEXT,
    "testCaseResults" JSONB,
    "totalExecutionTimeMs" INTEGER,
    "selectedOptionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "textAnswer" TEXT,
    "score" DECIMAL(10,2),
    "maxPossibleScore" DECIMAL(10,2),
    "submittedAt" TIMESTAMP(3),
    "bullJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProctoringEvent" (
    "id" TEXT NOT NULL,
    "contestParticipantId" TEXT NOT NULL,
    "eventType" "ProctoringEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientTimestamp" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "cumulativeCountAtEvent" INTEGER NOT NULL,
    "actionTaken" "ProctoringAction" NOT NULL DEFAULT 'NONE',

    CONSTRAINT "ProctoringEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "diff" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Contest_status_startAt_idx" ON "Contest"("status", "startAt");

-- CreateIndex
CREATE INDEX "Contest_visibility_idx" ON "Contest"("visibility");

-- CreateIndex
CREATE INDEX "ContestParticipant_contestId_totalScore_idx" ON "ContestParticipant"("contestId", "totalScore" DESC);

-- CreateIndex
CREATE INDEX "ContestParticipant_contestId_status_idx" ON "ContestParticipant"("contestId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ContestParticipant_contestId_userId_key" ON "ContestParticipant"("contestId", "userId");

-- CreateIndex
CREATE INDEX "Question_type_idx" ON "Question"("type");

-- CreateIndex
CREATE INDEX "Question_isArchived_idx" ON "Question"("isArchived");

-- CreateIndex
CREATE INDEX "Option_questionId_order_idx" ON "Option"("questionId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "TextAnswerConfig_questionId_key" ON "TextAnswerConfig"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "CodingQuestionConfig_questionId_key" ON "CodingQuestionConfig"("questionId");

-- CreateIndex
CREATE INDEX "TestCase_codingConfigId_order_idx" ON "TestCase"("codingConfigId", "order");

-- CreateIndex
CREATE INDEX "ContestQuestion_contestId_order_idx" ON "ContestQuestion"("contestId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ContestQuestion_contestId_questionId_key" ON "ContestQuestion"("contestId", "questionId");

-- CreateIndex
CREATE INDEX "Attempt_contestQuestionId_attemptType_status_idx" ON "Attempt"("contestQuestionId", "attemptType", "status");

-- CreateIndex
CREATE INDEX "Attempt_submittedAt_idx" ON "Attempt"("submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Attempt_contestParticipantId_contestQuestionId_attemptType_key" ON "Attempt"("contestParticipantId", "contestQuestionId", "attemptType");

-- CreateIndex
CREATE INDEX "ProctoringEvent_contestParticipantId_occurredAt_idx" ON "ProctoringEvent"("contestParticipantId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contest" ADD CONSTRAINT "Contest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestParticipant" ADD CONSTRAINT "ContestParticipant_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestParticipant" ADD CONSTRAINT "ContestParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Option" ADD CONSTRAINT "Option_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TextAnswerConfig" ADD CONSTRAINT "TextAnswerConfig_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodingQuestionConfig" ADD CONSTRAINT "CodingQuestionConfig_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_codingConfigId_fkey" FOREIGN KEY ("codingConfigId") REFERENCES "CodingQuestionConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestQuestion" ADD CONSTRAINT "ContestQuestion_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestQuestion" ADD CONSTRAINT "ContestQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_contestParticipantId_fkey" FOREIGN KEY ("contestParticipantId") REFERENCES "ContestParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_contestQuestionId_fkey" FOREIGN KEY ("contestQuestionId") REFERENCES "ContestQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProctoringEvent" ADD CONSTRAINT "ProctoringEvent_contestParticipantId_fkey" FOREIGN KEY ("contestParticipantId") REFERENCES "ContestParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
