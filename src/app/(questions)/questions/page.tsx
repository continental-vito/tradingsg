import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { submitAnswersAction } from "@/app/actions/survey";
import { AuthShell } from "@/components/auth-shell";
import { QuestionsForm } from "@/components/questions-form";
import { requireUser } from "@/server/auth/guard";
import { db } from "@/server/db";
import { pendingQuestions } from "@/server/survey/questions";

export const metadata: Metadata = { title: "A few quick questions" };
export const dynamic = "force-dynamic";

export default async function QuestionsPage() {
  const user = await requireUser();
  if (user.role === "ADMIN") redirect("/admin");

  const questions = await pendingQuestions(db, user.id);
  if (questions.length === 0) redirect("/dashboard");

  return (
    <AuthShell
      title="A few quick questions"
      subtitle="Answer before you continue. Your answers are recorded once and cannot be changed afterwards."
    >
      <QuestionsForm questions={questions} submit={submitAnswersAction} />
    </AuthShell>
  );
}
