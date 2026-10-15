CREATE TABLE "quote_page_presence" (
  "quote_id" uuid NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "session_id" uuid NOT NULL,
  "page_key" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "quote_page_presence_pk" PRIMARY KEY ("quote_id", "user_id", "session_id")
);

CREATE INDEX "quote_page_presence_page_expiry_idx"
  ON "quote_page_presence" ("quote_id", "page_key", "expires_at");
