import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Login questions: yes/no questions a participant answers when they sign in.
 *
 * An answer is stored once per user and question and is final — the point is
 * a statistic the administrator can later attach a bonus or malus to, and an
 * answer that could be changed after the bonus was announced would be a bet
 * placed after the race. A question can be opened for change explicitly, from
 * the admin page; nothing else edits an answer.
 *
 * Kept out of the server actions so the rules can be tested.
 */

export interface PendingQuestion {
  id: string;
  prompt: string;
  yesLabel: string;
  noLabel: string;
}

/** Active questions this user has not answered yet, in display order. */
export async function pendingQuestions(
  db: PrismaClient,
  userId: string,
): Promise<PendingQuestion[]> {
  return db.surveyQuestion.findMany({
    where: { isActive: true, answers: { none: { userId } } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, prompt: true, yesLabel: true, noLabel: true },
  });
}

export type RecordResult = { ok: true; recorded: number } | { ok: false; error: string };

/**
 * Records answers. A first answer to an active question is always accepted; a
 * change is accepted only where the question allows it. Anything else is
 * refused as a whole, so a tampered request cannot half-apply.
 */
export async function recordAnswers(
  db: PrismaClient,
  userId: string,
  answers: { questionId: string; answer: boolean }[],
): Promise<RecordResult> {
  if (answers.length === 0) return { ok: false, error: "Answer the questions before continuing." };
  if (new Set(answers.map((a) => a.questionId)).size !== answers.length) {
    return { ok: false, error: "Each question can be answered once." };
  }

  const questions = await db.surveyQuestion.findMany({
    where: { id: { in: answers.map((a) => a.questionId) } },
    include: { answers: { where: { userId } } },
  });
  const byId = new Map(questions.map((q) => [q.id, q]));

  for (const { questionId } of answers) {
    const question = byId.get(questionId);
    if (!question || !question.isActive) {
      return {
        ok: false,
        error: "One of these questions is no longer being asked. Reload the page and try again.",
      };
    }
    if (question.answers.length > 0 && !question.allowChange) {
      return {
        ok: false,
        error: `Your answer to “${question.prompt}” is final and cannot be changed.`,
      };
    }
  }

  await db.$transaction(async (tx) => {
    for (const { questionId, answer } of answers) {
      const previous = byId.get(questionId)?.answers[0];
      if (!previous) {
        await tx.surveyAnswer.create({ data: { questionId, userId, answer } });
      } else if (previous.answer !== answer) {
        await tx.surveyAnswer.update({
          where: { id: previous.id },
          data: { answer, answeredAt: new Date(), changeCount: { increment: 1 } },
        });
      }
    }
  });
  return { ok: true, recorded: answers.length };
}

export interface QuestionStats {
  id: string;
  prompt: string;
  yesLabel: string;
  noLabel: string;
  isActive: boolean;
  allowChange: boolean;
  yes: number;
  no: number;
  /** Participants in the competition who have not answered. */
  unanswered: number;
  /** Mean total return, in ppm, of each group's ranked participants; null if none. */
  yesMeanReturnPpm: number | null;
  noMeanReturnPpm: number | null;
}

/**
 * Counts per answer among a competition's participants, and each group's mean
 * return from the latest daily leaderboard — the numbers an administrator
 * decides a bonus or malus on.
 */
export async function questionStats(
  db: PrismaClient,
  competitionId: string,
): Promise<QuestionStats[]> {
  const [questions, participants, snapshot] = await Promise.all([
    db.surveyQuestion.findMany({
      orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      include: { answers: { select: { userId: true, answer: true } } },
    }),
    db.participant.findMany({
      where: { competitionId, deletedAt: null, user: { aiInvestor: { is: null } } },
      select: { id: true, userId: true },
    }),
    db.leaderboardSnapshot.findFirst({
      where: { competitionId, kind: "DAILY" },
      orderBy: { asOfDate: "desc" },
      select: {
        entries: {
          where: { isRanked: true },
          select: { participantId: true, totalReturnPpm: true },
        },
      },
    }),
  ]);

  const userIds = new Set(participants.map((p) => p.userId));
  const participantOf = new Map(participants.map((p) => [p.userId, p.id]));
  const returnOf = new Map(
    (snapshot?.entries ?? []).map((e) => [e.participantId, e.totalReturnPpm]),
  );
  const mean = (values: number[]) =>
    values.length === 0 ? null : Math.round(values.reduce((a, b) => a + b, 0) / values.length);

  return questions.map((q) => {
    const answers = q.answers.filter((a) => userIds.has(a.userId));
    const returnsFor = (answer: boolean) =>
      answers
        .filter((a) => a.answer === answer)
        .flatMap((a) => {
          const r = returnOf.get(participantOf.get(a.userId) ?? "");
          return r === undefined ? [] : [r];
        });
    const yes = answers.filter((a) => a.answer).length;
    return {
      id: q.id,
      prompt: q.prompt,
      yesLabel: q.yesLabel,
      noLabel: q.noLabel,
      isActive: q.isActive,
      allowChange: q.allowChange,
      yes,
      no: answers.length - yes,
      unanswered: participants.length - answers.length,
      yesMeanReturnPpm: mean(returnsFor(true)),
      noMeanReturnPpm: mean(returnsFor(false)),
    };
  });
}

export const ANSWER_EXPORT_HEADERS = [
  "email",
  "first_name",
  "last_name",
  "department",
  "display_name",
  "question_id",
  "question",
  "answer",
  "answered_yes",
  "answered_at",
  "change_count",
] as const;

/**
 * Every answer from this competition's participants, one row per person and
 * question, keyed by email like the rest of the backup so it survives ids being
 * regenerated. Shared by the daily backup and the admin page's download.
 */
export async function answerExportRows(
  db: PrismaClient,
  competitionId: string,
): Promise<unknown[][]> {
  const participants = await db.participant.findMany({
    where: { competitionId, deletedAt: null },
    orderBy: { displayName: "asc" },
    select: {
      displayName: true,
      user: {
        select: {
          email: true,
          firstName: true,
          lastName: true,
          department: true,
          surveyAnswers: {
            orderBy: { answeredAt: "asc" },
            include: { question: true },
          },
        },
      },
    },
  });
  return participants.flatMap((p) =>
    p.user.surveyAnswers.map((a) => [
      p.user.email,
      p.user.firstName,
      p.user.lastName,
      p.user.department ?? "",
      p.displayName,
      a.questionId,
      a.question.prompt,
      a.answer ? a.question.yesLabel : a.question.noLabel,
      a.answer,
      a.answeredAt,
      a.changeCount,
    ]),
  );
}
