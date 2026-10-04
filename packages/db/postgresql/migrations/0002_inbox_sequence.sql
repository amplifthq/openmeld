ALTER TABLE "openmeld"."inbox_items" ADD COLUMN "sequence" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "openmeld"."inbox_items_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_items_sequence_unique" ON "openmeld"."inbox_items" USING btree ("sequence");
