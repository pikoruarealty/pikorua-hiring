import { QuestionsClient } from "@/components/questions/questions-client";

export const metadata = { title: "Question bank · Assessment Admin" };

export default function QuestionsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Question bank</h1>
        <p className="text-muted-foreground">
          Author reusable MCQ, text-answer, and coding questions. Attach them to
          contests from the contest builder.
        </p>
      </div>
      <QuestionsClient />
    </div>
  );
}
