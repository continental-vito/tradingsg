"use client";

import { useState, useTransition } from "react";
import { Alert, Button } from "@/components/ui";
import type { AnswerResult } from "@/app/actions/survey";

export interface QuestionView {
  id: string;
  prompt: string;
  yesLabel: string;
  noLabel: string;
}

function Choice({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={
        "flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors " +
        (selected
          ? "border-accent-600 bg-accent-600 text-white"
          : "border-[var(--border)] bg-[var(--surface-raised)] hover:bg-[var(--surface-sunken)]")
      }
    >
      {children}
    </button>
  );
}

/**
 * Two buttons per question rather than a checkbox: an unticked box is
 * indistinguishable from "no", and here not answering and answering "no" are
 * different facts.
 */
export function QuestionsForm({
  questions,
  submit,
  initial = {},
  next = "dashboard",
  submitLabel = "Continue",
}: {
  questions: QuestionView[];
  submit: (answers: unknown, next?: "dashboard" | "account") => Promise<AnswerResult>;
  initial?: Record<string, boolean>;
  next?: "dashboard" | "account";
  submitLabel?: string;
}) {
  const [answers, setAnswers] = useState<Record<string, boolean>>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const complete = questions.every((q) => answers[q.id] !== undefined);

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          setSaved(false);
          const result = await submit(
            questions.map((q) => ({ questionId: q.id, answer: answers[q.id] })),
            next,
          );
          if (result.ok) setSaved(true);
          else setError(result.error ?? "Your answers could not be saved. Try again.");
        });
      }}
    >
      {error ? <Alert>{error}</Alert> : null}
      {saved && next === "account" ? <Alert tone="success">Saved.</Alert> : null}
      {questions.map((q, i) => (
        <fieldset key={q.id}>
          <legend className="mb-2 text-sm font-medium">
            {questions.length > 1 ? `${i + 1}. ` : ""}
            {q.prompt}
          </legend>
          <div className="flex gap-2">
            <Choice
              selected={answers[q.id] === true}
              onClick={() => setAnswers((a) => ({ ...a, [q.id]: true }))}
            >
              {q.yesLabel}
            </Choice>
            <Choice
              selected={answers[q.id] === false}
              onClick={() => setAnswers((a) => ({ ...a, [q.id]: false }))}
            >
              {q.noLabel}
            </Choice>
          </div>
        </fieldset>
      ))}
      <Button type="submit" disabled={!complete || pending} className="w-full">
        {pending ? "Saving…" : complete ? submitLabel : "Answer every question to continue"}
      </Button>
    </form>
  );
}
