CREATE TABLE "backfill_jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"interval" varchar(8) NOT NULL,
	"range_start" timestamp with time zone NOT NULL,
	"range_end" timestamp with time zone NOT NULL,
	"reason" varchar(16) NOT NULL,
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"rows_written" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "collector_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"level" varchar(8) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"stream" text,
	"message" text NOT NULL,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE "ingest_state" (
	"stream_key" text PRIMARY KEY NOT NULL,
	"last_event_time" timestamp with time zone,
	"last_trade_id" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "klines" (
	"symbol" varchar(20) NOT NULL,
	"interval" varchar(8) NOT NULL,
	"open_time" timestamp with time zone NOT NULL,
	"close_time" timestamp with time zone NOT NULL,
	"open" numeric(24, 8) NOT NULL,
	"high" numeric(24, 8) NOT NULL,
	"low" numeric(24, 8) NOT NULL,
	"close" numeric(24, 8) NOT NULL,
	"volume" numeric(32, 8) NOT NULL,
	"quote_volume" numeric(32, 8) NOT NULL,
	"trade_count" integer DEFAULT 0 NOT NULL,
	"taker_buy_base" numeric(32, 8) DEFAULT '0' NOT NULL,
	"taker_buy_quote" numeric(32, 8) DEFAULT '0' NOT NULL,
	"source" varchar(8) NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "klines_symbol_interval_open_time_pk" PRIMARY KEY("symbol","interval","open_time")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"symbol" varchar(20) NOT NULL,
	"trade_id" bigint NOT NULL,
	"price" numeric(24, 8) NOT NULL,
	"qty" numeric(32, 8) NOT NULL,
	"quote_qty" numeric(32, 8) NOT NULL,
	"trade_time" timestamp with time zone NOT NULL,
	"is_buyer_maker" boolean NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trades_symbol_trade_id_pk" PRIMARY KEY("symbol","trade_id")
);
--> statement-breakpoint
CREATE INDEX "backfill_jobs_created_at_desc_idx" ON "backfill_jobs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "collector_events_ts_desc_idx" ON "collector_events" USING btree ("ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "klines_symbol_interval_open_time_desc_idx" ON "klines" USING btree ("symbol","interval","open_time" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trades_symbol_trade_time_desc_idx" ON "trades" USING btree ("symbol","trade_time" DESC NULLS LAST);