ALTER TABLE "report" RENAME COLUMN "content" TO "summary";--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "type" text NOT NULL;--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "period_start" date NOT NULL;--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "period_end" date NOT NULL;--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "segment_id" text;--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "metrics" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "plan" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_segment_id_task_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "task_segment"("id") ON DELETE SET NULL;