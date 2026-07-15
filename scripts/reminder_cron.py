"""Queue idempotent in-app report reminders.

Run from a trusted scheduler with DATABASE_URL. The job never installs packages
at runtime and never invokes an external messaging channel.
"""

from __future__ import annotations

import asyncio
import os

import asyncpg
from dotenv import load_dotenv


LOCK_KEY = 7_202_607_14


QUEUE_SQL = r"""
with scoped_reports as (
  select
    period.id as period_id,
    period.name as period_name,
    period.due_date,
    village.id as village_id,
    village.name as village_name,
    case
      when now() > period.due_date then 'overdue'
      when period.due_date - now() <= interval '1 day' then 'one_day'
      else 'three_days'
    end as milestone
  from report_periods as period
  join report_period_villages as scope on scope.period_id = period.id
  join villages as village on village.id = scope.village_id and village.is_active
  left join reports as report
    on report.period_id = period.id and report.village_id = village.id
  where (report.id is null or report.workflow_status in ('draft', 'needs_revision'))
    and period.due_date >= now() - interval '14 days'
    and period.due_date <= now() + interval '3 days'
), recipients as (
  select distinct
    scoped.*,
    profile.id as user_id
  from scoped_reports as scoped
  join user_profiles as profile
    on profile.is_active
   and not profile.force_password_reset
   and profile.role in ('can_bo_thon', 'to_cnscd')
   and (
     profile.village_id = scoped.village_id
     or exists (
       select 1
       from user_village_assignments as assignment
       where assignment.user_id = profile.id
         and assignment.village_id = scoped.village_id
     )
   )
), inserted as (
  insert into reminder_log (
    period_id, village_id, recipient_user_id, milestone, delivery_status
  )
  select period_id, village_id, user_id, milestone, 'queued'
  from recipients
  on conflict do nothing
  returning period_id, village_id, recipient_user_id, milestone
)
insert into notifications (user_id, title, body, url)
select
  recipient.user_id,
  case when recipient.milestone = 'overdue'
       then 'Báo cáo đã quá hạn'
       else 'Nhắc hạn nộp báo cáo' end,
  case
    when recipient.milestone = 'overdue'
      then format('%s chưa hoàn tất kỳ %s.', recipient.village_name, recipient.period_name)
    else format('%s cần hoàn tất kỳ %s trước %s.',
      recipient.village_name,
      recipient.period_name,
      to_char(recipient.due_date at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI'))
  end,
  format('/?tab=report-form&period_id=%s', recipient.period_id)
from recipients as recipient
join inserted
  on inserted.period_id = recipient.period_id
 and inserted.village_id = recipient.village_id
 and inserted.recipient_user_id = recipient.user_id
 and inserted.milestone = recipient.milestone
returning id
"""


async def run() -> int:
    load_dotenv()
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        print("Reminder job skipped: DATABASE_URL is not configured.")
        return 2

    try:
        conn = await asyncpg.connect(database_url, command_timeout=60)
    except Exception:
        print("Reminder job failed to connect. See secured scheduler logs.")
        return 1

    try:
        acquired = await conn.fetchval("select pg_try_advisory_lock($1)", LOCK_KEY)
        if not acquired:
            print("Reminder job skipped: another instance holds the lock.")
            return 0
        async with conn.transaction():
            rows = await conn.fetch(QUEUE_SQL)
        print(f"Queued {len(rows)} new in-app reminder(s).")
        return 0
    except Exception:
        print("Reminder job failed. See secured scheduler logs.")
        return 1
    finally:
        try:
            await conn.execute("select pg_advisory_unlock($1)", LOCK_KEY)
        finally:
            await conn.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run()))
