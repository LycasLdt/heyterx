ALTER TABLE "task" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "reminder_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "reminder_notified" boolean DEFAULT false NOT NULL;