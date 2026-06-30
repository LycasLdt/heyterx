CREATE TABLE "task_segment" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "segment_id" text;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_segment_id_task_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "task_segment"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "task_segment" ADD CONSTRAINT "task_segment_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;