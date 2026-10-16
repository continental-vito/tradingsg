import type { Metadata } from "next";
import { changePasswordAction, updateProfileAction } from "@/app/actions/account";
import { submitAnswersAction } from "@/app/actions/survey";
import { PasswordForm, ProfileForm } from "@/components/account-forms";
import { QuestionsForm } from "@/components/questions-form";
import { Card } from "@/components/ui";
import { requireUser } from "@/server/auth/guard";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Account" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUser();

  const [record, participant, sessions] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { firstName: true, lastName: true, department: true, email: true, createdAt: true },
    }),
    db.participant.findFirst({
      where: { userId: user.id, deletedAt: null },
      orderBy: { joinedAt: "desc" },
      select: { displayName: true },
    }),
    db.session.count({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    }),
  ]);

  const answers =
    user.role === "ADMIN"
      ? []
      : await db.surveyAnswer.findMany({
          where: { userId: user.id },
          orderBy: { answeredAt: "asc" },
          include: { question: true },
        });
  const changeable = answers.filter((a) => a.question.allowChange && a.question.isActive);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your account</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {record.email} · joined {record.createdAt.toISOString().slice(0, 10)} · {sessions} active
          session{sessions === 1 ? "" : "s"}
        </p>
      </div>

      <Card>
        <h2 className="mb-4 text-sm font-medium">Details</h2>
        <ProfileForm
          initial={{
            firstName: record.firstName,
            lastName: record.lastName,
            department: record.department ?? "",
            displayName: participant?.displayName ?? "",
          }}
          save={updateProfileAction}
        />
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-medium">Password</h2>
        <PasswordForm change={changePasswordAction} />
      </Card>

      {answers.length > 0 ? (
        <Card>
          <h2 className="text-sm font-medium">Your answers</h2>
          <p className="mt-1 mb-4 text-sm text-[var(--text-muted)]">
            What you answered when you signed in. Answers are final unless the competition&rsquo;s
            administrator has opened a question for change.
          </p>
          <ul className="space-y-2 text-sm">
            {answers
              .filter((a) => !changeable.includes(a))
              .map((a) => (
                <li key={a.id} className="flex justify-between gap-4">
                  <span>{a.question.prompt}</span>
                  <span className="shrink-0 font-medium">
                    {a.answer ? a.question.yesLabel : a.question.noLabel}
                  </span>
                </li>
              ))}
          </ul>
          {changeable.length > 0 ? (
            <div className="mt-4 border-t border-[var(--border)] pt-4">
              <QuestionsForm
                questions={changeable.map(({ question: q }) => ({
                  id: q.id,
                  prompt: q.prompt,
                  yesLabel: q.yesLabel,
                  noLabel: q.noLabel,
                }))}
                initial={Object.fromEntries(changeable.map((a) => [a.questionId, a.answer]))}
                submit={submitAnswersAction}
                next="account"
                submitLabel="Save my answers"
              />
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <h2 className="text-sm font-medium">Email address</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Your address is <strong>{record.email}</strong> and cannot be changed here — it is what
          identifies you in the competition, in every backup, and in the audit trail. Ask an
          administrator if it needs to change.
        </p>
      </Card>
    </div>
  );
}
