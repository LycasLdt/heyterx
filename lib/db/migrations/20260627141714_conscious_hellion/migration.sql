ALTER TABLE "task" ADD COLUMN "importance" text DEFAULT '重要但不紧急' NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "category" text DEFAULT '智育' NOT NULL;