import type { Metadata } from "next";
import Link from "next/link";
import { changePasswordAction, updateProfileAction } from "@/app/actions/account";
import { PasswordForm, ProfileForm } from "@/components/account-forms";
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

      <Card>
        <h2 className="text-sm font-medium">Email address</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Your address is <strong>{record.email}</strong> and cannot be changed here — it is what
          identifies you in the competition, in every backup, and in the audit trail. Ask an
          administrator if it needs to change.
        </p>
      </Card>

      <Card>
        <h2 className="text-sm font-medium">Notifications</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          What you are told about, and whether it reaches your inbox, is on the{" "}
          <Link href="/notifications" className="font-medium text-accent-600 hover:text-accent-700">
            notifications page
          </Link>
          .
        </p>
      </Card>
    </div>
  );
}
